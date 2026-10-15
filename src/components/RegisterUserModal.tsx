import { useState } from 'react';
import { Contact } from '../types';
import { getApiToken } from '../lib/auth';

// Registers a contact as a Vegvisr platform user (a row in the config table).
//
// It calls the same door the Vegvisr MCP tool register_user uses: POST
// agent.vegvisr.org/admin/register-user, authenticated with X-API-Token. The worker resolves the
// caller from that token and requires Superadmin, so the check is never this app's. An email that
// is already registered is NOT overwritten: the worker only fills in the fields supplied here and
// leaves role and login token alone (it says so in its reply message). No sign-in mail is sent.
const REGISTER_URL = 'https://agent.vegvisr.org/admin/register-user';

// Google Contacts exports numbers in many shapes ("930 71 813", "+47 930 71 813", "0047…").
// The platform wants +47XXXXXXXX for SMS sign-in; a bare 8-digit number is taken as Norwegian.
export function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-().]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (/^\d{8}$/.test(p)) p = '+47' + p;
  if (/^47\d{8}$/.test(p)) p = '+' + p;
  return p;
}

type Result = { ok: boolean; message: string };

export function RegisterUserModal({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const [name, setName] = useState(contact.fullName || '');
  const [email, setEmail] = useState(contact.emails?.[0]?.value || '');
  const [phone, setPhone] = useState(contact.phones?.[0]?.value ? normalizePhone(contact.phones[0].value) : '');
  const [role, setRole] = useState<'Admin' | 'user' | 'Subscriber'>('Admin');
  const [groupTags, setGroupTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const addr = contact.addresses?.[0];

  const submit = async () => {
    const token = getApiToken();
    if (!token) { setResult({ ok: false, message: 'Not signed in — no API token.' }); return; }
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch(REGISTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          phone: phone.trim() || undefined,
          role,
          // Omitted when empty: on an existing user a supplied value REPLACES their tags.
          group_tags: groupTags.trim() || undefined,
          street: addr?.street || undefined,
          postal_code: addr?.postalCode || undefined,
          city: addr?.city || undefined,
          country: addr?.country || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setResult({ ok: false, message: data.error || `HTTP ${res.status}` });
      } else {
        setResult({ ok: true, message: data.message || `Registered ${data.email}` });
      }
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const input = 'w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]';
  const label = 'block text-xs font-semibold text-[#6B7280] mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="fixed inset-0 bg-black/50" onClick={() => !saving && onClose()} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <h3 className="text-lg font-bold text-[#111827]">Register as Vegvisr user</h3>
        <p className="text-xs text-[#6B7280] mt-1 mb-5">
          Creates an account in the platform user table. An email that already exists is only completed with the fields below — its role is not changed. No sign-in mail is sent.
        </p>

        <div className="space-y-4">
          <div>
            <label className={label} htmlFor="ru-name">Name</label>
            <input id="ru-name" className={input} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="ru-email">Email</label>
            {contact.emails && contact.emails.length > 1 ? (
              <select id="ru-email" className={input} value={email} onChange={e => setEmail(e.target.value)}>
                {contact.emails.map(e => <option key={e.value} value={e.value}>{e.value}{e.label ? ` (${e.label})` : ''}</option>)}
              </select>
            ) : (
              <input id="ru-email" className={input} value={email} onChange={e => setEmail(e.target.value)} />
            )}
          </div>
          <div>
            <label className={label} htmlFor="ru-phone">Mobile (+47…)</label>
            <input id="ru-phone" className={input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="Optional — needed for SMS sign-in" />
          </div>
          <div>
            <label className={label} htmlFor="ru-role">Role</label>
            <select id="ru-role" className={input} value={role} onChange={e => setRole(e.target.value as typeof role)}>
              <option value="Admin">Admin (ordinary member)</option>
              <option value="user">user</option>
              <option value="Subscriber">Subscriber</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="ru-tags">Group tags</label>
            <input id="ru-tags" className={input} value={groupTags} onChange={e => setGroupTags(e.target.value)} placeholder="Optional, e.g. #IIBA #DEMO" />
          </div>
          {addr && (addr.street || addr.city) && (
            <p className="text-xs text-[#6B7280]">
              Address sent along: {[addr.street, addr.postalCode, addr.city, addr.country].filter(Boolean).join(', ')}
            </p>
          )}
        </div>

        {result && (
          <div className={`mt-5 p-3 rounded-lg text-sm ${result.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
            {result.message}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-[#4B5563] hover:bg-[#F3F4F6] disabled:opacity-50">
            {result?.ok ? 'Close' : 'Cancel'}
          </button>
          {!result?.ok && (
            <button
              type="button"
              onClick={submit}
              disabled={saving || !email.trim()}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-50"
            >
              {saving ? 'Registering…' : 'Register user'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
