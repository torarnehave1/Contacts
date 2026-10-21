import type { Contact } from '../types';
import { getApiToken } from './auth';

const COACHING_BASE = 'https://api.vegvisr.org/coaching';

export interface CmsSamtale {
  id: number;
  gcal_event_id: string | null;
  dato: string;
  tidspunkt: string | null;
  type: string;
  status: string;
  utfall: string | null;
  notater: string | null;
  kontakt_navn: string;
  kontakt_epost: string;
}

export interface ReportPayload {
  status: 'Gjennomført' | 'Avlyst' | 'Ikke møtt';
  utfall: string | null;
  notater: string;
  dato: string;
}

// meeting quality -> CMS status/utfall (agreed 2026-06-17, confirmed 2026-10-06)
const QUALITY_MAP: Record<number, { status: ReportPayload['status']; utfall: string | null }> = {
  0: { status: 'Ikke møtt', utfall: null },
  5: { status: 'Avlyst', utfall: null },
  1: { status: 'Gjennomført', utfall: 'Rådføring' },
  2: { status: 'Gjennomført', utfall: 'Håndterbart' },
  3: { status: 'Gjennomført', utfall: 'OK' },
  4: { status: 'Gjennomført', utfall: 'Feiring/Gjennombrudd' },
  6: { status: 'Gjennomført', utfall: 'Krise' },
};

/** Status/utfall for a meeting-quality value, or null when unmapped. */
export function mapQuality(q: number | null | undefined): { status: ReportPayload['status']; utfall: string | null } | null {
  if (q === null || q === undefined) return null;
  return QUALITY_MAP[q] ?? null;
}

/** Build the CMS report from the contact's report fields, or return why it cannot be sent. */
export function buildReport(contact: Contact): { report: ReportPayload } | { error: string } {
  if (contact.meetingQuality === null || contact.meetingQuality === undefined) {
    return { error: 'Meeting quality er ikke satt.' };
  }
  const mapped = QUALITY_MAP[contact.meetingQuality];
  if (!mapped) return { error: `Meeting quality ${contact.meetingQuality} har ingen CMS-status.` };
  const dato = (contact.reminderSentAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dato)) return { error: 'Reminder sent (møtedato) er ikke satt.' };
  const notater = (contact.criticalNote || '').trim();
  if (!notater) return { error: 'Critical note er tom — CMS krever notater.' };
  return { report: { status: mapped.status, utfall: mapped.utfall, notater, dato } };
}

// coaching-report-worker requires the signed-in user's token and checks it against its own
// sender list (2026-10-21) — before that the route was open to anyone who knew the URL.
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getApiToken();
  if (!token) throw new Error('Ikke innlogget — logg inn på nytt for å bruke CMS-rapportering.');
  return { ...extra, 'X-API-Token': token };
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const kind = text.includes('sgcaptcha') ? 'captcha-sperre' : `HTTP ${res.status}`;
    throw new Error(`CMS svarte ikke med JSON (${kind}).`);
  }
}

/** Read-only: all samtaler for the coach. */
export async function fetchSamtaler(status?: string): Promise<CmsSamtale[]> {
  const res = await fetch(`${COACHING_BASE}/samtaler${status ? `?status=${encodeURIComponent(status)}` : ''}`, {
    headers: authHeaders(),
  });
  const data = await parseJson(res);
  if (!res.ok || data.ok !== true || !Array.isArray(data.samtaler)) {
    throw new Error(String(data.feil || `Kunne ikke hente samtaler (HTTP ${res.status}).`));
  }
  return data.samtaler as CmsSamtale[];
}

/** Samtaler for the contact's e-mail addresses on the given date. */
export function matchSamtaler(samtaler: CmsSamtale[], contact: Contact, dato: string): CmsSamtale[] {
  const emails = new Set(contact.emails.map(e => e.value.trim().toLowerCase()).filter(Boolean));
  return samtaler.filter(s => s.dato === dato && emails.has((s.kontakt_epost || '').trim().toLowerCase()));
}

export interface SendResult {
  coachingId: number;
}

/** LIVE WRITE: persists the report in the CMS and the customer's kontaktlogg. */
export async function sendRapport(coachingId: number, report: ReportPayload): Promise<SendResult> {
  const body: Record<string, string | number> = {
    coaching_id: coachingId,
    status: report.status,
    notater: report.notater,
  };
  if (report.utfall) body.utfall = report.utfall;
  const res = await fetch(`${COACHING_BASE}/rapport`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  if (res.status === 200 && data.ok === true) return { coachingId: Number(data.coaching_id) };
  if (res.status === 202) {
    throw new Error('Samtalen ble ikke funnet i CMS (HTTP 202) — ingenting er lagret som rapport.');
  }
  throw new Error(String(data.feil || `Sending feilet (HTTP ${res.status}).`));
}
