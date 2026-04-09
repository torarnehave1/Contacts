import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  ChevronLeft,
  ChevronRight,
  Globe,
  ExternalLink,
  Users,
} from 'lucide-react';
import {
  format,
  addDays,
  startOfDay,
  parseISO,
  isToday,
  differenceInMinutes,
} from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const CALENDAR_WORKER = 'https://calendar-worker.torarnehave.workers.dev';

// --- Types (same as Calendar app) ---

interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  calendar_id: string;
  calendar_color: string;
  calendar_name: string;
  attendees: string[];
  html_link: string;
}

interface CalendarMeta {
  id: string;
  summary: string;
  backgroundColor: string;
  foregroundColor: string;
  primary: boolean;
}

// --- Helper functions (from Calendar app) ---

const HOUR_HEIGHT = 60;
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;

function eventTopPx(start: Date): number {
  const mins = (start.getHours() - DAY_START_HOUR) * 60 + start.getMinutes();
  return Math.max(0, (mins / 60) * HOUR_HEIGHT);
}

function eventHeightPx(start: Date, end: Date): number {
  const mins = differenceInMinutes(end, start);
  return Math.max(18, (mins / 60) * HOUR_HEIGHT);
}

function darkenHex(hex: string): string {
  try {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, (n >> 16) - 50);
    const g = Math.max(0, ((n >> 8) & 0xff) - 50);
    const b = Math.max(0, (n & 0xff) - 50);
    return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
  } catch { return hex; }
}

function layoutTimedEvents(evts: CalendarEvent[]) {
  const sorted = [...evts].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const cols: CalendarEvent[][] = [];
  const info = new Map<string, { col: number; total: number }>();

  for (const evt of sorted) {
    const s = new Date(evt.start_time);
    const e2 = new Date(evt.end_time);
    let col = 0;
    while (cols[col]?.some(prev => {
      const ps = new Date(prev.start_time);
      const pe = new Date(prev.end_time);
      return s < pe && e2 > ps;
    })) col++;
    if (!cols[col]) cols[col] = [];
    cols[col].push(evt);
    info.set(evt.id, { col, total: col + 1 });
  }

  for (const evt of sorted) {
    const entry = info.get(evt.id)!;
    const s = new Date(evt.start_time);
    const e2 = new Date(evt.end_time);
    let maxCol = entry.col;
    for (let c = 0; c < cols.length; c++) {
      if (cols[c]?.some(prev => {
        const ps = new Date(prev.start_time);
        const pe = new Date(prev.end_time);
        return s < pe && e2 > ps;
      })) maxCol = Math.max(maxCol, c);
    }
    info.set(evt.id, { col: entry.col, total: maxCol + 1 });
  }
  return info;
}

// --- DayView Component (adapted from Calendar app) ---

export const DayView = ({ userEmail }: { userEmail: string }) => {
  const [currentDate, setCurrentDate] = useState<Date>(startOfDay(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<CalendarMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalHours = DAY_END_HOUR - DAY_START_HOUR;

  const fetchDay = async (date: Date) => {
    setLoading(true);
    setError(null);
    const dateStr = format(date, 'yyyy-MM-dd');
    try {
      const res = await fetch(`${CALENDAR_WORKER}/api/calendar/day-view?date=${dateStr}&days=1`, {
        headers: { 'X-User-Email': userEmail },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setEvents([]);
        setCalendars([]);
      } else {
        setEvents(data.events || []);
        setCalendars(data.calendars || []);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Could not load calendar: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDay(currentDate); }, [currentDate]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = (8 - DAY_START_HOUR) * HOUR_HEIGHT;
    }
  }, []);

  const goDay = (delta: number) => setCurrentDate(d => addDays(d, delta));
  const goToday = () => setCurrentDate(startOfDay(new Date()));

  const timedEvents = events.filter(e => !e.all_day && e.start_time && e.start_time.includes('T'));
  const allDayEvents = events.filter(e => e.all_day || !e.start_time?.includes('T'));

  const layout = layoutTimedEvents(timedEvents);

  return (
    <div className="flex flex-col bg-white flex-1" style={{ minHeight: 0 }}>
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm px-4 py-2 flex flex-wrap items-center gap-2">
        <button
          onClick={goToday}
          className="px-3 py-1.5 text-sm font-medium border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
        >
          Today
        </button>
        <button onClick={() => goDay(-1)} className="p-2 hover:bg-slate-100 rounded-full transition-colors" aria-label="Previous day">
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </button>
        <button onClick={() => goDay(1)} className="p-2 hover:bg-slate-100 rounded-full transition-colors" aria-label="Next day">
          <ChevronRight className="w-5 h-5 text-slate-600" />
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('text-xl font-bold', isToday(currentDate) ? 'text-indigo-600' : 'text-slate-900')}>
            {format(currentDate, 'EEEE')}
          </span>
          <span className="text-slate-500 text-base hidden sm:inline">{format(currentDate, 'MMMM d, yyyy')}</span>
          {isToday(currentDate) && (
            <span className="px-2 py-0.5 text-[11px] font-bold bg-indigo-600 text-white rounded-full">Today</span>
          )}
        </div>

        {loading && <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />}

        {calendars.length > 0 && (
          <div className="ml-auto flex items-center gap-3 flex-wrap justify-end max-w-xs">
            {calendars.map(cal => (
              <div key={cal.id} className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cal.backgroundColor }} />
                <span className="text-xs text-slate-500 truncate max-w-[90px]" title={cal.summary}>{cal.summary}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2">{error}</div>
      )}

      {/* All-day events */}
      {allDayEvents.length > 0 && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 flex items-start gap-2 flex-wrap">
          <span className="text-xs text-slate-400 pt-1 w-12 flex-shrink-0">All-day</span>
          {allDayEvents.map(evt => (
            <button
              key={evt.id}
              onClick={() => setSelectedEvent(evt === selectedEvent ? null : evt)}
              className="px-2.5 py-0.5 rounded-full text-white text-xs font-medium truncate max-w-[180px] hover:opacity-90"
              style={{ backgroundColor: evt.calendar_color || '#6366f1' }}
              title={evt.summary}
            >
              {evt.summary}
            </button>
          ))}
        </div>
      )}

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: `${totalHours * HOUR_HEIGHT}px` }}>
          {/* Hour labels */}
          <div className="w-14 flex-shrink-0 relative select-none">
            {Array.from({ length: totalHours }, (_, i) => (
              <div
                key={i}
                className="absolute right-2 text-xs text-slate-400 leading-none"
                style={{ top: `${i * HOUR_HEIGHT - 7}px` }}
              >
                {`${String(DAY_START_HOUR + i).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>

          {/* Event area */}
          <div className="flex-1 relative border-l border-slate-200">
            {Array.from({ length: totalHours }, (_, i) => (
              <React.Fragment key={i}>
                <div className="absolute left-0 right-0 border-t border-slate-100" style={{ top: `${i * HOUR_HEIGHT}px` }} />
                <div className="absolute left-0 right-0 border-t border-slate-50" style={{ top: `${i * HOUR_HEIGHT + HOUR_HEIGHT / 2}px` }} />
              </React.Fragment>
            ))}

            {/* Current-time indicator */}
            {isToday(currentDate) && (() => {
              const now = new Date();
              const mins = (now.getHours() - DAY_START_HOUR) * 60 + now.getMinutes();
              if (mins < 0 || mins > totalHours * 60) return null;
              const top = (mins / 60) * HOUR_HEIGHT;
              return (
                <div className="absolute left-0 right-0 z-10 flex items-center pointer-events-none" style={{ top }}>
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1.5 flex-shrink-0" />
                  <div className="flex-1 h-px bg-red-500" />
                </div>
              );
            })()}

            {/* Timed events */}
            {timedEvents.map(evt => {
              const start = new Date(evt.start_time);
              const end = new Date(evt.end_time);
              const top = eventTopPx(start);
              const height = eventHeightPx(start, end);
              const { col, total } = layout.get(evt.id) || { col: 0, total: 1 };
              const pct = 100 / total;
              const bg = evt.calendar_color || '#6366f1';
              const border = darkenHex(bg);
              const isSelected = selectedEvent?.id === evt.id;

              return (
                <button
                  key={evt.id}
                  onClick={() => setSelectedEvent(isSelected ? null : evt)}
                  className="absolute rounded-md text-left text-white text-xs shadow-sm hover:opacity-95 transition-opacity focus:outline-none focus:ring-2 focus:ring-white/50 overflow-hidden"
                  style={{
                    top,
                    height,
                    left: `calc(${col * pct}% + 3px)`,
                    width: `calc(${pct}% - 6px)`,
                    backgroundColor: bg,
                    borderLeft: `3px solid ${border}`,
                    zIndex: isSelected ? 15 : 5,
                  }}
                  title={evt.summary}
                >
                  <div className="px-1.5 py-1 h-full flex flex-col overflow-hidden">
                    <span className="font-semibold leading-tight truncate">{evt.summary}</span>
                    {height > 28 && (
                      <span className="opacity-80 text-[10px]">{format(start, 'HH:mm')}–{format(end, 'HH:mm')}</span>
                    )}
                    {height > 48 && evt.attendees?.length > 0 && (
                      <span className="opacity-75 text-[10px] truncate">{evt.attendees.join(', ')}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Event detail modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 relative"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedEvent(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 text-xl leading-none"
              aria-label="Close"
            >✕</button>

            <div className="flex items-start gap-3 mb-4">
              <div className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: selectedEvent.calendar_color || '#6366f1' }} />
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-900 leading-snug">{selectedEvent.summary}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{selectedEvent.calendar_name}</p>
              </div>
            </div>

            <div className="space-y-2 text-sm text-slate-700">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span>
                  {selectedEvent.all_day
                    ? 'All day'
                    : `${format(parseISO(selectedEvent.start_time), 'HH:mm')} – ${format(parseISO(selectedEvent.end_time), 'HH:mm')}`
                  }
                </span>
              </div>
              {selectedEvent.location && (
                <div className="flex items-start gap-2">
                  <Globe className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <span className="break-words">{selectedEvent.location}</span>
                </div>
              )}
              {selectedEvent.attendees?.length > 0 && (
                <div className="flex items-start gap-2">
                  <Users className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-0.5">
                    {selectedEvent.attendees.map(a => (
                      <span key={a} className="text-slate-600 text-xs">{a}</span>
                    ))}
                  </div>
                </div>
              )}
              {selectedEvent.description && (
                <div className="mt-2 p-3 bg-slate-50 rounded-lg text-xs text-slate-600 whitespace-pre-wrap max-h-28 overflow-y-auto">
                  {selectedEvent.description}
                </div>
              )}
              {selectedEvent.html_link && (
                <a
                  href={selectedEvent.html_link}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-indigo-600 hover:underline text-xs mt-2"
                >
                  <ExternalLink className="w-3 h-3" /> Open in Google Calendar
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
