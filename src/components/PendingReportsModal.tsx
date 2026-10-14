import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Contact } from '../types';
import { fetchSamtaler, mapQuality, sendRapport, type CmsSamtale } from '../lib/coaching';
import { addContactLog } from '../lib/drizzle';

const STATUSES = ['Gjennomført', 'Avlyst', 'Ikke møtt'] as const;
const UTFALL = ['Feiring/Gjennombrudd', 'OK', 'Håndterbart', 'Rådføring', 'Krise'];

type Edit = { status: string; utfall: string; notater: string };
type Done = { loggedInContacts: boolean };
type BulkState = { running: boolean; total: number; index: number; ok: number; failed: number; stopped: string | null };

const pad = (n: number) => String(n).padStart(2, '0');
const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgoIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return localIso(d); };

interface Props {
  contacts: Contact[];
  logTableId: string | null;
  initialEmails?: string[];
  onSent: (contactId: string | null) => void;
  onClose: () => void;
}

export function PendingReportsModal({ contacts, logTableId, initialEmails, onSent, onClose }: Props) {
  const [samtaler, setSamtaler] = useState<CmsSamtale[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [onlyEmails, setOnlyEmails] = useState<string[] | null>(initialEmails && initialEmails.length ? initialEmails.map(e => e.toLowerCase()) : null);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [done, setDone] = useState<Record<number, Done>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkAck, setBulkAck] = useState(false);
  const [bulk, setBulk] = useState<BulkState | null>(null);
  const stopRef = useRef(false);

  const contactByEmail = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const c of contacts) for (const e of c.emails) if (e.value) map.set(e.value.trim().toLowerCase(), c);
    return map;
  }, [contacts]);

  useEffect(() => {
    let cancelled = false;
    fetchSamtaler('Venter på rapport')
      .then(list => { if (!cancelled) setSamtaler(list.sort((a, b) => a.dato.localeCompare(b.dato))); })
      .catch(err => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Kunne ikke hente samtaler.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return samtaler.filter(s => {
      if (onlyEmails && !onlyEmails.includes((s.kontakt_epost || '').toLowerCase())) return false;
      if (from && s.dato < from) return false;
      if (to && s.dato > to) return false;
      if (!q) return true;
      return `${s.kontakt_navn} ${s.kontakt_epost}`.toLowerCase().includes(q);
    });
  }, [samtaler, filter, onlyEmails, from, to]);

  // Default per user decision 2026-10-14: Gjennomført / OK, notat = kontaktens lagrede Critical note, ellers "OK".
  const defaultEdit = (s: CmsSamtale | undefined): Edit => {
    const c = s ? contactByEmail.get((s.kontakt_epost || '').trim().toLowerCase()) : undefined;
    return { status: 'Gjennomført', utfall: 'OK', notater: (c?.criticalNote || '').trim() || 'OK' };
  };
  const editOf = (id: number): Edit => edits[id] ?? defaultEdit(samtaler.find(x => x.id === id));
  const setEdit = (id: number, patch: Partial<Edit>) => {
    setEdits(prev => ({ ...prev, [id]: { ...editOf(id), ...patch } }));
    setConfirmId(null);
    setBulkConfirm(false);
    setBulkAck(false);
    setRowErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const fillFromContact = (s: CmsSamtale) => {
    const c = contactByEmail.get((s.kontakt_epost || '').trim().toLowerCase());
    if (!c) { setRowErrors(prev => ({ ...prev, [s.id]: 'Fant ikke kontakten i Contacts på e-post.' })); return; }
    const mapped = mapQuality(c.meetingQuality);
    setEdit(s.id, {
      ...(mapped ? { status: mapped.status, utfall: mapped.utfall ?? '' } : {}),
      notater: c.criticalNote || '',
    });
  };

  const validate = (id: number): string | null => {
    const e = editOf(id);
    if (!e.status) return 'Velg status.';
    if (e.status === 'Gjennomført' && !e.utfall) return 'Velg utfall (påkrevd ved Gjennomført).';
    if (!e.notater.trim()) return 'Notater er påkrevd av CMS.';
    return null;
  };

  const requestSend = (s: CmsSamtale) => {
    const err = validate(s.id);
    if (err) { setRowErrors(prev => ({ ...prev, [s.id]: err })); return; }
    setConfirmId(s.id);
  };

  /** LIVE WRITE for one samtale. Returns an error message, or null on success. */
  const sendOne = async (s: CmsSamtale): Promise<string | null> => {
    const e = editOf(s.id);
    try {
      const utfall = e.status === 'Gjennomført' ? e.utfall : null;
      const result = await sendRapport(s.id, { status: e.status as 'Gjennomført' | 'Avlyst' | 'Ikke møtt', utfall, notater: e.notater.trim(), dato: s.dato });
      const c = contactByEmail.get((s.kontakt_epost || '').trim().toLowerCase());
      let logged = false;
      if (c && logTableId) {
        try {
          const sentAt = new Date();
          const summary = `Rapport sendt til Enkel endring CMS\nSamtale #${result.coachingId} · ${s.dato}${s.tidspunkt ? ' ' + s.tidspunkt : ''}\nStatus: ${e.status}${utfall ? ' · ' + utfall : ''}\n\n${e.notater.trim()}`;
          await addContactLog(logTableId, c.id, c.fullName, 'Report', summary, undefined, sentAt, undefined, {
            coaching_id: String(result.coachingId), status: e.status, utfall: utfall ?? '', rapport_sendt_at: sentAt.toISOString(),
          });
          logged = true;
        } catch { /* reported in the row below */ }
      }
      setDone(prev => ({ ...prev, [s.id]: { loggedInContacts: logged } }));
      onSent(c?.id ?? null);
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sending feilet.';
      setRowErrors(prev => ({ ...prev, [s.id]: msg }));
      return msg;
    }
  };

  const send = async (s: CmsSamtale) => {
    setSendingId(s.id);
    setRowErrors(prev => { const n = { ...prev }; delete n[s.id]; return n; });
    await sendOne(s);
    setConfirmId(null);
    setSendingId(null);
  };

  // ── Bulk ──
  const selectedRows = visible.filter(s => selected.has(s.id) && !done[s.id]);
  const bulkValid = selectedRows.filter(s => !validate(s.id));
  const bulkInvalid = selectedRows.length - bulkValid.length;
  const selectableVisible = visible.filter(s => !done[s.id]);
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every(s => selected.has(s.id));

  const sameNoteWarnings = useMemo(() => {
    const groups = new Map<string, { name: string; n: number }>();
    for (const s of bulkValid) {
      const note = editOf(s.id).notater.trim();
      if (note === 'OK') continue;
      const key = `${(s.kontakt_epost || '').toLowerCase()}||${note}`;
      const g = groups.get(key);
      if (g) g.n += 1; else groups.set(key, { name: s.kontakt_navn, n: 1 });
    }
    return [...groups.values()].filter(g => g.n > 1);
  }, [bulkValid.map(s => s.id).join(','), edits, samtaler]);

  const toggleSelected = (id: number) => {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    setBulkConfirm(false);
    setBulkAck(false);
  };
  const toggleAllVisible = () => {
    setSelected(prev => {
      const n = new Set(prev);
      if (allVisibleSelected) selectableVisible.forEach(s => n.delete(s.id));
      else selectableVisible.forEach(s => n.add(s.id));
      return n;
    });
    setBulkConfirm(false);
    setBulkAck(false);
  };

  const runBulk = async () => {
    const queue = bulkValid.slice();
    stopRef.current = false;
    setBulk({ running: true, total: queue.length, index: 0, ok: 0, failed: 0, stopped: null });
    let ok = 0;
    let failed = 0;
    let consecutive = 0;
    let stopped: string | null = null;
    for (let i = 0; i < queue.length; i++) {
      if (stopRef.current) { stopped = 'Stoppet av deg.'; break; }
      setBulk(b => b && { ...b, index: i });
      const err = await sendOne(queue[i]);
      if (err) {
        failed += 1;
        consecutive += 1;
        if (consecutive >= 3) { stopped = 'Stoppet etter 3 feil på rad.'; break; }
      } else {
        ok += 1;
        consecutive = 0;
      }
      setBulk(b => b && { ...b, ok, failed });
    }
    setBulk({ running: false, total: queue.length, index: queue.length, ok, failed, stopped });
    setBulkConfirm(false);
    setBulkAck(false);
    setSelected(new Set());
  };

  const busy = sendingId !== null || Boolean(bulk?.running);
  const remaining = visible.filter(s => !done[s.id]).length;
  const setPreset = (days: number | null) => {
    if (days === null) { setFrom(''); setTo(''); } else { setFrom(daysAgoIso(days)); setTo(localIso(new Date())); }
    setBulkConfirm(false);
    setBulkAck(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="fixed inset-0 bg-black/50" onClick={() => !busy && onClose()} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between p-6 pb-3">
          <div>
            <h3 className="text-lg font-bold text-[#111827]">Venter på rapport</h3>
            <p className="text-xs text-[#6B7280]">
              Fra Enkel endring CMS. Rapportene skrives til CMS og kundens kontaktlogg (synlig for alle CMS-brukere).
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="p-2 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280] disabled:opacity-50" aria-label="Lukk">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 pb-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filtrer på navn eller e-post"
              className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-[#E5E7EB] text-sm"
            />
            {onlyEmails && (
              <button type="button" onClick={() => setOnlyEmails(null)} className="text-xs text-[#4F46E5] hover:underline">
                Viser kun valgt kontakt — vis alle
              </button>
            )}
            <span className="text-xs text-[#6B7280]">{loading ? 'Henter…' : `${remaining} venter`}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-[#6B7280]">Møtedato:</span>
            <button type="button" onClick={() => setPreset(14)} className="px-2.5 py-1 rounded-lg border border-[#E5E7EB] hover:bg-[#F9FAFB]">Siste 14 dager</button>
            <button type="button" onClick={() => setPreset(21)} className="px-2.5 py-1 rounded-lg border border-[#E5E7EB] hover:bg-[#F9FAFB]">Siste 3 uker</button>
            <button type="button" onClick={() => setPreset(null)} className="px-2.5 py-1 rounded-lg border border-[#E5E7EB] hover:bg-[#F9FAFB]">Alle</button>
            <label className="flex items-center gap-1 text-[#6B7280]">Fra
              <input type="date" value={from} onChange={e => { setFrom(e.target.value); setBulkConfirm(false); setBulkAck(false); }} className="px-2 py-1 rounded-lg border border-[#E5E7EB] text-[#111827]" />
            </label>
            <label className="flex items-center gap-1 text-[#6B7280]">Til
              <input type="date" value={to} onChange={e => { setTo(e.target.value); setBulkConfirm(false); setBulkAck(false); }} className="px-2 py-1 rounded-lg border border-[#E5E7EB] text-[#111827]" />
            </label>
            <label className="flex items-center gap-1 ml-auto text-[#374151]">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={busy || selectableVisible.length === 0} />
              Velg alle viste ({selectableVisible.length})
            </label>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-3">
          {loadError && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">{loadError}</p>}
          {!loading && !loadError && visible.length === 0 && (
            <p className="text-sm text-[#6B7280] py-8 text-center">Ingen samtaler venter på rapport i dette utvalget.</p>
          )}
          {visible.map(s => {
            const e = editOf(s.id);
            const isDone = done[s.id];
            const contact = contactByEmail.get((s.kontakt_epost || '').trim().toLowerCase());
            return (
              <div key={s.id} className={`rounded-2xl border p-4 ${isDone ? 'border-emerald-200 bg-emerald-50' : selected.has(s.id) ? 'border-[#059669] bg-white' : 'border-[#E5E7EB] bg-white'}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <label className="flex items-center gap-2 font-semibold text-sm text-[#111827]">
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelected(s.id)} disabled={Boolean(isDone) || busy} />
                    {s.kontakt_navn}
                  </label>
                  <div className="text-xs text-[#6B7280]">#{s.id} · {s.dato}{s.tidspunkt ? ` ${s.tidspunkt}` : ''} · {s.type} · {s.kontakt_epost}</div>
                </div>
                {isDone ? (
                  <p className="text-sm text-emerald-700">
                    Sendt: {e.status}{e.status === 'Gjennomført' && e.utfall ? ` / ${e.utfall}` : ''}.
                    {done[s.id].loggedInContacts ? ' Loggført i Contacts.' : contact ? ' Rapporten er sendt, men loggføring i Contacts feilet.' : ' Kontakten finnes ikke i Contacts på e-post, så ingen logg ble skrevet.'}
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <label className="text-xs font-semibold text-[#6B7280]">Status
                        <select value={e.status} onChange={ev => setEdit(s.id, { status: ev.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-[#E5E7EB] bg-white text-sm font-normal text-[#111827]">
                          {STATUSES.map(x => <option key={x} value={x}>{x}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-[#6B7280]">Utfall
                        <select value={e.utfall} onChange={ev => setEdit(s.id, { utfall: ev.target.value })} disabled={e.status !== 'Gjennomført'} className="mt-1 w-full px-3 py-2 rounded-xl border border-[#E5E7EB] bg-white text-sm font-normal text-[#111827] disabled:opacity-50">
                          <option value="">Velg utfall</option>
                          {UTFALL.map(x => <option key={x} value={x}>{x}</option>)}
                        </select>
                      </label>
                    </div>
                    <textarea
                      value={e.notater}
                      onChange={ev => setEdit(s.id, { notater: ev.target.value })}
                      placeholder="Notater fra samtalen (synlig for alle CMS-brukere)"
                      className="w-full px-3 py-2 rounded-xl border border-[#E5E7EB] bg-white text-sm min-h-[70px]"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                      <button type="button" onClick={() => fillFromContact(s)} className="text-xs text-[#4F46E5] hover:underline">
                        Fyll fra kontaktens kvalitet og Critical note
                      </button>
                      {confirmId === s.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[#374151]">Sender til live CMS: #{s.id} · {s.dato} · {e.status}{e.status === 'Gjennomført' ? ` / ${e.utfall}` : ''}</span>
                          <button type="button" onClick={() => setConfirmId(null)} disabled={busy} className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-xs">Avbryt</button>
                          <button type="button" onClick={() => send(s)} disabled={busy} className="px-3 py-1.5 rounded-lg bg-[#059669] hover:bg-[#047857] text-white text-xs font-medium disabled:opacity-50">
                            {sendingId === s.id ? 'Sender…' : 'Bekreft og send'}
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => requestSend(s)} disabled={busy} className="px-3 py-1.5 rounded-lg bg-[#059669] hover:bg-[#047857] text-white text-xs font-medium disabled:opacity-50">
                          Send rapport
                        </button>
                      )}
                    </div>
                  </>
                )}
                {rowErrors[s.id] && <p className="mt-2 text-xs text-rose-700">{rowErrors[s.id]}</p>}
              </div>
            );
          })}
        </div>

        {(selectedRows.length > 0 || bulk) && (
          <div className="border-t border-[#E5E7EB] p-4 bg-[#F9FAFB] rounded-b-3xl space-y-3">
            {bulk && (
              <p className={`text-sm rounded-xl p-3 border ${bulk.running ? 'text-[#374151] bg-white border-[#E5E7EB]' : bulk.failed || bulk.stopped ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>
                {bulk.running
                  ? `Sender ${Math.min(bulk.index + 1, bulk.total)} av ${bulk.total}… (${bulk.ok} sendt, ${bulk.failed} feilet)`
                  : `Ferdig: ${bulk.ok} sendt, ${bulk.failed} feilet av ${bulk.total}.${bulk.stopped ? ' ' + bulk.stopped : ''}${bulk.failed ? ' Rader med feil står med melding og kan sendes på nytt.' : ''}`}
                {bulk.running && (
                  <button type="button" onClick={() => { stopRef.current = true; }} className="ml-3 px-2 py-1 rounded-lg border border-[#E5E7EB] text-xs">Stopp etter denne</button>
                )}
              </p>
            )}
            {!bulk?.running && selectedRows.length > 0 && !bulkConfirm && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-[#374151]">
                  {selectedRows.length} valgt{bulkInvalid > 0 ? ` · ${bulkInvalid} mangler utfall eller notat og hoppes over` : ''}
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setSelected(new Set()); setBulk(null); }} className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-xs">Fjern valg</button>
                  <button
                    type="button"
                    onClick={() => { setBulk(null); setBulkConfirm(true); setBulkAck(false); }}
                    disabled={bulkValid.length === 0}
                    className="px-3 py-1.5 rounded-lg bg-[#059669] hover:bg-[#047857] text-white text-xs font-medium disabled:opacity-50"
                  >
                    Send {bulkValid.length} valgte…
                  </button>
                </div>
              </div>
            )}
            {!bulk?.running && bulkConfirm && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-[#111827]">Forhåndsvisning: {bulkValid.length} rapporter skrives til live CMS</p>
                <ul className="max-h-40 overflow-y-auto text-xs text-[#374151] space-y-1 bg-white border border-[#E5E7EB] rounded-xl p-3">
                  {bulkValid.map(s => {
                    const e = editOf(s.id);
                    return (
                      <li key={s.id}>
                        #{s.id} · {s.dato} · {s.kontakt_navn} — {e.status}{e.status === 'Gjennomført' ? ` / ${e.utfall}` : ''} — «{e.notater.trim().slice(0, 70)}{e.notater.trim().length > 70 ? '…' : ''}»
                      </li>
                    );
                  })}
                </ul>
                {sameNoteWarnings.length > 0 && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                    Samme notat er brukt på flere møter: {sameNoteWarnings.map(g => `${g.name} (${g.n} rader)`).join(', ')}. Critical note gjelder kontakten, ikke det enkelte møtet — endre notatene hvis de ikke passer for alle.
                  </p>
                )}
                <label className="flex items-start gap-2 text-xs text-[#374151]">
                  <input type="checkbox" checked={bulkAck} onChange={e => setBulkAck(e.target.checked)} className="mt-0.5" />
                  Jeg bekrefter at {bulkValid.length} rapporter skal skrives til CMS og kundenes kontaktlogg (synlig for alle CMS-brukere), og at de overskriver eksisterende rapporter.
                </label>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setBulkConfirm(false); setBulkAck(false); }} className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-xs">Avbryt</button>
                  <button
                    type="button"
                    onClick={runBulk}
                    disabled={!bulkAck || bulkValid.length === 0}
                    className="px-3 py-1.5 rounded-lg bg-[#059669] hover:bg-[#047857] text-white text-xs font-medium disabled:opacity-50"
                  >
                    Bekreft og send {bulkValid.length} rapporter
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
