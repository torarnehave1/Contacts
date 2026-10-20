import { getApiToken } from './auth';

/**
 * E-mail through dev-worker (knowledge.vegvisr.org) — the same gate the MCP send_email tool uses:
 * the worker decides which addresses this user may send FROM, applies the daily cap and writes
 * the audit row. This module only carries the request; it decides nothing.
 */
const EMAIL_BASE = 'https://knowledge.vegvisr.org/email';

export interface EmailSender {
  email: string;
  fromName: string | null;
  basis: 'own-profile' | 'grant';
  grantedBy: string | null;
  expiresAt: string | null;
}

export interface EmailDraft {
  fromEmail: string;
  toEmail: string;
  subject: string;
  bodyHtml: string;
  /** Signature name, or "none". Omitted = the sending World's default. */
  signature?: string;
}

export interface EmailPreview {
  senderEmail: string;
  fromName: string | null;
  toEmail: string | null;
  subject: string;
  html: string;
  signatureName: string | null;
  unresolvedPlaceholders: string[];
  warnings: string[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getApiToken();
  if (!token) throw new Error('Not signed in — log in again to send e-mail.');
  const res = await fetch(`${EMAIL_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `E-mail service refused the request (status ${res.status})`);
  }
  return data as T;
}

export async function listEmailSenders(): Promise<EmailSender[]> {
  const data = await call<{ senders: EmailSender[] }>('/senders');
  return data.senders || [];
}

export function previewEmail(draft: EmailDraft): Promise<EmailPreview> {
  return call<EmailPreview>('/preview', { method: 'POST', body: JSON.stringify(draft) });
}

export function sendEmail(draft: EmailDraft): Promise<{ toEmail: string; senderEmail: string; messageId: string | null; sentCopy?: string }> {
  return call('/send', { method: 'POST', body: JSON.stringify(draft) });
}

/** Plain text as typed in the message box → HTML: escaped, blank lines = paragraphs, newlines kept. */
export function textToHtml(text: string): string {
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Bare links become clickable; trailing punctuation stays outside the link.
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, url => `<a href="${url}">${url}</a>`);
  return esc
    .split(/\n{2,}/)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}
