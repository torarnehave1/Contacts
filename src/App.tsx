import React, { useState, useMemo, useRef, useEffect, useContext, createContext, ChangeEvent } from 'react';
import {
  Search,
  Plus,
  Upload,
  User,
  Mail,
  Phone,
  MapPin,
  Briefcase,
  Globe,
  Trash2,
  Filter,
  X,
  ChevronRight,
  ExternalLink,
  Calendar,
  FileText,
  Menu,
  MoreVertical,
  Check,
  Tag,
  MessageSquare,
  Clock,
  Mic,
  MicOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AuthBar, EcosystemNav } from 'vegvisr-ui-kit';
import { Contact, ContactLog } from './types';
import { parseGoogleContactsCSV } from './utils/csvParser';
import { parseICalFile, findContactByEmail, type ParsedEvent } from './utils/icalParser';
import { readStoredUser, type AuthUser } from './lib/auth';
import { ensureContactsTable, loadContacts, bulkInsertContacts, deleteContact, deleteAllContacts, updateContact, ensureContactLogTable, addContactLog, getContactLogs, deleteContactLog } from './lib/drizzle';

const MAGIC_BASE = 'https://cookie.vegvisr.org';
const DASHBOARD_BASE = 'https://dashboard.vegvisr.org';

const AuthContext = createContext<AuthUser | null>(null);

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Auth wrapper ────────────────────────────────────────────────────────────

function AuthGate({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<'checking' | 'authed' | 'anonymous'>('checking');
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginStatus, setLoginStatus] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const setAuthCookie = (token: string) => {
    if (!token) return;
    const isVegvisr = window.location.hostname.endsWith('vegvisr.org');
    const domain = isVegvisr ? '; Domain=.vegvisr.org' : '';
    const maxAge = 60 * 60 * 24 * 30;
    document.cookie = `vegvisr_token=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure${domain}`;
  };

  const persistUser = (user: {
    email: string;
    role: string;
    user_id: string | null;
    emailVerificationToken: string | null;
    oauth_id?: string | null;
  }) => {
    const payload = {
      email: user.email,
      role: user.role,
      user_id: user.user_id,
      oauth_id: user.oauth_id || user.user_id || null,
      emailVerificationToken: user.emailVerificationToken,
    };
    localStorage.setItem('user', JSON.stringify(payload));
    if (user.emailVerificationToken) setAuthCookie(user.emailVerificationToken);
    sessionStorage.setItem('email_session_verified', '1');
    setAuthUser({
      userId: payload.user_id || payload.oauth_id || '',
      email: payload.email,
      role: payload.role || null,
    });
  };

  const fetchUserContext = async (targetEmail: string) => {
    const roleRes = await fetch(`${DASHBOARD_BASE}/get-role?email=${encodeURIComponent(targetEmail)}`);
    if (!roleRes.ok) throw new Error(`User role unavailable (status: ${roleRes.status})`);
    const roleData = await roleRes.json();
    if (!roleData?.role) throw new Error('Unable to retrieve user role.');
    const userDataRes = await fetch(`${DASHBOARD_BASE}/userdata?email=${encodeURIComponent(targetEmail)}`);
    if (!userDataRes.ok) throw new Error(`Unable to fetch user data (status: ${userDataRes.status})`);
    const userData = await userDataRes.json();
    return {
      email: targetEmail,
      role: roleData.role,
      user_id: userData.user_id,
      emailVerificationToken: userData.emailVerificationToken,
      oauth_id: userData.oauth_id,
    };
  };

  const verifyMagicToken = async (token: string) => {
    const res = await fetch(`${MAGIC_BASE}/login/magic/verify?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok || !data.success || !data.email) throw new Error(data.error || 'Invalid or expired magic link.');
    try {
      const userContext = await fetchUserContext(data.email);
      persistUser(userContext);
    } catch {
      persistUser({ email: data.email, role: 'user', user_id: data.email, emailVerificationToken: null });
    }
  };

  const sendMagicLink = async () => {
    if (!loginEmail.trim()) return;
    setLoginError('');
    setLoginStatus('');
    setLoginLoading(true);
    try {
      const redirectUrl = `${window.location.origin}${window.location.pathname}`;
      const res = await fetch(`${MAGIC_BASE}/login/magic/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), redirectUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to send magic link.');
      setLoginStatus('Magic link sent. Check your email.');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Failed to send magic link.');
    } finally {
      setLoginLoading(false);
    }
  };

  const clearAuthCookie = () => {
    const base = 'vegvisr_token=; Path=/; Max-Age=0; SameSite=Lax; Secure';
    document.cookie = base;
    if (window.location.hostname.endsWith('vegvisr.org')) {
      document.cookie = `${base}; Domain=.vegvisr.org`;
    }
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem('user');
      sessionStorage.removeItem('email_session_verified');
    } catch { /* ignore */ }
    clearAuthCookie();
    setAuthUser(null);
    setAuthStatus('anonymous');
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const magic = url.searchParams.get('magic');
    if (!magic) return;
    setAuthStatus('checking');
    verifyMagicToken(magic)
      .then(() => {
        url.searchParams.delete('magic');
        window.history.replaceState({}, '', url.toString());
        setAuthStatus('authed');
      })
      .catch(() => setAuthStatus('anonymous'));
  }, []);

  useEffect(() => {
    let isMounted = true;
    const stored = readStoredUser();
    if (stored && isMounted) {
      setAuthUser(stored);
      setAuthStatus('authed');
    } else if (isMounted) {
      setAuthStatus('anonymous');
    }
    return () => { isMounted = false; };
  }, []);

  if (authStatus === 'authed') {
    return (
      <AuthContext.Provider value={authUser}>
        <div className="flex flex-col h-screen">
          <EcosystemNav className="flex-shrink-0 border-b border-slate-800 bg-slate-900 px-4 py-2" />
          {children}
        </div>
      </AuthContext.Provider>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.25),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(139,92,246,0.25),_transparent_55%)]" />
      <div className="relative px-8 py-6 flex flex-col min-h-screen">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="https://favicons.vegvisr.org/favicons/1773834325586-1-1773834331342-180x180.png" alt="Contacts" className="w-10 h-10 rounded-xl" />
            <span className="text-xl font-bold tracking-tight">Contacts</span>
          </div>
          <AuthBar
            userEmail={undefined}
            badgeLabel="Vegvisr"
            signInLabel="Sign in"
            onSignIn={() => setLoginOpen((prev) => !prev)}
            logoutLabel="Log out"
            onLogout={handleLogout}
          />
        </header>

        <EcosystemNav className="mt-4" />

        {authStatus === 'anonymous' && loginOpen && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-white/80">
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">Magic Link Sign In</div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMagicLink()}
                placeholder="you@email.com"
                className="flex-1 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-sky-500/60"
              />
              <button
                type="button"
                onClick={sendMagicLink}
                disabled={loginLoading}
                className="rounded-2xl bg-gradient-to-r from-sky-500 to-violet-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 disabled:opacity-60"
              >
                {loginLoading ? 'Sending...' : 'Send link'}
              </button>
            </div>
            {loginStatus && <p className="mt-3 text-xs text-emerald-300">{loginStatus}</p>}
            {loginError && <p className="mt-3 text-xs text-rose-300">{loginError}</p>}
            <p className="mt-3 text-xs text-white/50">We will send a secure link that logs you in.</p>
          </div>
        )}

        {authStatus === 'checking' && (
          <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-white/70">
            Checking session...
          </div>
        )}

        {authStatus === 'anonymous' && !loginOpen && (
          <div className="mt-10 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-6 py-4 text-sm text-rose-100">
            You are not signed in. Click "Sign in" to continue.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main contacts app ───────────────────────────────────────────────────────

function ContactsApp() {
  const authUser = useContext(AuthContext);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tableId, setTableId] = useState<string | null>(null);
  const [dbLoading, setDbLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const [newLabelInput, setNewLabelInput] = useState('');
  const [labelActionLoading, setLabelActionLoading] = useState(false);

  // Interaction log state
  const [logTableId, setLogTableId] = useState<string | null>(null);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [isLogHistoryOpen, setIsLogHistoryOpen] = useState(false);
  const [logContact, setLogContact] = useState<Contact | null>(null);
  const [logType, setLogType] = useState('');
  const [logNotes, setLogNotes] = useState('');
  const [logSubmitting, setLogSubmitting] = useState(false);
  const [contactLogs, setContactLogs] = useState<ContactLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null); // R2 URL after upload

  // Edit contact state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  // iCal import state
  const [isICalImportOpen, setIsICalImportOpen] = useState(false);
  const [icalEvents, setICalEvents] = useState<ParsedEvent[]>([]);
  const [icalLoading, setICalLoading] = useState(false);
  const [icalError, setICalError] = useState<string | null>(null);
  const [selectedEventsToImport, setSelectedEventsToImport] = useState<Set<string>>(new Set());
  const [recordingStatus, setRecordingStatus] = useState('');
  const [uploading, setUploading] = useState(false);
  const [transcribingLogId, setTranscribingLogId] = useState<string | null>(null);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());

  // Recently used contacts — persisted to localStorage
  const [recentContacts, setRecentContacts] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('contacts_recent') || '{}'); } catch { return {}; }
  });
  const markRecent = (contactId: string) => {
    setRecentContacts(prev => {
      const next = { ...prev, [contactId]: Date.now() };
      try { localStorage.setItem('contacts_recent', JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioBlobRef = useRef<Blob | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  // Initialize: ensure tables exist, then load contacts
  useEffect(() => {
    if (!authUser?.userId) return;
    setDbLoading(true);
    setDbError(null);
    Promise.all([
      ensureContactsTable(authUser.userId),
      ensureContactLogTable(authUser.userId),
    ])
      .then(([cid, lid]) => {
        setTableId(cid);
        setLogTableId(lid);
        return loadContacts(cid);
      })
      .then(loaded => {
        setContacts(loaded);
        setDbLoading(false);
      })
      .catch(err => {
        setDbError(err instanceof Error ? err.message : 'Failed to load contacts');
        setDbLoading(false);
      });
  }, [authUser?.userId]);

  const handleImport = async () => {
    if (!importText.trim() || !tableId) return;
    setImporting(true);
    try {
      const parsed = parseGoogleContactsCSV(importText);
      const ids = await bulkInsertContacts(tableId, parsed);
      const withIds = parsed.map((c, i) => ({ ...c, id: ids[i] ?? c.id }));
      setContacts(prev => [...prev, ...withIds]);
      setIsImportModalOpen(false);
      setImportText('');
      setError(null);
    } catch {
      setError('Failed to import contacts. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tableId) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      setImporting(true);
      try {
        const parsed = parseGoogleContactsCSV(text);
        const ids = await bulkInsertContacts(tableId, parsed);
        const withIds = parsed.map((c, i) => ({ ...c, id: ids[i] ?? c.id }));
        setContacts(prev => [...prev, ...withIds]);
        setError(null);
      } catch {
        setError('Failed to import CSV file.');
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(file);
  };

  const handleDeleteContact = async (id: string) => {
    setContacts(prev => prev.filter(c => c.id !== id));
    if (selectedContactId === id) setSelectedContactId(null);
    if (tableId) {
      try { await deleteContact(tableId, id); } catch { /* already removed from UI */ }
    }
  };

  const openEditModal = (contact: Contact) => {
    setEditingContact({ ...contact });
    setIsEditModalOpen(true);
  };

  const handleSaveContact = async () => {
    if (!editingContact || !tableId) return;
    try {
      await updateContact(tableId, editingContact.id, {
        fullName: editingContact.fullName,
        nickname: editingContact.nickname,
        photo: editingContact.photo,
        phones: editingContact.phones,
        emails: editingContact.emails,
        organization: editingContact.organization,
        websites: editingContact.websites,
        addresses: editingContact.addresses,
        birthday: editingContact.birthday,
        notes: editingContact.notes,
        labels: editingContact.labels,
      });
      setContacts(prev => prev.map(c => c.id === editingContact.id ? editingContact : c));
      setIsEditModalOpen(false);
      setEditingContact(null);
    } catch (err) {
      console.error('Failed to save contact:', err);
      setError('Failed to save contact');
    }
  };

  const handleICalFileUpload = async (file: File) => {
    setICalLoading(true);
    setICalError(null);
    try {
      const content = await file.text();
      const events = parseICalFile(content);
      setICalEvents(events);
      setSelectedEventsToImport(new Set(events.map((_, i) => i.toString())));
    } catch (err) {
      setICalError(err instanceof Error ? err.message : 'Failed to parse iCal file');
      setICalEvents([]);
    } finally {
      setICalLoading(false);
    }
  };

  const handleImportSelectedEvents = async () => {
    if (!logTableId || icalEvents.length === 0) return;
    setICalLoading(true);
    try {
      let imported = 0;
      for (const eventIndex of Array.from(selectedEventsToImport).map(Number)) {
        const event = icalEvents[eventIndex];
        if (!event) continue;

        // Try to match attendees to contacts
        for (const attendee of event.attendees) {
          const contactId = findContactByEmail(attendee.email, contacts);
          if (contactId) {
            const contact = contacts.find(c => c.id === contactId);
            if (contact) {
              await addContactLog(
                logTableId,
                contactId,
                contact.fullName,
                'Meeting',
                `${event.summary}\n\n${event.description || ''}`.trim(),
                undefined
              );
              imported++;
            }
          }
        }
      }

      // Refresh logs for selected contact
      if (selectedContactId) {
        const logs = await getContactLogs(logTableId, selectedContactId);
        setContactLogs(logs);
      }

      setError(null);
      setIsICalImportOpen(false);
      setICalEvents([]);
      setSelectedEventsToImport(new Set());
      alert(`Imported ${imported} meeting logs`);
    } catch (err) {
      console.error('Failed to import events:', err);
      setICalError(err instanceof Error ? err.message : 'Failed to import events');
    } finally {
      setICalLoading(false);
    }
  };

  const handleDeleteLog = async (logId: string) => {
    setContactLogs(prev => prev.filter(l => l.id !== logId));
    if (logTableId) {
      try { await deleteContactLog(logTableId, logId); } catch { /* already removed from UI */ }
    }
  };

  const handleClearAll = async () => {
    setContacts([]);
    setSelectedContactId(null);
    setActiveLabel(null);
    setSelectedIds(new Set());
    if (tableId) {
      try { await deleteAllContacts(tableId); } catch { /* best-effort */ }
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setLabelPickerOpen(false);
  };

  const toggleSelectAll = (filtered: Contact[]) => {
    const allSel = filtered.length > 0 && filtered.every(c => selectedIds.has(c.id));
    if (allSel) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(c => c.id)));
    }
    setLabelPickerOpen(false);
  };

  const applyLabel = async (label: string) => {
    const trimmed = label.trim();
    if (!trimmed || !tableId || selectedIds.size === 0) return;
    setLabelActionLoading(true);
    try {
      await Promise.all([...selectedIds].map(async id => {
        const contact = contacts.find(c => c.id === id);
        if (!contact) return;
        if (contact.labels.includes(trimmed)) return;
        const newLabels = [...contact.labels, trimmed];
        await updateContact(tableId, id, { labels: JSON.stringify(newLabels) });
        setContacts(prev => prev.map(c => c.id === id ? { ...c, labels: newLabels } : c));
        markRecent(id);
      }));
      setLabelPickerOpen(false);
      setNewLabelInput('');
      setSelectedIds(new Set());
    } catch {
      setError('Failed to apply label. Please try again.');
    } finally {
      setLabelActionLoading(false);
    }
  };

  // ─── Log modal handlers ──────────────────────────────────────────────────────

  const openLogModal = (contact: Contact) => {
    setLogContact(contact);
    setLogType('');
    setLogNotes('');
    setAudioUrl(null);
    setRecordingUrl(null);
    setRecordingStatus('');
    audioBlobRef.current = null;
    setIsLogModalOpen(true);
  };

  const closeLogModal = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setRecordingUrl(null);
    setAudioUrl(null);
    setIsLogModalOpen(false);
  };

  const submitLog = async () => {
    if (!logContact || !logTableId || !logType) return;
    setLogSubmitting(true);
    try {
      await addContactLog(logTableId, logContact.id, logContact.fullName, logType, logNotes, recordingUrl ?? undefined);
      markRecent(logContact.id);
      closeLogModal();
    } catch {
      setError('Failed to save log entry. Please try again.');
    } finally {
      setLogSubmitting(false);
    }
  };

  const openLogHistory = async (contact: Contact) => {
    if (!logTableId) return;
    setLogContact(contact);
    setIsLogHistoryOpen(true);
    setLogsLoading(true);
    try {
      const logs = await getContactLogs(logTableId, contact.id);
      setContactLogs(logs);
    } catch {
      setContactLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  // ─── Voice recording handlers ────────────────────────────────────────────────

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioBlobRef.current = blob;
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
        // Auto-upload to R2
        setUploading(true);
        setRecordingStatus('Uploading...');
        try {
          const fileName = `contact-log-${Date.now()}.webm`;
          const res = await fetch('https://norwegian-transcription-worker.torarnehave.workers.dev/upload', {
            method: 'POST',
            headers: { 'X-File-Name': encodeURIComponent(fileName) },
            body: blob,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json() as { audioUrl?: string };
          setRecordingUrl(data.audioUrl ?? null);
          setRecordingStatus('Recording saved ✓');
        } catch (err) {
          setRecordingStatus('Upload failed — recording not saved');
          setError('Audio upload failed: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
          setUploading(false);
        }
      };
      recorder.start();
      setIsRecording(true);
      setRecordingStatus('Recording...');
    } catch (err) {
      setError('Microphone access denied: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  // Transcribe a saved recording via OpenAI Whisper (on demand)
  const transcribeLogEntry = async (log: ContactLog) => {
    if (!log.recording_url || !logTableId) return;
    setTranscribingLogId(log.id);
    try {
      // 1. Fetch the audio blob from R2
      const audioRes = await fetch(log.recording_url);
      if (!audioRes.ok) throw new Error(`Could not download audio (${audioRes.status})`);
      const audioBlob = await audioRes.blob();

      // 2. POST as FormData to OpenAI Whisper via openai-worker
      const fd = new FormData();
      // Derive a filename from the URL; Whisper needs a recognisable extension
      const ext = log.recording_url.split('?')[0].split('.').pop() || 'webm';
      fd.append('file', audioBlob, `recording.${ext}`);
      fd.append('model', 'whisper-1');
      fd.append('language', 'no');   // Norwegian — improves accuracy
      if (authUser?.userId) fd.append('userId', authUser.userId);

      const res = await fetch('https://openai.vegvisr.org/audio', {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => res.status.toString());
        throw new Error(`Whisper error ${res.status}: ${errText}`);
      }
      const data = await res.json() as { text?: string; transcription?: string };
      const text = data.text || data.transcription || '';
      const updated = log.notes ? log.notes + '\n\n' + text : text;
      // Save back to DB
      await fetch('https://drizzle.vegvisr.org/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: logTableId, id: log.id, record: { notes: updated } }),
      });
      setContactLogs(prev => prev.map(l => l.id === log.id ? { ...l, notes: updated } : l));
    } catch (err) {
      setError('Transcription failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setTranscribingLogId(null);
    }
  };

  // ─── Photo upload ────────────────────────────────────────────────────────────

  // Direct URL (e.g. dragged from photos app) — no re-upload needed, just store the URL
  const handlePhotoUrl = async (url: string, contactId: string) => {
    if (!tableId) return;
    if (!url.startsWith('http')) return;
    setPhotoUploading(true);
    try {
      await updateContact(tableId, contactId, { photo: url });
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, photo: url } : c));
    } catch (err) {
      setError('Photo update failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setPhotoUploading(false);
    }
  };

  const handlePhotoUpload = async (file: File, contactId: string) => {
    if (!tableId) return;
    if (!file.type.startsWith('image/')) { setError('Please select an image file.'); return; }
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (authUser?.email) fd.append('userEmail', authUser.email);
      const res = await fetch('https://photos-api.vegvisr.org/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { urls: string[] };
      const url = data.urls?.[0];
      if (!url) throw new Error('No URL returned');
      await updateContact(tableId, contactId, { photo: url });
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, photo: url } : c));
    } catch (err) {
      setError('Photo upload failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setPhotoUploading(false);
    }
  };

  // Paste image anywhere when a contact is selected
  useEffect(() => {
    if (!selectedContactId) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) handlePhotoUpload(file, selectedContactId);
          break;
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [selectedContactId, tableId]); // eslint-disable-line react-hooks/exhaustive-deps

  const allLabels = useMemo(() => {
    const labels = new Set<string>();
    contacts.forEach(c => c.labels.forEach(l => labels.add(l)));
    return Array.from(labels).sort();
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    return contacts
      .filter(c => {
        const matchesSearch =
          c.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.emails.some(e => e.value.toLowerCase().includes(searchQuery.toLowerCase())) ||
          c.phones.some(p => p.value.toLowerCase().includes(searchQuery.toLowerCase()));
        const matchesLabel = !activeLabel || c.labels.includes(activeLabel);
        return matchesSearch && matchesLabel;
      })
      .sort((a, b) => {
        const ra = recentContacts[a.id] || 0;
        const rb = recentContacts[b.id] || 0;
        if (ra && rb) return rb - ra;   // both recent → newest first
        if (ra) return -1;              // only a is recent → a floats up
        if (rb) return 1;               // only b is recent → b floats up
        return a.fullName.localeCompare(b.fullName); // neither → alphabetical
      });
  }, [contacts, searchQuery, activeLabel, recentContacts]);

  const selectedContact = contacts.find(c => c.id === selectedContactId);

  return (
    <div className="flex flex-1 overflow-hidden bg-[#F9FAFB] text-[#111827] font-sans">
      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: isSidebarOpen ? 280 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        className="bg-white border-r border-[#E5E7EB] overflow-hidden flex-shrink-0"
      >
        <div className="p-6 h-full flex flex-col">
          <div className="flex items-center gap-3 mb-8">
            <img src="https://favicons.vegvisr.org/favicons/1773834325586-1-1773834331342-180x180.png" alt="Contacts" className="w-10 h-10 rounded-xl" />
            <h1 className="text-xl font-bold tracking-tight">ContactHub</h1>
          </div>

          <div className="space-y-2 mb-8">
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="w-full py-3 px-4 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <Plus size={20} />
              Import Contacts
            </button>
            <button
              type="button"
              onClick={() => setIsICalImportOpen(true)}
              className="w-full py-3 px-4 bg-[#6B7280] hover:bg-[#565E6E] text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <Calendar size={20} />
              Import Calendar
            </button>
          </div>

          <nav className="space-y-1 flex-1 overflow-y-auto">
            <button
              type="button"
              onClick={() => setActiveLabel(null)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors",
                !activeLabel ? "bg-[#F3F4F6] text-[#4F46E5]" : "text-[#6B7280] hover:bg-[#F9FAFB]"
              )}
            >
              <User size={18} />
              All Contacts
              <span className="ml-auto text-xs opacity-60">{contacts.length}</span>
            </button>

            <div className="pt-4 pb-2 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">Labels</div>

            {allLabels.map(label => (
              <button
                type="button"
                key={label}
                onClick={() => setActiveLabel(label)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  activeLabel === label ? "bg-[#F3F4F6] text-[#4F46E5]" : "text-[#6B7280] hover:bg-[#F9FAFB]"
                )}
              >
                <Filter size={18} />
                {label}
                <span className="ml-auto text-xs opacity-60">
                  {contacts.filter(c => c.labels.includes(label)).length}
                </span>
              </button>
            ))}

            {contacts.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 transition-colors mt-4"
              >
                <Trash2 size={18} />
                Clear All Contacts
              </button>
            )}
          </nav>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-[#E5E7EB] flex items-center px-6 gap-4 sticky top-0 z-10">
          <button
            type="button"
            aria-label="Toggle sidebar"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-[#F3F4F6] rounded-lg text-[#6B7280]"
          >
            <Menu size={20} />
          </button>

          <div className="relative flex-1 max-w-2xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={18} />
            <input
              type="text"
              placeholder="Search contacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#F3F4F6] border-none rounded-xl text-sm focus:ring-2 focus:ring-[#4F46E5] outline-none transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" ref={fileInputRef} aria-label="Upload CSV file" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 hover:bg-[#F3F4F6] rounded-lg text-[#6B7280] flex items-center gap-2 text-sm font-medium"
            >
              <Upload size={18} />
              <span className="hidden sm:inline">Upload CSV</span>
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Contact List */}
          <div className="w-full md:w-[400px] border-r border-[#E5E7EB] bg-white flex flex-col">

            {/* Selection action bar */}
            {selectedIds.size > 0 && (
              <div className="relative border-b border-[#E5E7EB] bg-[#EEF2FF] px-4 py-2 flex items-center gap-3 flex-shrink-0">
                <button
                  type="button"
                  aria-label="Clear selection"
                  onClick={() => { setSelectedIds(new Set()); setLabelPickerOpen(false); }}
                  className="p-1 hover:bg-[#D1D5DB]/40 rounded text-[#4F46E5]"
                >
                  <X size={16} />
                </button>
                <span className="text-sm font-semibold text-[#4F46E5] flex-1">
                  {selectedIds.size} selected
                </span>
                <button
                  type="button"
                  onClick={() => setLabelPickerOpen(p => !p)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#4F46E5] hover:bg-[#4338CA] text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  <Tag size={13} />
                  Add Label
                </button>

                {/* Label picker dropdown */}
                {labelPickerOpen && (
                  <div className="absolute top-full left-0 right-0 z-30 bg-white border border-[#E5E7EB] shadow-xl rounded-b-2xl p-4">
                    <p className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider mb-3">Existing labels</p>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {allLabels.length === 0 && (
                        <span className="text-xs text-[#9CA3AF]">No labels yet</span>
                      )}
                      {allLabels.map(label => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => applyLabel(label)}
                          disabled={labelActionLoading}
                          className="px-3 py-1 bg-[#F3F4F6] hover:bg-[#EEF2FF] hover:text-[#4F46E5] text-[#4B5563] text-xs font-semibold rounded-full transition-colors disabled:opacity-50"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider mb-2">New label</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newLabelInput}
                        onChange={e => setNewLabelInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && applyLabel(newLabelInput)}
                        placeholder="Label name..."
                        className="flex-1 px-3 py-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg text-sm focus:ring-2 focus:ring-[#4F46E5] outline-none"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => applyLabel(newLabelInput)}
                        disabled={!newLabelInput.trim() || labelActionLoading}
                        className="px-4 py-2 bg-[#4F46E5] hover:bg-[#4338CA] text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
                      >
                        {labelActionLoading ? '...' : 'Apply'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Contact list (scrollable) */}
            <div className="flex-1 overflow-y-auto">
              {dbLoading ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center opacity-40">
                  <div className="w-8 h-8 border-2 border-[#4F46E5] border-t-transparent rounded-full animate-spin mb-4" />
                  <p className="text-sm font-medium">Loading contacts...</p>
                </div>
              ) : dbError ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                  <p className="text-sm font-medium text-red-500">{dbError}</p>
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center opacity-40">
                  <User size={48} className="mb-4" />
                  <p className="text-sm font-medium">No contacts found</p>
                  <p className="text-xs mt-1">Import contacts or change your search.</p>
                </div>
              ) : (
                <div className="divide-y divide-[#F3F4F6]">
                  {/* Select all row */}
                  <div className="px-4 py-2 flex items-center gap-3 bg-[#F9FAFB]">
                    <button
                      type="button"
                      aria-label="Select all contacts"
                      onClick={() => toggleSelectAll(filteredContacts)}
                      className={cn(
                        "w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                        filteredContacts.every(c => selectedIds.has(c.id)) && filteredContacts.length > 0
                          ? "bg-[#4F46E5] border-[#4F46E5] text-white"
                          : "border-[#D1D5DB] hover:border-[#4F46E5]"
                      )}
                    >
                      {filteredContacts.every(c => selectedIds.has(c.id)) && filteredContacts.length > 0 && (
                        <Check size={12} />
                      )}
                    </button>
                    <span className="text-xs text-[#9CA3AF] font-medium">
                      Select all ({filteredContacts.length})
                    </span>
                  </div>

                  {(() => {
                    const recentEnd = filteredContacts.findIndex(c => !recentContacts[c.id]);
                    const hasRecent = recentEnd !== 0 && Object.keys(recentContacts).some(id => filteredContacts.find(c => c.id === id));
                    const splitAt = recentEnd === -1 ? filteredContacts.length : recentEnd;
                    return filteredContacts.map((contact, idx) => {
                      const isSelected = selectedIds.has(contact.id);
                      return (
                        <React.Fragment key={contact.id}>
                          {idx === 0 && hasRecent && (
                            <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">Recent</div>
                          )}
                          {hasRecent && idx === splitAt && (
                            <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF] border-t border-[#F3F4F6]">All contacts</div>
                          )}
                          <button
                            type="button"
                            onClick={() => { setSelectedContactId(contact.id); if (searchQuery || activeLabel) markRecent(contact.id); }}
                            className={cn(
                              "w-full p-4 flex items-center gap-4 text-left transition-all hover:bg-[#F9FAFB]",
                              selectedContactId === contact.id && !isSelected && "bg-[#F3F4F6] border-l-4 border-l-[#4F46E5]",
                              isSelected && "bg-[#EEF2FF]"
                            )}
                          >
                            <div
                              onClick={e => toggleSelect(contact.id, e)}
                              className={cn(
                                "w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg overflow-hidden flex-shrink-0 cursor-pointer transition-colors",
                                isSelected
                                  ? "bg-[#4F46E5] text-white"
                                  : "bg-[#EEF2FF] text-[#4F46E5] hover:bg-[#C7D2FE]"
                              )}
                            >
                              {isSelected ? (
                                <Check size={22} />
                              ) : contact.photo ? (
                                <img src={contact.photo} alt={contact.fullName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                contact.fullName.charAt(0).toUpperCase()
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold text-sm truncate">{contact.fullName}</h3>
                              <p className="text-xs text-[#6B7280] truncate">
                                {contact.phones[0]?.value || contact.emails[0]?.value || 'No contact info'}
                              </p>
                            </div>
                            <ChevronRight size={16} className="text-[#D1D5DB]" />
                          </button>
                        </React.Fragment>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Contact Detail */}
          <div className="hidden md:flex flex-1 bg-white overflow-y-auto">
            <AnimatePresence mode="wait">
              {selectedContact ? (
                <motion.div
                  key={selectedContact.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="w-full max-w-3xl mx-auto p-12"
                >
                  <div className="flex items-start justify-between mb-12">
                    <div className="flex items-center gap-8">
                      <div
                        className="relative w-32 h-32 rounded-3xl bg-[#EEF2FF] flex items-center justify-center text-[#4F46E5] font-bold text-4xl overflow-hidden shadow-lg border-4 border-white cursor-pointer group"
                        onClick={() => photoInputRef.current?.click()}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault();
                          const file = e.dataTransfer.files[0];
                          if (file) { handlePhotoUpload(file, selectedContact.id); return; }
                          // Cross-tab drop from photos app — URL in text/uri-list
                          const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
                          if (url) handlePhotoUrl(url, selectedContact.id);
                        }}
                        title="Click, drag & drop, or paste an image"
                      >
                        {photoUploading ? (
                          <div className="w-8 h-8 border-2 border-[#4F46E5] border-t-transparent rounded-full animate-spin" />
                        ) : selectedContact.photo ? (
                          <img src={selectedContact.photo} alt={selectedContact.fullName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          selectedContact.fullName.charAt(0).toUpperCase()
                        )}
                        {!photoUploading && (
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                            <Upload size={20} className="text-white" />
                            <span className="text-white text-[10px] font-semibold text-center leading-tight px-1">Click, drop<br/>or paste</span>
                          </div>
                        )}
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        ref={photoInputRef}
                        aria-label="Upload contact photo"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f, selectedContact.id); e.target.value = ''; }}
                      />
                      <div>
                        <h2 className="text-3xl font-bold tracking-tight mb-2">{selectedContact.fullName}</h2>
                        {selectedContact.nickname && (
                          <p className="text-lg text-[#6B7280] mb-4">"{selectedContact.nickname}"</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {selectedContact.labels.map(label => (
                            <span key={label} className="px-3 py-1 bg-[#F3F4F6] text-[#4B5563] text-xs font-semibold rounded-full uppercase tracking-wider">
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openLogModal(selectedContact)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-lg text-sm font-medium transition-colors"
                        title="Log Interaction"
                      >
                        <MessageSquare size={16} />
                        <span className="hidden sm:inline">Log</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openLogHistory(selectedContact)}
                        className="p-2 hover:bg-[#F3F4F6] rounded-lg text-[#6B7280] transition-colors"
                        title="View Log History"
                      >
                        <Clock size={20} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(selectedContact)}
                        className="p-2 hover:bg-blue-50 hover:text-blue-600 rounded-lg text-[#6B7280] transition-colors"
                        title="Edit Contact"
                      >
                        <FileText size={20} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteContact(selectedContact.id)}
                        className="p-2 hover:bg-red-50 hover:text-red-600 rounded-lg text-[#6B7280] transition-colors"
                        title="Delete Contact"
                      >
                        <Trash2 size={20} />
                      </button>
                      <button type="button" aria-label="More options" className="p-2 hover:bg-[#F3F4F6] rounded-lg text-[#6B7280]">
                        <MoreVertical size={20} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    <div className="space-y-10">
                      <section>
                        <h4 className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-6">Contact Information</h4>
                        <div className="space-y-6">
                          {selectedContact.phones.map((phone, i) => (
                            <div key={i} className="flex items-center gap-4 group">
                              <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors">
                                <Phone size={18} />
                              </div>
                              <div>
                                <p className="text-sm font-semibold">{phone.value}</p>
                                <p className="text-xs text-[#9CA3AF]">{phone.label}</p>
                              </div>
                            </div>
                          ))}
                          {selectedContact.emails.map((email, i) => (
                            <div key={i} className="flex items-center gap-4 group">
                              <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors">
                                <Mail size={18} />
                              </div>
                              <div>
                                <p className="text-sm font-semibold">{email.value}</p>
                                <p className="text-xs text-[#9CA3AF]">{email.label}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>

                      {(selectedContact.organization.name || selectedContact.organization.title) && (
                        <section>
                          <h4 className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-6">Work</h4>
                          <div className="flex items-center gap-4 group">
                            <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors">
                              <Briefcase size={18} />
                            </div>
                            <div>
                              <p className="text-sm font-semibold">
                                {selectedContact.organization.title}
                                {selectedContact.organization.name && ` at ${selectedContact.organization.name}`}
                              </p>
                              <p className="text-xs text-[#9CA3AF]">{selectedContact.organization.department || 'Organization'}</p>
                            </div>
                          </div>
                        </section>
                      )}

                      {selectedContact.websites.length > 0 && (
                        <section>
                          <h4 className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-6">Websites</h4>
                          <div className="space-y-4">
                            {selectedContact.websites.map((site, i) => (
                              <a
                                key={i}
                                href={site.value.startsWith('http') ? site.value : `https://${site.value}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-4 group hover:opacity-80 transition-opacity"
                              >
                                <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors">
                                  <Globe size={18} />
                                </div>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold">{site.value}</p>
                                  <ExternalLink size={14} className="text-[#9CA3AF]" />
                                </div>
                              </a>
                            ))}
                          </div>
                        </section>
                      )}
                    </div>

                    <div className="space-y-10">
                      {selectedContact.addresses.length > 0 && (
                        <section>
                          <h4 className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-6">Addresses</h4>
                          <div className="space-y-6">
                            {selectedContact.addresses.map((addr, i) => (
                              <div key={i} className="flex items-start gap-4 group">
                                <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors flex-shrink-0">
                                  <MapPin size={18} />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold whitespace-pre-line">{addr.formatted}</p>
                                  <p className="text-xs text-[#9CA3AF] mt-1">{addr.label}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      {(selectedContact.birthday || selectedContact.notes) && (
                        <section>
                          <h4 className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-6">Other Details</h4>
                          <div className="space-y-6">
                            {selectedContact.birthday && (
                              <div className="flex items-center gap-4 group">
                                <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors">
                                  <Calendar size={18} />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold">{selectedContact.birthday}</p>
                                  <p className="text-xs text-[#9CA3AF]">Birthday</p>
                                </div>
                              </div>
                            )}
                            {selectedContact.notes && (
                              <div className="flex items-start gap-4 group">
                                <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors flex-shrink-0">
                                  <FileText size={18} />
                                </div>
                                <div>
                                  <p className="text-sm text-[#4B5563] leading-relaxed italic">"{selectedContact.notes}"</p>
                                  <p className="text-xs text-[#9CA3AF] mt-1">Notes</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </section>
                      )}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-12 opacity-20">
                  <User size={120} className="mb-6" />
                  <h2 className="text-2xl font-bold">Select a contact</h2>
                  <p className="max-w-xs mt-2">Choose a contact from the list to view their full details.</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Error Notification */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-red-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3"
          >
            <X size={20} className="cursor-pointer" onClick={() => setError(null)} />
            <span className="text-sm font-medium">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Log Interaction Modal */}
      <AnimatePresence>
        {isLogModalOpen && logContact && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeLogModal}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Log Interaction</h2>
                    <p className="text-sm text-[#6B7280] mt-1">{logContact.fullName}</p>
                  </div>
                  <button type="button" aria-label="Close" onClick={closeLogModal} className="p-2 hover:bg-[#F3F4F6] rounded-full text-[#6B7280]">
                    <X size={20} />
                  </button>
                </div>

                {/* Type selector */}
                <div className="mb-5">
                  <label className="block text-xs font-bold text-[#9CA3AF] uppercase tracking-wider mb-2">Interaction Type</label>
                  <div className="flex flex-wrap gap-2">
                    {['Meeting', 'Phone Call', 'Zoom', 'Email', 'Message', 'Note', 'Other'].map(type => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setLogType(type)}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                          logType === type
                            ? "bg-[#4F46E5] text-white"
                            : "bg-[#F3F4F6] text-[#4B5563] hover:bg-[#EEF2FF] hover:text-[#4F46E5]"
                        )}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Notes */}
                <div className="mb-5">
                  <label className="block text-xs font-bold text-[#9CA3AF] uppercase tracking-wider mb-2">Notes</label>
                  <textarea
                    value={logNotes}
                    onChange={e => setLogNotes(e.target.value)}
                    placeholder="Describe the interaction..."
                    rows={4}
                    className="w-full p-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl text-sm focus:ring-2 focus:ring-[#4F46E5] outline-none resize-none"
                  />
                </div>

                {/* Voice recording */}
                <div className="mb-6">
                  <label className="block text-xs font-bold text-[#9CA3AF] uppercase tracking-wider mb-2">Voice Recording</label>
                  <div className="flex items-center gap-3 flex-wrap">
                    {!isRecording ? (
                      <button
                        type="button"
                        onClick={startVoiceRecording}
                        className="flex items-center gap-2 px-4 py-2 bg-[#F3F4F6] hover:bg-[#EEF2FF] text-[#4B5563] hover:text-[#4F46E5] rounded-lg text-sm font-medium transition-colors"
                      >
                        <Mic size={16} />
                        Start Recording
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={stopVoiceRecording}
                        className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors animate-pulse"
                      >
                        <MicOff size={16} />
                        Stop
                      </button>
                    )}
                    {uploading && (
                      <span className="text-xs text-[#9CA3AF] flex items-center gap-1.5">
                        <span className="w-3 h-3 border border-[#4F46E5] border-t-transparent rounded-full animate-spin inline-block" />
                        Uploading...
                      </span>
                    )}
                    {recordingStatus && !uploading && (
                      <span className="text-xs text-[#9CA3AF]">{recordingStatus}</span>
                    )}
                  </div>
                  {audioUrl && (
                    <audio controls src={audioUrl} className="mt-3 w-full h-8" />
                  )}
                  {recordingUrl && (
                    <p className="mt-1 text-xs text-emerald-600">Recording will be saved with this log. Transcription available later from history.</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={closeLogModal}
                    className="flex-1 py-3 px-4 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#4B5563] rounded-xl font-medium transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitLog}
                    disabled={!logType || logSubmitting}
                    className="flex-1 py-3 px-4 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {logSubmitting ? 'Saving...' : 'Save Log'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Log History Modal */}
      <AnimatePresence>
        {isLogHistoryOpen && logContact && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsLogHistoryOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-[#E5E7EB] flex items-center justify-between flex-shrink-0">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Interaction History</h2>
                  <p className="text-sm text-[#6B7280] mt-1">{logContact.fullName}</p>
                </div>
                <button type="button" aria-label="Close" onClick={() => setIsLogHistoryOpen(false)} className="p-2 hover:bg-[#F3F4F6] rounded-full text-[#6B7280]">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                {logsLoading ? (
                  <div className="flex items-center justify-center py-12 opacity-40">
                    <div className="w-6 h-6 border-2 border-[#4F46E5] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : contactLogs.length === 0 ? (
                  <div className="text-center py-12 opacity-40">
                    <Clock size={48} className="mx-auto mb-3" />
                    <p className="text-sm font-medium">No interactions logged yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {contactLogs.map(log => {
                      const typeBg: Record<string, string> = {
                        'Meeting': 'bg-green-500', 'Phone Call': 'bg-blue-500', 'Zoom': 'bg-sky-500',
                        'Email': 'bg-orange-500', 'Message': 'bg-purple-500', 'Note': 'bg-amber-700', 'Other': 'bg-slate-500',
                      };
                      const badgeCls = typeBg[log.contact_type] ?? 'bg-slate-500';
                      const dt = log.logged_at ? new Date(log.logged_at).toLocaleString() : '';
                      return (
                        <div key={log.id} className="border border-[#E5E7EB] rounded-2xl p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className={cn("text-xs font-bold px-2.5 py-1 rounded-full text-white", badgeCls)}>
                              {log.contact_type}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-[#9CA3AF]">{dt}</span>
                              <button
                                type="button"
                                onClick={() => handleDeleteLog(log.id)}
                                className="text-[#9CA3AF] hover:text-rose-500 transition-colors"
                                title="Delete interaction"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                                  <path d="M10 11v6M14 11v6" />
                                  <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                                </svg>
                              </button>
                            </div>
                          </div>
                          {log.notes && (() => {
                            const isExpanded = expandedLogIds.has(log.id);
                            const toggle = () => setExpandedLogIds(prev => {
                              const next = new Set(prev);
                              isExpanded ? next.delete(log.id) : next.add(log.id);
                              return next;
                            });
                            const preview = log.notes.slice(0, 120) + (log.notes.length > 120 ? '…' : '');
                            return (
                              <div>
                                <p className="text-sm text-[#4B5563] whitespace-pre-wrap leading-relaxed">
                                  {isExpanded ? log.notes : preview}
                                </p>
                                {log.notes.length > 120 && (
                                  <button
                                    type="button"
                                    onClick={toggle}
                                    className="mt-1 text-xs text-[#4F46E5] hover:underline font-medium"
                                  >
                                    {isExpanded ? 'Show less' : 'Show more'}
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                          {log.recording_url && (
                            <div className="mt-3 space-y-2">
                              <audio controls src={log.recording_url} className="w-full h-8" />
                              <button
                                type="button"
                                onClick={() => transcribeLogEntry(log)}
                                disabled={transcribingLogId === log.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F3F4F6] hover:bg-[#EEF2FF] text-[#4B5563] hover:text-[#4F46E5] rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                              >
                                <Mic size={13} />
                                {transcribingLogId === log.id ? 'Transcribing...' : 'Transcribe to notes'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Contact Modal */}
      <AnimatePresence>
        {isEditModalOpen && editingContact && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditModalOpen(false)}
              className="fixed inset-0 bg-black/50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto"
            >
              <div className="sticky top-0 bg-white border-b border-[#E5E7EB] px-6 py-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-[#1F2937]">Edit Contact</h2>
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="p-1 hover:bg-[#F3F4F6] rounded-lg text-[#6B7280]"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Full Name */}
                <div>
                  <label htmlFor="edit-fullname" className="block text-sm font-semibold text-[#1F2937] mb-2">Full Name</label>
                  <input
                    id="edit-fullname"
                    type="text"
                    placeholder="Full name"
                    value={editingContact.fullName}
                    onChange={e => setEditingContact({ ...editingContact, fullName: e.target.value })}
                    className="w-full px-4 py-2 border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
                  />
                </div>

                {/* Nickname */}
                <div>
                  <label htmlFor="edit-nickname" className="block text-sm font-semibold text-[#1F2937] mb-2">Nickname</label>
                  <input
                    id="edit-nickname"
                    type="text"
                    placeholder="Nickname"
                    value={editingContact.nickname || ''}
                    onChange={e => setEditingContact({ ...editingContact, nickname: e.target.value })}
                    className="w-full px-4 py-2 border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
                  />
                </div>

                {/* Emails */}
                <div>
                  <label className="block text-sm font-semibold text-[#1F2937] mb-2">Emails</label>
                  <div className="space-y-2">
                    {editingContact.emails.map((email, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          type="email"
                          placeholder="Email address"
                          value={email.value}
                          onChange={e => {
                            const newEmails = [...editingContact.emails];
                            newEmails[i] = { ...newEmails[i], value: e.target.value };
                            setEditingContact({ ...editingContact, emails: newEmails });
                          }}
                          className="flex-1 px-4 py-2 border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
                        />
                        <button
                          type="button"
                          onClick={() => setEditingContact({
                            ...editingContact,
                            emails: editingContact.emails.filter((_, idx) => idx !== i)
                          })}
                          className="p-2 hover:bg-red-50 hover:text-red-600 rounded-lg text-[#6B7280]"
                          title="Delete email"
                          aria-label="Delete email"
                        >
                          <X size={20} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setEditingContact({ ...editingContact, emails: [...editingContact.emails, { label: 'work', value: '' }] })}
                      className="text-sm text-[#4F46E5] hover:underline font-medium"
                    >
                      + Add Email
                    </button>
                  </div>
                </div>

                {/* Phones */}
                <div>
                  <label className="block text-sm font-semibold text-[#1F2937] mb-2">Phones</label>
                  <div className="space-y-2">
                    {editingContact.phones.map((phone, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          type="tel"
                          placeholder="Phone number"
                          value={phone.value}
                          onChange={e => {
                            const newPhones = [...editingContact.phones];
                            newPhones[i] = { ...newPhones[i], value: e.target.value };
                            setEditingContact({ ...editingContact, phones: newPhones });
                          }}
                          className="flex-1 px-4 py-2 border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
                        />
                        <button
                          type="button"
                          onClick={() => setEditingContact({
                            ...editingContact,
                            phones: editingContact.phones.filter((_, idx) => idx !== i)
                          })}
                          className="p-2 hover:bg-red-50 hover:text-red-600 rounded-lg text-[#6B7280]"
                          title="Delete phone"
                          aria-label="Delete phone"
                        >
                          <X size={20} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setEditingContact({ ...editingContact, phones: [...editingContact.phones, { label: 'mobile', value: '' }] })}
                      className="text-sm text-[#4F46E5] hover:underline font-medium"
                    >
                      + Add Phone
                    </button>
                  </div>
                </div>

                {/* Organization */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="edit-org" className="block text-sm font-semibold text-[#1F2937] mb-2">Organization</label>
                    <input
                      id="edit-org"
                      type="text"
                      placeholder="Organization"
                      value={editingContact.organization.name || ''}
                      onChange={e => setEditingContact({
                        ...editingContact,
                        organization: { ...editingContact.organization, name: e.target.value }
                      })}
                      className="w-full px-4 py-2 border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-title" className="block text-sm font-semibold text-[#1F2937] mb-2">Title</label>
                    <input
                      id="edit-title"
                      type="text"
                      placeholder="Job title"
                      value={editingContact.organization.title || ''}
                      onChange={e => setEditingContact({
                        ...editingContact,
                        organization: { ...editingContact.organization, title: e.target.value }
                      })}
                      className="w-full px-4 py-2 border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
                    />
                  </div>
                </div>

                {/* Birthday */}
                <div>
                  <label htmlFor="edit-birthday" className="block text-sm font-semibold text-[#1F2937] mb-2">Birthday</label>
                  <input
                    id="edit-birthday"
                    type="date"
                    value={editingContact.birthday || ''}
                    onChange={e => setEditingContact({ ...editingContact, birthday: e.target.value })}
                    className="w-full px-4 py-2 border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label htmlFor="edit-notes" className="block text-sm font-semibold text-[#1F2937] mb-2">Notes</label>
                  <textarea
                    id="edit-notes"
                    placeholder="Add notes about this contact"
                    value={editingContact.notes || ''}
                    onChange={e => setEditingContact({ ...editingContact, notes: e.target.value })}
                    rows={4}
                    className="w-full px-4 py-2 border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
                  />
                </div>

                {/* Buttons */}
                <div className="flex justify-end gap-3 pt-4 border-t">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="px-4 py-2 border border-[#D1D5DB] rounded-lg text-[#4B5563] font-medium hover:bg-[#F3F4F6] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveContact}
                    className="px-4 py-2 bg-[#4F46E5] text-white rounded-lg font-medium hover:bg-[#4338CA] transition-colors"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* iCal Import Modal */}
      <AnimatePresence>
        {isICalImportOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsICalImportOpen(false)}
              className="fixed inset-0 bg-black/50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto"
            >
              <div className="sticky top-0 bg-white border-b border-[#E5E7EB] px-6 py-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-[#1F2937]">Import Calendar Events</h2>
                <button
                  type="button"
                  onClick={() => setIsICalImportOpen(false)}
                  className="p-1 hover:bg-[#F3F4F6] rounded-lg text-[#6B7280]"
                  title="Close"
                  aria-label="Close modal"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {!icalEvents.length ? (
                  <div className="space-y-4">
                    <p className="text-sm text-[#6B7280]">
                      Upload a calendar file (.ics) to import meetings and create contact logs
                    </p>
                    <label className="block">
                      <div className="border-2 border-dashed border-[#D1D5DB] rounded-lg p-6 text-center cursor-pointer hover:border-[#4F46E5] hover:bg-[#F3F4F6] transition-colors">
                        <Upload size={32} className="mx-auto mb-2 text-[#9CA3AF]" />
                        <p className="text-sm font-medium text-[#4B5563]">Choose .ics file</p>
                        <input
                          type="file"
                          accept=".ics,.ical,.ifb,. ifbt"
                          onChange={async (e) => {
                            const file = e.currentTarget.files?.[0];
                            if (file) await handleICalFileUpload(file);
                          }}
                          className="hidden"
                        />
                      </div>
                    </label>
                    {icalError && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                        {icalError}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                      Found {icalEvents.length} events. Select which ones to import:
                    </div>

                    <div className="max-h-96 overflow-y-auto space-y-2">
                      {icalEvents.map((event, i) => {
                        const matchingContacts = event.attendees
                          .map(a => contacts.find(c => c.emails.some(e => e.value.toLowerCase() === a.email.toLowerCase())))
                          .filter(Boolean);

                        return (
                          <label key={i} className="flex gap-3 p-3 border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedEventsToImport.has(i.toString())}
                              onChange={(e) => {
                                const newSelected = new Set(selectedEventsToImport);
                                if (e.target.checked) {
                                  newSelected.add(i.toString());
                                } else {
                                  newSelected.delete(i.toString());
                                }
                                setSelectedEventsToImport(newSelected);
                              }}
                              className="mt-1"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-[#1F2937] text-sm">{event.summary}</p>
                              <p className="text-xs text-[#6B7280]">
                                {event.dateStart.toLocaleDateString()} {event.dateStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                              {matchingContacts.length > 0 && (
                                <p className="text-xs text-[#4F46E5] mt-1">
                                  Matches: {matchingContacts.map(c => c?.fullName).filter(Boolean).join(', ')}
                                </p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t">
                      <button
                        type="button"
                        onClick={() => {
                          setIsICalImportOpen(false);
                          setICalEvents([]);
                          setSelectedEventsToImport(new Set());
                        }}
                        className="px-4 py-2 border border-[#D1D5DB] rounded-lg text-[#4B5563] font-medium hover:bg-[#F3F4F6] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleImportSelectedEvents}
                        disabled={icalLoading || selectedEventsToImport.size === 0}
                        className="px-4 py-2 bg-[#4F46E5] text-white rounded-lg font-medium hover:bg-[#4338CA] disabled:opacity-50 transition-colors"
                      >
                        {icalLoading ? 'Importing...' : `Import ${selectedEventsToImport.size} Events`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Import Modal */}
      <AnimatePresence>
        {isImportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsImportModalOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold tracking-tight">Import Google Contacts</h2>
                  <button type="button" aria-label="Close" onClick={() => setIsImportModalOpen(false)} className="p-2 hover:bg-[#F3F4F6] rounded-full text-[#6B7280]">
                    <X size={20} />
                  </button>
                </div>
                <p className="text-sm text-[#6B7280] mb-6">
                  Paste the content of your Google Contacts CSV export below.
                </p>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="First Name,Middle Name,Last Name,..."
                  className="w-full h-64 p-4 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-xs font-mono focus:ring-2 focus:ring-[#4F46E5] outline-none resize-none mb-6"
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsImportModalOpen(false)}
                    className="flex-1 py-3 px-4 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#4B5563] rounded-xl font-medium transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleImport}
                    disabled={!importText.trim() || importing}
                    className="flex-1 py-3 px-4 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {importing ? 'Importing...' : 'Parse & Import'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <AuthGate>
      <ContactsApp />
    </AuthGate>
  );
}
