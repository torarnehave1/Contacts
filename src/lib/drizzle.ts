import { Contact, ContactLog, SmsTemplate, EmailTemplate } from '../types';
import { getApiToken } from './auth';

const DRIZZLE_BASE = 'https://drizzle.vegvisr.org';

const CONTACTS_COLUMNS = [
  { name: 'full_name', type: 'text', label: 'Full Name', required: true },
  { name: 'first_name', type: 'text', label: 'First Name' },
  { name: 'middle_name', type: 'text', label: 'Middle Name' },
  { name: 'last_name', type: 'text', label: 'Last Name' },
  { name: 'nickname', type: 'text', label: 'Nickname' },
  { name: 'birthday', type: 'text', label: 'Birthday' },
  { name: 'notes', type: 'text', label: 'Notes' },
  { name: 'photo', type: 'text', label: 'Photo URL' },
  { name: 'labels', type: 'text', label: 'Labels JSON' },
  { name: 'emails', type: 'text', label: 'Emails JSON' },
  { name: 'phones', type: 'text', label: 'Phones JSON' },
  { name: 'addresses', type: 'text', label: 'Addresses JSON' },
  { name: 'websites', type: 'text', label: 'Websites JSON' },
  { name: 'organization', type: 'text', label: 'Organization JSON' },
  { name: 'meeting_quality', type: 'integer', label: 'Meeting Quality' },
  { name: 'critical_note', type: 'text', label: 'Critical Note' },
  { name: 'reminder_sent_at', type: 'text', label: 'Reminder Sent At' },
];

const SMS_TEMPLATES_COLUMNS = [
  { name: 'name', type: 'text', label: 'Template Name', required: true },
  { name: 'message', type: 'text', label: 'Message Text', required: true },
];

const EMAIL_TEMPLATES_COLUMNS = [
  { name: 'name', type: 'text', label: 'Template Name', required: true },
  { name: 'subject', type: 'text', label: 'Subject' },
  { name: 'message', type: 'text', label: 'Message Text', required: true },
];

/** Returns the tableId for this user's contacts table, creating it if needed. */
export async function ensureContactsTable(userId: string): Promise<string> {
  const listRes = await fetch(`${DRIZZLE_BASE}/tables?graphId=${encodeURIComponent(userId)}`);
  if (!listRes.ok) throw new Error('Failed to list user tables');
  const listData = await listRes.json() as { tables: { id: string; displayName: string }[] };
  const existing = listData.tables.find(t => t.displayName === 'contacts');
  if (existing) {
    const schemaRes = await fetch(`${DRIZZLE_BASE}/table/${existing.id}`);
    if (schemaRes.ok) {
      const schema = await schemaRes.json() as { columns?: { name: string }[] };
      const colNames = new Set(schema.columns?.map(c => c.name) ?? []);
      const migrateColumns = [
        { name: 'meeting_quality', type: 'integer', label: 'Meeting Quality' },
        { name: 'critical_note', type: 'text', label: 'Critical Note' },
        { name: 'reminder_sent_at', type: 'text', label: 'Reminder Sent At' },
      ];
      for (const col of migrateColumns) {
        if (!colNames.has(col.name)) {
          await fetch(`${DRIZZLE_BASE}/add-column`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableId: existing.id, name: col.name, type: col.type, label: col.label }),
          }).catch(() => {});
        }
      }
    }
    return existing.id;
  }

  const createRes = await fetch(`${DRIZZLE_BASE}/create-table`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId: userId,
      displayName: 'contacts',
      columns: CONTACTS_COLUMNS,
      createdBy: userId,
    }),
  });
  if (!createRes.ok) throw new Error('Failed to create contacts table');
  const createData = await createRes.json() as { id: string };
  return createData.id;
}

function rowToContact(row: Record<string, unknown>): Contact {
  const parseArr = (field: unknown): unknown[] => {
    if (!field) return [];
    try { return JSON.parse(field as string); } catch { return []; }
  };
  const parseObj = <T>(field: unknown, fallback: T): T => {
    if (!field) return fallback;
    try { return JSON.parse(field as string) as T; } catch { return fallback; }
  };
  return {
    id: row._id as string,
    firstName: (row.first_name as string) || '',
    middleName: (row.middle_name as string) || '',
    lastName: (row.last_name as string) || '',
    fullName: (row.full_name as string) || '',
    nickname: (row.nickname as string) || '',
    birthday: (row.birthday as string) || '',
    notes: (row.notes as string) || '',
    photo: (row.photo as string) || '',
    labels: parseArr(row.labels) as string[],
    emails: parseArr(row.emails) as Contact['emails'],
    phones: parseArr(row.phones) as Contact['phones'],
    addresses: parseArr(row.addresses) as Contact['addresses'],
    websites: parseArr(row.websites) as Contact['websites'],
    organization: parseObj(row.organization, { name: '', title: '', department: '' }),
    meetingQuality: row.meeting_quality === null || row.meeting_quality === undefined || row.meeting_quality === '' ? null : Number(row.meeting_quality),
    criticalNote: (row.critical_note as string) || '',
    reminderSentAt: (row.reminder_sent_at as string) || '',
  };
}

// ─── World contacts ───────────────────────────────────────────────────────────
// A World's contact list lives in the World's OWN database (founder's Cloudflare account), reached
// through agent.vegvisr.org/world-contacts/*. The app addresses it with tableId `world:<domain>`;
// every contact function below routes on that prefix, so the rest of the app is unchanged.
const WORLD_API = 'https://agent.vegvisr.org/world-contacts';
const WORLD_PREFIX = 'world:';
export const worldTableId = (domain: string) => `${WORLD_PREFIX}${domain}`;
export const worldOf = (tableId: string | null): string | null =>
  tableId && tableId.startsWith(WORLD_PREFIX) ? tableId.slice(WORLD_PREFIX.length) : null;

async function worldFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getApiToken();
  if (!token) throw new Error('Not signed in');
  const res = await fetch(`${WORLD_API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-API-Token': token, ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({})) as T & { success?: boolean; error?: string };
  if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export type WorldChoice = { domain: string; name: string };

/** The Worlds whose contacts this user may work with (founder, account holder, Superadmin, system owner). */
export async function listContactWorlds(): Promise<WorldChoice[]> {
  const data = await worldFetch<{ worlds: WorldChoice[] }>('/worlds');
  return data.worlds || [];
}

/** Load all contacts for a table, page by page (no row cap). */
export async function loadContacts(tableId: string): Promise<Contact[]> {
  const world = worldOf(tableId);
  const out: Contact[] = [];
  const page = 2000;
  for (let offset = 0; ; offset += page) {
    let records: Record<string, unknown>[];
    if (world) {
      const data = await worldFetch<{ records: Record<string, unknown>[] }>(
        `/list?world=${encodeURIComponent(world)}&offset=${offset}&limit=${page}`);
      records = data.records || [];
    } else {
      const res = await fetch(`${DRIZZLE_BASE}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, orderBy: 'full_name', order: 'asc', limit: page, offset }),
      });
      if (!res.ok) throw new Error('Failed to load contacts');
      const data = await res.json() as { records: Record<string, unknown>[] };
      records = data.records || [];
    }
    out.push(...records.map(rowToContact));
    if (records.length < page) break;
  }
  return out;
}

export type ImportProgress = { done: number; total: number; inserted: number; merged: number };

/**
 * Import many contacts in batches, reporting progress. Returns the stored id of each contact, in order.
 * In a World, contacts with the same e-mail are merged (labels and fields joined), so `ids` can repeat
 * and the caller should reload the list afterwards.
 */
export async function importContacts(
  tableId: string,
  contacts: Contact[],
  source: string,
  onProgress?: (p: ImportProgress) => void,
): Promise<{ ids: string[]; inserted: number; merged: number }> {
  const world = worldOf(tableId);
  const size = world ? 250 : 500;
  const ids: string[] = [];
  let inserted = 0, merged = 0;
  for (let i = 0; i < contacts.length; i += size) {
    const part = contacts.slice(i, i + size);
    if (world) {
      const r = await worldFetch<{ ids: string[]; inserted: number; merged: number }>('/import', {
        method: 'POST', body: JSON.stringify({ world, source, contacts: part }),
      });
      ids.push(...r.ids); inserted += r.inserted; merged += r.merged;
    } else {
      const got = await bulkInsertContacts(tableId, part);
      ids.push(...got); inserted += got.length;
    }
    onProgress?.({ done: Math.min(i + size, contacts.length), total: contacts.length, inserted, merged });
  }
  return { ids, inserted, merged };
}

/** Bulk-insert contacts. Returns the D1-generated IDs in order. */
export async function bulkInsertContacts(tableId: string, contacts: Contact[]): Promise<string[]> {
  if (worldOf(tableId)) return (await importContacts(tableId, contacts, 'manual')).ids;
  const records = contacts.map(c => ({
    full_name: c.fullName,
    first_name: c.firstName,
    middle_name: c.middleName,
    last_name: c.lastName,
    nickname: c.nickname,
    birthday: c.birthday,
    notes: c.notes,
    photo: c.photo,
    labels: JSON.stringify(c.labels),
    emails: JSON.stringify(c.emails),
    phones: JSON.stringify(c.phones),
    addresses: JSON.stringify(c.addresses),
    websites: JSON.stringify(c.websites),
    organization: JSON.stringify(c.organization),
    meeting_quality: c.meetingQuality,
    critical_note: c.criticalNote,
    reminder_sent_at: c.reminderSentAt,
  }));

  const res = await fetch(`${DRIZZLE_BASE}/bulk-insert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId, records }),
  });
  if (!res.ok) throw new Error('Failed to bulk insert contacts');
  const data = await res.json() as { ids: string[] };
  return data.ids;
}

/** Update specific fields on a single contact row. */
export async function updateContact(tableId: string, id: string, record: Record<string, unknown>): Promise<void> {
  const world = worldOf(tableId);
  if (world) {
    await worldFetch('/update', { method: 'POST', body: JSON.stringify({ world, id, record }) });
    return;
  }
  const res = await fetch(`${DRIZZLE_BASE}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId, id, record }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to update contact: ${errorText}`);
  }
}

/** Delete a single contact by its D1 _id. */
export async function deleteContact(tableId: string, contactId: string): Promise<void> {
  const world = worldOf(tableId);
  if (world) {
    await worldFetch('/delete', { method: 'POST', body: JSON.stringify({ world, id: contactId }) });
    return;
  }
  const res = await fetch(`${DRIZZLE_BASE}/delete-records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId, ids: [contactId] }),
  });
  if (!res.ok) throw new Error('Failed to delete contact');
}

/** Delete all contacts in the table. */
export async function deleteAllContacts(tableId: string): Promise<void> {
  // A World's list is the founder's data; it is never wiped in one click from here.
  if (worldOf(tableId)) throw new Error('Clearing all contacts is not available for a World');
  const res = await fetch(`${DRIZZLE_BASE}/delete-records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId }),
  });
  if (!res.ok) throw new Error('Failed to clear contacts');
}

/** Delete a single log entry by its D1 _id. */
export async function deleteContactLog(tableId: string, logId: string): Promise<void> {
  const res = await fetch(`${DRIZZLE_BASE}/delete-records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId, ids: [logId] }),
  });
  if (!res.ok) throw new Error('Failed to delete log entry');
}

// ─── Contact Log Table ────────────────────────────────────────────────────────

// Coaching report fields (Vegvisr CMS `vegvisr_send_rapport`). Added per scope B.
const REPORT_COLUMNS = [
  { name: 'coaching_id', type: 'text', label: 'Coaching ID' },
  { name: 'status', type: 'text', label: 'Report Status' },
  { name: 'utfall', type: 'text', label: 'Utfall' },
  { name: 'rapport_sendt_at', type: 'text', label: 'Rapport Sendt At' },
  { name: 'spurt_om_referanse', type: 'integer', label: 'Spurt Om Referanse' },
  { name: 'referanse_notat', type: 'text', label: 'Referanse Notat' },
  { name: 'spurt_om_formidling', type: 'integer', label: 'Spurt Om Formidling' },
  { name: 'formidling_notat', type: 'text', label: 'Formidling Notat' },
];

const LOG_COLUMNS = [
  { name: 'contact_id', type: 'text', label: 'Contact ID', required: true },
  { name: 'contact_name', type: 'text', label: 'Contact Name' },
  { name: 'contact_type', type: 'text', label: 'Type' },
  { name: 'notes', type: 'text', label: 'Notes' },
  { name: 'logged_at', type: 'text', label: 'Logged At' },
  { name: 'recording_url', type: 'text', label: 'Recording URL' },
  { name: 'event_uid', type: 'text', label: 'Event UID' },
  ...REPORT_COLUMNS,
];

/** Returns the tableId for this user's contact log table, creating it if needed.
 *  Also ensures the recording_url column exists on older tables. */
export async function ensureContactLogTable(userId: string): Promise<string> {
  const listRes = await fetch(`${DRIZZLE_BASE}/tables?graphId=${encodeURIComponent(userId)}`);
  if (!listRes.ok) throw new Error('Failed to list user tables');
  const listData = await listRes.json() as { tables: { id: string; displayName: string }[] };
  const existing = listData.tables.find(t => t.displayName === 'contact_logs');

  if (existing) {
    // Migrate: add missing columns for older tables
    const schemaRes = await fetch(`${DRIZZLE_BASE}/table/${existing.id}`);
    if (schemaRes.ok) {
      const schema = await schemaRes.json() as { columns?: { name: string }[] };
      const colNames = new Set(schema.columns?.map(c => c.name) ?? []);
      const migrateColumns = [
        { name: 'recording_url', type: 'text', label: 'Recording URL' },
        { name: 'event_uid', type: 'text', label: 'Event UID' },
        ...REPORT_COLUMNS,
      ];
      for (const col of migrateColumns) {
        if (!colNames.has(col.name)) {
          await fetch(`${DRIZZLE_BASE}/add-column`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableId: existing.id, name: col.name, type: col.type, label: col.label }),
          }).catch(() => {});
        }
      }
    }
    return existing.id;
  }

  const createRes = await fetch(`${DRIZZLE_BASE}/create-table`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId: userId,
      displayName: 'contact_logs',
      columns: LOG_COLUMNS,
      createdBy: userId,
    }),
  });
  if (!createRes.ok) throw new Error('Failed to create contact log table');
  const createData = await createRes.json() as { id: string };
  return createData.id;
}

/** Add a log entry for a contact. */
export async function addContactLog(
  tableId: string,
  contactId: string,
  contactName: string,
  contactType: string,
  notes: string,
  recordingUrl?: string,
  loggedAt?: Date,
  eventUid?: string,
  report?: { coaching_id: string; status: string; utfall: string; rapport_sendt_at: string },
): Promise<void> {
  const res = await fetch(`${DRIZZLE_BASE}/insert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId,
      record: {
        contact_id: contactId,
        contact_name: contactName,
        contact_type: contactType,
        notes,
        logged_at: (loggedAt || new Date()).toISOString(),
        ...(recordingUrl ? { recording_url: recordingUrl } : {}),
        ...(eventUid ? { event_uid: eventUid } : {}),
        ...(report ?? {}),
      },
    }),
  });
  if (!res.ok) throw new Error('Failed to add contact log');
}

/** Check if an event UID already exists in logs (deduplication). */
export async function checkEventUidExists(tableId: string, eventUid: string): Promise<boolean> {
  const res = await fetch(`${DRIZZLE_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId,
      where: { event_uid: eventUid },
      limit: 1,
    }),
  });
  if (!res.ok) throw new Error('Failed to check event UID');
  const data = await res.json() as { records: Record<string, unknown>[] };
  return (data.records || []).length > 0;
}

function rowToLog(row: Record<string, unknown>): ContactLog {
  return {
    id: row._id as string,
    contact_id: (row.contact_id as string) || '',
    contact_name: (row.contact_name as string) || '',
    contact_type: (row.contact_type as string) || '',
    notes: (row.notes as string) || '',
    logged_at: (row.logged_at as string) || '',
    recording_url: (row.recording_url as string) || '',
    event_uid: (row.event_uid as string) || undefined,
    coaching_id: (row.coaching_id as string) || undefined,
    status: (row.status as string) || undefined,
    utfall: (row.utfall as string) || undefined,
    rapport_sendt_at: (row.rapport_sendt_at as string) || undefined,
  };
}

/** Get all log entries for a specific contact, newest first. */
export async function getContactLogs(tableId: string, contactId: string): Promise<ContactLog[]> {
  const res = await fetch(`${DRIZZLE_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId,
      where: { contact_id: contactId },
      orderBy: 'logged_at',
      order: 'desc',
      limit: 100,
    }),
  });
  if (!res.ok) throw new Error('Failed to load contact logs');
  const data = await res.json() as { records: Record<string, unknown>[] };
  return (data.records || []).map(rowToLog);
}

/** Get ALL log entries across all contacts (for analytics). Newest first, up to 5000 rows. */
export async function getAllContactLogs(tableId: string): Promise<ContactLog[]> {
  const res = await fetch(`${DRIZZLE_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId,
      orderBy: 'logged_at',
      order: 'desc',
      limit: 5000,
    }),
  });
  if (!res.ok) throw new Error('Failed to load all contact logs');
  const data = await res.json() as { records: Record<string, unknown>[] };
  return (data.records || []).map(rowToLog);
}

/** Returns the tableId for this user's SMS templates table, creating it if needed. */
export async function ensureSmsTemplatesTable(userId: string): Promise<string> {
  const listRes = await fetch(`${DRIZZLE_BASE}/tables?graphId=${encodeURIComponent(userId)}`);
  if (!listRes.ok) throw new Error('Failed to list user tables');
  const listData = await listRes.json() as { tables: { id: string; displayName: string }[] };
  const existing = listData.tables.find(t => t.displayName === 'sms_templates');
  if (existing) return existing.id;

  const createRes = await fetch(`${DRIZZLE_BASE}/create-table`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId: userId,
      displayName: 'sms_templates',
      columns: SMS_TEMPLATES_COLUMNS,
      createdBy: userId,
    }),
  });
  if (!createRes.ok) throw new Error('Failed to create SMS templates table');
  const createData = await createRes.json() as { id: string };
  return createData.id;
}

function rowToSmsTemplate(row: Record<string, unknown>): SmsTemplate {
  return {
    id: row._id as string,
    name: (row.name as string) || '',
    message: (row.message as string) || '',
  };
}

/** Load all SMS templates for a user. */
export async function getSmsTemplates(tableId: string): Promise<SmsTemplate[]> {
  const res = await fetch(`${DRIZZLE_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId,
      orderBy: 'name',
      limit: 5000,
    }),
  });
  if (!res.ok) throw new Error('Failed to load SMS templates');
  const data = await res.json() as { records: Record<string, unknown>[] };
  return (data.records || []).map(rowToSmsTemplate);
}

/** Save a new SMS template. */
export async function saveSmsTemplate(tableId: string, name: string, message: string): Promise<string> {
  const res = await fetch(`${DRIZZLE_BASE}/insert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId,
      record: { name, message },
    }),
  });
  if (!res.ok) throw new Error('Failed to save SMS template');
  const data = await res.json() as { _id: string };
  return data._id;
}

/** Delete an SMS template. */
export async function deleteSmsTemplate(tableId: string, templateId: string): Promise<void> {
  const res = await fetch(`${DRIZZLE_BASE}/delete-records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId, ids: [templateId] }),
  });
  if (!res.ok) throw new Error('Failed to delete SMS template');
}

/** Returns the tableId for this user's e-mail templates table, creating it if needed. */
export async function ensureEmailTemplatesTable(userId: string): Promise<string> {
  const listRes = await fetch(`${DRIZZLE_BASE}/tables?graphId=${encodeURIComponent(userId)}`);
  if (!listRes.ok) throw new Error('Failed to list user tables');
  const listData = await listRes.json() as { tables: { id: string; displayName: string }[] };
  const existing = listData.tables.find(t => t.displayName === 'email_templates');
  if (existing) return existing.id;

  const createRes = await fetch(`${DRIZZLE_BASE}/create-table`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId: userId,
      displayName: 'email_templates',
      columns: EMAIL_TEMPLATES_COLUMNS,
      createdBy: userId,
    }),
  });
  if (!createRes.ok) throw new Error('Failed to create e-mail templates table');
  const createData = await createRes.json() as { id: string };
  return createData.id;
}

/** Load all e-mail templates for a user. */
export async function getEmailTemplates(tableId: string): Promise<EmailTemplate[]> {
  const res = await fetch(`${DRIZZLE_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId, orderBy: 'name', limit: 5000 }),
  });
  if (!res.ok) throw new Error('Failed to load e-mail templates');
  const data = await res.json() as { records: Record<string, unknown>[] };
  return (data.records || []).map(row => ({
    id: row._id as string,
    name: (row.name as string) || '',
    subject: (row.subject as string) || '',
    message: (row.message as string) || '',
  }));
}

/** Save a new e-mail template. drizzle /insert takes ONE `record` and returns `_id`. */
export async function saveEmailTemplate(tableId: string, name: string, subject: string, message: string): Promise<string> {
  const res = await fetch(`${DRIZZLE_BASE}/insert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId, record: { name, subject, message } }),
  });
  if (!res.ok) throw new Error('Failed to save e-mail template');
  const data = await res.json() as { _id: string };
  return data._id;
}

/** Delete an e-mail template. */
export async function deleteEmailTemplate(tableId: string, templateId: string): Promise<void> {
  const res = await fetch(`${DRIZZLE_BASE}/delete-records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId, ids: [templateId] }),
  });
  if (!res.ok) throw new Error('Failed to delete e-mail template');
}
