// Client for the Vegvisr RealTime "Custom Room Slugs" API.
// Used to add contact emails to a slug's approved-emails allowlist.
//
// Auth: the slug endpoints require X-API-Token = the user's emailVerificationToken
// (Admin/Superadmin role). That token is already persisted in localStorage.'user'
// by the auth flow (see App.tsx persistUser), so we read it directly here.

const REALTIME_BASE = 'https://api.vegvisr.org/realtime';

export type RealtimeSlug = {
  id: string;
  slug: string;
  meetingId: string;
  ownerEmail: string;
  allowedEmails: string[];
  active: boolean;
  createdAt: string;
  scheduledStartAt: string | null;
};

const getApiToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.emailVerificationToken || null;
  } catch {
    return null;
  }
};

const authHeaders = (): HeadersInit => {
  const token = getApiToken();
  if (!token) throw new Error('Not authenticated — no API token found. Log in again.');
  return { 'Content-Type': 'application/json', 'X-API-Token': token };
};

// GET /realtime/slugs — slugs owned by the current user (active only).
export const listSlugs = async (): Promise<RealtimeSlug[]> => {
  const res = await fetch(`${REALTIME_BASE}/slugs`, { method: 'GET', headers: authHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.message || `Failed to load slugs (${res.status})`);
  }
  const data = await res.json();
  return (data.slugs || []) as RealtimeSlug[];
};

// POST /realtime/slugs/{id}/update — the API REPLACES the whole allowedEmails list,
// so callers must pass the full intended list (merge before calling).
export const updateSlugAllowedEmails = async (slugId: string, allowedEmails: string[]): Promise<void> => {
  const res = await fetch(`${REALTIME_BASE}/slugs/${slugId}/update`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ allowedEmails }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.message || `Failed to update slug (${res.status})`);
  }
};

// Merge new emails into an existing allowlist, deduping case-insensitively while
// preserving the original casing/order of entries already present.
export const mergeEmails = (existing: string[], toAdd: string[]): { merged: string[]; added: string[] } => {
  const seen = new Map<string, string>();
  for (const e of existing) seen.set(e.trim().toLowerCase(), e.trim());
  const added: string[] = [];
  for (const raw of toAdd) {
    const e = raw.trim();
    if (!e) continue;
    const key = e.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, e);
      added.push(e);
    }
  }
  return { merged: Array.from(seen.values()), added };
};
