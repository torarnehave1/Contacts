import React, { useState } from 'react';
import { X, RefreshCw, CheckCircle, AlertCircle, Calendar, ChevronDown, ChevronRight } from 'lucide-react';
import { addContactLog, checkEventUidExists } from '../lib/drizzle';
import type { Contact } from '../types';

const CALENDAR_WORKER = 'https://calendar-worker.torarnehave.workers.dev';

interface Props {
  logTableId: string;
  contacts: Contact[];
  onClose: () => void;
}

interface SkippedDetail {
  eventName: string;
  startDate: string;
  contactName: string;
}

interface UnmatchedDetail {
  eventName: string;
  startDate: string;
  attendeeEmails: string[];
  reason: 'no_attendees' | 'no_match';
}

interface SyncResult {
  imported: number;
  skipped: number;
  unmatched: number;
  errors: number;
  skippedDetails: SkippedDetail[];
  unmatchedDetails: UnmatchedDetail[];
}

type DaysOption = 30 | 60 | 90 | 180;
type ModeOption = DaysOption | 'next14';

export default function CalendarSyncModal({ logTableId, contacts, onClose }: Props) {
  const [mode, setMode] = useState<ModeOption>(90);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState('');
  const [showSkipped, setShowSkipped] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);

  function getUserEmail(): string | null {
    try {
      const stored = localStorage.getItem('user');
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      return parsed.email || null;
    } catch {
      return null;
    }
  }

  function findContactByEmail(email: string): Contact | null {
    const needle = email.toLowerCase().trim();
    return (
      contacts.find(c =>
        c.emails?.some(e => e.value?.toLowerCase().trim() === needle)
      ) || null
    );
  }

  async function handleSync() {
    const userEmail = getUserEmail();
    if (!userEmail) {
      setError('Could not find your email. Please log in again.');
      return;
    }

    setSyncing(true);
    setError('');
    setResult(null);

    try {
      // Build date range
      let fetchDate: string;
      let fetchDays: number;
      let progressLabel: string;

      if (mode === 'next14') {
        fetchDate = new Date().toISOString().slice(0, 10); // start today
        fetchDays = 14;
        progressLabel = 'Fetching next 14 days of calendar events…';
      } else {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - mode);
        fetchDate = startDate.toISOString().slice(0, 10);
        fetchDays = mode;
        progressLabel = `Fetching ${mode} days of calendar events…`;
      }

      setProgress(progressLabel);

      const resp = await fetch(
        `${CALENDAR_WORKER}/api/calendar/day-view?date=${fetchDate}&days=${fetchDays}`,
        { headers: { 'X-User-Email': userEmail } }
      );

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Calendar worker returned ${resp.status}: ${text}`);
      }

      const data = await resp.json() as { events: Array<{
        id: string;
        summary: string;
        description?: string;
        location?: string;
        start_time: string;
        attendees?: string[];
      }> };

      const events = data.events || [];
      setProgress(`Processing ${events.length} events…`);

      let imported = 0;
      let skipped = 0;
      let unmatched = 0;
      let errors = 0;
      const skippedDetails: SkippedDetail[] = [];
      const unmatchedDetails: UnmatchedDetail[] = [];

      for (const event of events) {
        const attendees = event.attendees || [];
        const startDate = event.start_time
          ? new Date(event.start_time).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          : '';

        if (attendees.length === 0) {
          unmatched++;
          unmatchedDetails.push({ eventName: event.summary || '(no title)', startDate, attendeeEmails: [], reason: 'no_attendees' });
          continue;
        }

        // Match each attendee to a contact, skip own email
        const matches: Contact[] = [];
        const unmatchedEmails: string[] = [];
        for (const email of attendees) {
          if (email.toLowerCase() === userEmail.toLowerCase()) continue;
          const contact = findContactByEmail(email);
          if (contact) matches.push(contact);
          else unmatchedEmails.push(email);
        }

        if (matches.length === 0) {
          unmatched++;
          unmatchedDetails.push({
            eventName: event.summary || '(no title)',
            startDate,
            attendeeEmails: unmatchedEmails,
            reason: 'no_match',
          });
          continue;
        }

        const eventUid = event.id;
        const notes = [
          event.summary,
          event.location ? `📍 ${event.location}` : '',
          event.description || '',
        ].filter(Boolean).join('\n\n');

        const contactType = event.summary?.toLowerCase().includes('1-1') ? 'zoom' : 'Meeting';

        for (const contact of matches) {
          try {
            const alreadyExists = await checkEventUidExists(logTableId, eventUid + ':' + contact.id);
            if (alreadyExists) {
              skipped++;
              skippedDetails.push({
                eventName: event.summary || '(no title)',
                startDate,
                contactName: contact.fullName,
              });
              continue;
            }
            await addContactLog(
              logTableId,
              contact.id,
              contact.fullName,
              contactType,
              notes,
              undefined,
              new Date(event.start_time),
              eventUid + ':' + contact.id,
            );
            imported++;
          } catch {
            errors++;
          }
        }
      }

      setResult({ imported, skipped, unmatched, errors, skippedDetails, unmatchedDetails });
      setProgress('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Calendar size={20} className="text-[#4F46E5]" />
            <h2 className="text-lg font-bold text-[#1F2937]">Sync from Google Calendar</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          <p className="text-sm text-[#6B7280]">
            Fetches your Google Calendar meetings and saves them as interaction logs for matching contacts.
            Already-imported events are skipped automatically.
          </p>

          {/* Date range selector */}
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-2">Date range</label>
            {/* Past options */}
            <div className="flex gap-2 mb-2">
              {([30, 60, 90, 180] as DaysOption[]).map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setMode(d)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                    mode === d
                      ? 'bg-[#4F46E5] text-white border-[#4F46E5]'
                      : 'bg-white text-[#6B7280] border-gray-200 hover:border-[#4F46E5]'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            {/* Future option */}
            <button
              type="button"
              onClick={() => setMode('next14')}
              className={`w-full py-2 rounded-lg text-sm font-medium border transition-all mb-2 ${
                mode === 'next14'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-[#6B7280] border-gray-200 hover:border-emerald-500'
              }`}
            >
              Next 14 days (upcoming)
            </button>
            {/* Date indicator */}
            <div className="flex items-center gap-1.5 text-xs text-[#6B7280] bg-gray-50 rounded-lg px-3 py-2">
              {mode === 'next14' ? (
                <>
                  <span className="font-medium text-[#374151]">
                    {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                  <span className="text-gray-300 mx-0.5">→</span>
                  <span className="font-medium text-[#374151]">
                    {(() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); })()}
                  </span>
                  <span className="ml-auto text-emerald-600 font-medium">upcoming</span>
                </>
              ) : (
                <>
                  <span className="font-medium text-[#374151]">
                    {(() => { const d = new Date(); d.setDate(d.getDate() - (mode as number)); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); })()}
                  </span>
                  <span className="text-gray-300 mx-0.5">→</span>
                  <span className="font-medium text-[#374151]">
                    {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                  <span className="ml-auto text-gray-400">({mode} days)</span>
                </>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Progress */}
          {syncing && progress && (
            <div className="flex items-center gap-2 text-sm text-[#6B7280]">
              <RefreshCw size={16} className="animate-spin text-[#4F46E5]" />
              {progress}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-2">
              <div className="bg-green-50 rounded-xl px-4 py-4 space-y-1">
                <div className="flex items-center gap-2 text-green-700 font-semibold mb-2">
                  <CheckCircle size={16} />
                  Sync complete
                </div>
                <div className="text-sm text-[#374151] space-y-1">
                  <div className="flex justify-between"><span>Imported</span><span className="font-semibold text-green-700">{result.imported}</span></div>

                  {/* Skipped row — clickable if there are details */}
                  <button
                    type="button"
                    onClick={() => result.skippedDetails.length > 0 && setShowSkipped(v => !v)}
                    className={`w-full flex justify-between items-center py-0.5 ${result.skippedDetails.length > 0 ? 'cursor-pointer hover:text-[#4F46E5]' : 'cursor-default'}`}
                  >
                    <span className="flex items-center gap-1">
                      {result.skippedDetails.length > 0 ? (showSkipped ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
                      Already existed (skipped)
                    </span>
                    <span className="font-semibold">{result.skipped}</span>
                  </button>
                  {showSkipped && result.skippedDetails.length > 0 && (
                    <div className="bg-white border border-gray-100 rounded-lg max-h-48 overflow-y-auto text-xs text-[#6B7280] divide-y divide-gray-50">
                      {result.skippedDetails.map((d, i) => (
                        <div key={i} className="px-3 py-2 flex justify-between gap-2">
                          <span className="min-w-0 truncate" title={d.eventName}>{d.eventName}</span>
                          <span className="text-right whitespace-nowrap text-gray-400">{d.contactName} · {d.startDate}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Unmatched row — clickable if there are details */}
                  <button
                    type="button"
                    onClick={() => result.unmatchedDetails.length > 0 && setShowUnmatched(v => !v)}
                    className={`w-full flex justify-between items-center py-0.5 ${result.unmatchedDetails.length > 0 ? 'cursor-pointer hover:text-[#4F46E5]' : 'cursor-default'}`}
                  >
                    <span className="flex items-center gap-1">
                      {result.unmatchedDetails.length > 0 ? (showUnmatched ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
                      No matching contact
                    </span>
                    <span className="font-semibold">{result.unmatched}</span>
                  </button>
                  {showUnmatched && result.unmatchedDetails.length > 0 && (
                    <div className="bg-white border border-gray-100 rounded-lg max-h-48 overflow-y-auto text-xs text-[#6B7280] divide-y divide-gray-50">
                      {result.unmatchedDetails.map((d, i) => (
                        <div key={i} className="px-3 py-2">
                          <div className="flex justify-between gap-2 mb-0.5">
                            <span className="font-medium text-[#374151] min-w-0 truncate" title={d.eventName}>{d.eventName}</span>
                            <span className="whitespace-nowrap text-gray-400">{d.startDate}</span>
                          </div>
                          {d.reason === 'no_attendees' ? (
                            <span className="text-amber-500 italic">No attendees on event</span>
                          ) : (
                            <span className="text-gray-400" title={d.attendeeEmails.join(', ')}>
                              {d.attendeeEmails.slice(0, 2).join(', ')}{d.attendeeEmails.length > 2 ? ` +${d.attendeeEmails.length - 2} more` : ''}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {result.errors > 0 && (
                    <div className="flex justify-between text-red-600"><span>Errors</span><span className="font-semibold">{result.errors}</span></div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-[#6B7280] hover:bg-gray-50 transition-colors"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="flex-1 py-2.5 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {syncing ? <RefreshCw size={16} className="animate-spin" /> : <Calendar size={16} />}
              {syncing ? 'Syncing…' : 'Start Sync'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
