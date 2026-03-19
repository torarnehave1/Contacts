import { Contact, ContactLog } from '../types';

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
];

/** Returns the tableId for this user's contacts table, creating it if needed. */
export async function ensureContactsTable(userId: string): Promise<string> {
  const listRes = await fetch(`${DRIZZLE_BASE}/tables?graphId=${encodeURIComponent(userId)}`);
  if (!listRes.ok) throw new Error('Failed to list user tables');
  const listData = await listRes.json() as { tables: { id: string; displayName: string }[] };
  const existing = listData.tables.find(t => t.displayName === 'contacts');
  if (existing) return existing.id;

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
  };
}

/** Load all contacts for a table. Paginates up to 5000 rows. */
export async function loadContacts(tableId: string): Promise<Contact[]> {
  const res = await fetch(`${DRIZZLE_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId, orderBy: 'full_name', order: 'asc', limit: 5000 }),
  });
  if (!res.ok) throw new Error('Failed to load contacts');
  const data = await res.json() as { records: Record<string, unknown>[] };
  return (data.records || []).map(rowToContact);
}

/** Bulk-insert contacts. Returns the D1-generated IDs in order. */
export async function bulkInsertContacts(tableId: string, contacts: Contact[]): Promise<string[]> {
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
  const res = await fetch(`${DRIZZLE_BASE}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId, id, record }),
  });
  if (!res.ok) throw new Error('Failed to update contact');
}

/** Delete a single contact by its D1 _id. */
export async function deleteContact(tableId: string, contactId: string): Promise<void> {
  const res = await fetch(`${DRIZZLE_BASE}/delete-records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId, ids: [contactId] }),
  });
  if (!res.ok) throw new Error('Failed to delete contact');
}

/** Delete all contacts in the table. */
export async function deleteAllContacts(tableId: string): Promise<void> {
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

const LOG_COLUMNS = [
  { name: 'contact_id', type: 'text', label: 'Contact ID', required: true },
  { name: 'contact_name', type: 'text', label: 'Contact Name' },
  { name: 'contact_type', type: 'text', label: 'Type' },
  { name: 'notes', type: 'text', label: 'Notes' },
  { name: 'logged_at', type: 'text', label: 'Logged At' },
  { name: 'recording_url', type: 'text', label: 'Recording URL' },
];

/** Returns the tableId for this user's contact log table, creating it if needed.
 *  Also ensures the recording_url column exists on older tables. */
export async function ensureContactLogTable(userId: string): Promise<string> {
  const listRes = await fetch(`${DRIZZLE_BASE}/tables?graphId=${encodeURIComponent(userId)}`);
  if (!listRes.ok) throw new Error('Failed to list user tables');
  const listData = await listRes.json() as { tables: { id: string; displayName: string }[] };
  const existing = listData.tables.find(t => t.displayName === 'contact_logs');

  if (existing) {
    // Migrate: add recording_url if it doesn't exist yet (ignore errors — column may already exist)
    // Migrate: add recording_url column only if it doesn't exist yet
    const schemaRes = await fetch(`${DRIZZLE_BASE}/table/${existing.id}`);
    if (schemaRes.ok) {
      const schema = await schemaRes.json() as { columns?: { name: string }[] };
      const hasCol = schema.columns?.some(c => c.name === 'recording_url');
      if (!hasCol) {
        await fetch(`${DRIZZLE_BASE}/add-column`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableId: existing.id, name: 'recording_url', type: 'text', label: 'Recording URL' }),
        }).catch(() => {});
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
        logged_at: new Date().toISOString(),
        ...(recordingUrl ? { recording_url: recordingUrl } : {}),
      },
    }),
  });
  if (!res.ok) throw new Error('Failed to add contact log');
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
