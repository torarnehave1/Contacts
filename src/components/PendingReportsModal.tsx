import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { Contact } from '../types';
import { fetchSamtaler, mapQuality, sendRapport, type CmsSamtale } from '../lib/coaching';
import { addContactLog } from '../lib/drizzle';

const STATUSES = ['Gjennomført', 'Avlyst', 'Ikke møtt'] as const;
const UTFALL = ['Feiring/Gjennombrudd', 'OK', 'Håndterbart', 'Rådføring', 'Krise'];

type Edit = { status: string; utfall: string; notater: string };
type Done = { loggedInContacts: boolean };

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
  const [onlyEmails, setOnlyEmails] = useState<string[] | null>(initialEmails && initialEmails.length ? initialEmails.map(e => e.toLowerCase()) : null);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [done, setDone] = useState<Record<number, Done>>({});

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
      if (!q) return true;
      return `${s.kontakt_navn} ${s.kontakt_epost}`.toLowerCase().includes(q);
    });
  }, [samtaler, filter, onlyEmails]);

  // Default per user decision 2026-10-14: Gjennomført / OK, notat = kontaktens lagrede Critical note, ellers "OK".
  const defaultEdit = (s: CmsSamtale | undefined): Edit => {
    const c = s ? contactByEmail.get((s.kontakt_epost || '').trim().toLowerCase()) : undefined;
    return { status: 'Gjennomført', utfall: 'OK', notater: (c?.criticalNote || '').trim() || 'OK' };
  };
  const editOf = (id: number): Edit => edits[id] ?? defaultEdit(samtaler.find(x => x.id === id));
  const setEdit = (id: number, patch: Partial<Edit>) => {
    setEdits(prev => ({ ...prev, [id]: { ...editOf(id), ...patch } }));
    setConfirmId(null);
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

  const send = async (s: CmsSamtale) => {
    const e = editOf(s.id);
    setSendingId(s.id);
    setRowErrors(prev => { const n = { ...prev }; delete n[s.id]; return n; });
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
      setConfirmId(null);
      onSent(c?.id ?? null);
    } catch (err) {
      setRowErrors(prev => ({ ...prev, [s.id]: err instanceof Error ? err.message : 'Sending feilet.' }));
      setConfirmId(null);
    } finally {
      setSendingId(null);
    }
  };

  const remaining = visible.filter(s => !done[s.id]).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="fixed inset-0 bg-black/50" onClick={() => sendingId === null && onClose()} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between p-6 pb-3">
          <div>
            <h3 className="text-lg font-bold text-[#111827]">Venter på rapport</h3>
            <p className="text-xs text-[#6B7280]">
              Fra Enkel endring CMS. Hver rapport sendes for seg og skrives til CMS og kundens kontaktlogg (synlig for alle CMS-brukere).
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={sendingId !== null} className="p-2 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]" aria-label="Lukk">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 pb-3 flex flex-wrap items-center gap-3">
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
        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3">
          {loadError && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">{loadError}</p>}
          {!loading && !loadError && visible.length === 0 && (
            <p className="text-sm text-[#6B7280] py-8 text-center">Ingen samtaler venter på rapport.</p>
          )}
          {visible.map(s => {
            const e = editOf(s.id);
            const isDone = done[s.id];
            const contact = contactByEmail.get((s.kontakt_epost || '').trim().toLowerCase());
            return (
              <div key={s.id} className={`rounded-2xl border p-4 ${isDone ? 'border-emerald-200 bg-emerald-50' : 'border-[#E5E7EB] bg-white'}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <div className="font-semibold text-sm text-[#111827]">{s.kontakt_navn}</div>
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
                          <button type="button" onClick={() => setConfirmId(null)} disabled={sendingId === s.id} className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-xs">Avbryt</button>
                          <button type="button" onClick={() => send(s)} disabled={sendingId === s.id} className="px-3 py-1.5 rounded-lg bg-[#059669] hover:bg-[#047857] text-white text-xs font-medium disabled:opacity-50">
                            {sendingId === s.id ? 'Sender…' : 'Bekreft og send'}
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => requestSend(s)} className="px-3 py-1.5 rounded-lg bg-[#059669] hover:bg-[#047857] text-white text-xs font-medium">
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
      </div>
    </div>
  );
}
