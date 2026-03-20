import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import { Contact, ContactLog } from '../types';

// Register layout engine
cytoscape.use(coseBilkent);

// ─── Label Colors ──────────────────────────────────────────────────────────

const LABEL_ALIVENESS = '#10B981'; // green
const LABEL_SLOWYOU   = '#7C3AED'; // purple
const LABEL_BOTH      = '#F59E0B'; // gold
const LABEL_DEFAULT   = '#4F46E5'; // indigo

function getNodeColor(contact: Contact): string {
  const labels = contact.labels.map(l => l.toLowerCase());
  const hasAliveness = labels.some(l => l.includes('alivenesslab') || l.includes('alivness'));
  const hasSlowYou   = labels.some(l => l.includes('slowyou'));
  if (hasAliveness && hasSlowYou) return LABEL_BOTH;
  if (hasAliveness) return LABEL_ALIVENESS;
  if (hasSlowYou)   return LABEL_SLOWYOU;
  return LABEL_DEFAULT;
}

interface AnalyticsViewProps {
  contacts: Contact[];
  logs: ContactLog[];
  loading: boolean;
}

// ─── Data Transformation Functions ────────────────────────────────────────

function buildTimelineData(logs: ContactLog[]): { month: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const log of logs) {
    if (!log.logged_at) continue;
    const d = new Date(log.logged_at);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));
}

function buildTypeDistribution(logs: ContactLog[]): { type: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const log of logs) {
    const t = log.contact_type || 'Other';
    counts[t] = (counts[t] || 0) + 1;
  }
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => ({ type, count }));
}

function buildTopContacts(
  logs: ContactLog[],
  contacts: Contact[],
  n = 10
): { name: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const log of logs) {
    counts[log.contact_id] = (counts[log.contact_id] || 0) + 1;
  }
  const nameMap = new Map(contacts.map(c => [c.id, c.fullName]));
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([id, count]) => ({ name: nameMap.get(id) || id, count }));
}

// Build timeline steps (by year-month) sorted ascending
function buildTimelineSteps(logs: ContactLog[]): string[] {
  const months = new Set<string>();
  for (const log of logs) {
    if (!log.logged_at) continue;
    const d = new Date(log.logged_at);
    if (isNaN(d.getTime())) continue;
    months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return Array.from(months).sort();
}

interface CyNode {
  data: { id: string; label: string; size: number; color: string; group: string };
}
interface CyEdge {
  data: { id: string; source: string; target: string; weight: number };
}

function buildGraphAtTime(
  logs: ContactLog[],
  contacts: Contact[],
  upToMonth: string // inclusive, format YYYY-MM
): { nodes: CyNode[]; edges: CyEdge[] } {
  // Filter logs up to the given month
  const filteredLogs = logs.filter(log => {
    if (!log.logged_at) return false;
    const d = new Date(log.logged_at);
    if (isNaN(d.getTime())) return false;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return key <= upToMonth;
  });

  const logCounts: Record<string, number> = {};
  for (const log of filteredLogs) {
    logCounts[log.contact_id] = (logCounts[log.contact_id] || 0) + 1;
  }

  const eventGroups: Record<string, string[]> = {};
  for (const log of filteredLogs) {
    if (!log.event_uid) continue;
    if (!eventGroups[log.event_uid]) eventGroups[log.event_uid] = [];
    eventGroups[log.event_uid].push(log.contact_id);
  }

  const edgeWeights: Record<string, number> = {};
  for (const group of Object.values(eventGroups)) {
    const unique = Array.from(new Set(group));
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const key = [unique[i], unique[j]].sort().join('__');
        edgeWeights[key] = (edgeWeights[key] || 0) + 1;
      }
    }
  }

  const activeContactIds = new Set(filteredLogs.map(l => l.contact_id));
  const contactMap = new Map(contacts.map(c => [c.id, c]));

  const nodes: CyNode[] = [];
  let nodeCount = 0;
  for (const id of activeContactIds) {
    if (nodeCount >= 150) break;
    const contact = contactMap.get(id);
    if (!contact) continue;

    const labels = contact.labels.map(l => l.toLowerCase());
    const hasAliveness = labels.some(l => l.includes('alivenesslab') || l.includes('alivness'));
    const hasSlowYou   = labels.some(l => l.includes('slowyou'));
    const group = hasAliveness && hasSlowYou ? 'both'
      : hasAliveness ? 'alivenesslab'
      : hasSlowYou ? 'slowyou'
      : 'default';

    nodes.push({
      data: {
        id,
        label: contact.fullName.substring(0, 14),
        size: Math.max(20, Math.min(60, (logCounts[id] || 1) * 4)),
        color: getNodeColor(contact),
        group,
      },
    });
    nodeCount++;
  }

  const nodeIds = new Set(nodes.map(n => n.data.id));
  const edges: CyEdge[] = Object.entries(edgeWeights)
    .filter(([key]) => {
      const [s, t] = key.split('__');
      return nodeIds.has(s) && nodeIds.has(t);
    })
    .map(([key, weight]) => {
      const [source, target] = key.split('__');
      return { data: { id: key, source, target, weight } };
    });

  return { nodes, edges };
}

function buildFullGraphElements(
  logs: ContactLog[],
  contacts: Contact[]
): { nodes: CyNode[]; edges: CyEdge[] } {
  const logCounts: Record<string, number> = {};
  for (const log of logs) {
    logCounts[log.contact_id] = (logCounts[log.contact_id] || 0) + 1;
  }

  const eventGroups: Record<string, string[]> = {};
  for (const log of logs) {
    if (!log.event_uid) continue;
    if (!eventGroups[log.event_uid]) eventGroups[log.event_uid] = [];
    eventGroups[log.event_uid].push(log.contact_id);
  }

  const edgeWeights: Record<string, number> = {};
  for (const group of Object.values(eventGroups)) {
    const unique = Array.from(new Set(group));
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const key = [unique[i], unique[j]].sort().join('__');
        edgeWeights[key] = (edgeWeights[key] || 0) + 1;
      }
    }
  }

  const activeContactIds = new Set(logs.map(l => l.contact_id));
  const contactMap = new Map(contacts.map(c => [c.id, c]));

  const nodes: CyNode[] = [];
  let nodeCount = 0;
  for (const id of activeContactIds) {
    if (nodeCount >= 150) break;
    const contact = contactMap.get(id);
    if (!contact) continue;

    const labels = contact.labels.map(l => l.toLowerCase());
    const hasAliveness = labels.some(l => l.includes('alivenesslab') || l.includes('alivness'));
    const hasSlowYou   = labels.some(l => l.includes('slowyou'));
    const group = hasAliveness && hasSlowYou ? 'both'
      : hasAliveness ? 'alivenesslab'
      : hasSlowYou ? 'slowyou'
      : 'default';

    nodes.push({
      data: {
        id,
        label: contact.fullName.substring(0, 14),
        size: Math.max(20, Math.min(60, (logCounts[id] || 1) * 4)),
        color: getNodeColor(contact),
        group,
      },
    });
    nodeCount++;
  }

  const nodeIds = new Set(nodes.map(n => n.data.id));
  const edges: CyEdge[] = Object.entries(edgeWeights)
    .filter(([key]) => {
      const [s, t] = key.split('__');
      return nodeIds.has(s) && nodeIds.has(t);
    })
    .map(([key, weight]) => {
      const [source, target] = key.split('__');
      return { data: { id: key, source, target, weight } };
    });

  return { nodes, edges };
}

// ─── Stat Card Component ──────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-[#E5E7EB]">
      <p className="text-xs text-[#6B7280] font-medium uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-[#111827] mt-2">{value}</p>
      {sub && <p className="text-xs text-[#9CA3AF] mt-1">{sub}</p>}
    </div>
  );
}

// ─── Cytoscape Panel ──────────────────────────────────────────────────────

function CytoscapePanel({ nodes, edges }: { nodes: CyNode[]; edges: CyEdge[] }) {
  const cyRef = useRef<HTMLDivElement>(null);
  const cyInstance = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!cyRef.current || nodes.length === 0) return;

    if (cyInstance.current) {
      cyInstance.current.destroy();
    }

    cyInstance.current = cytoscape({
      container: cyRef.current,
      elements: [...nodes, ...edges],
      layout: {
        name: 'cose-bilkent',
        nodeRepulsion: 4500,
        idealEdgeLength: 120,
      } as any,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'width': 'data(size)',
            'height': 'data(size)',
            'label': 'data(label)',
            'font-size': '10px',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'color': '#374151',
            'text-margin-y': 4,
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1,
            'line-color': '#D1D5DB',
            'opacity': 0.5,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#111827',
          },
        },
      ],
    });

    return () => {
      cyInstance.current?.destroy();
      cyInstance.current = null;
    };
  }, [nodes, edges]);

  return <div ref={cyRef} className="cy-panel" />;
}

// ─── Main AnalyticsView Component ─────────────────────────────────────────

export function AnalyticsView({ contacts, logs, loading }: AnalyticsViewProps) {
  const timelineData     = useMemo(() => buildTimelineData(logs), [logs]);
  const typeDistribution = useMemo(() => buildTypeDistribution(logs), [logs]);
  const topContacts      = useMemo(() => buildTopContacts(logs, contacts, 10), [logs, contacts]);
  const fullGraph        = useMemo(() => buildFullGraphElements(logs, contacts), [logs, contacts]);
  const timelineSteps    = useMemo(() => buildTimelineSteps(logs), [logs]);

  // Playable timeline state
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [isPlaying, setIsPlaying]         = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentStep = timelineSteps[timelineIndex] ?? '';

  const timelineGraph = useMemo(
    () => currentStep ? buildGraphAtTime(logs, contacts, currentStep) : { nodes: [], edges: [] },
    [logs, contacts, currentStep]
  );

  const stopPlay = useCallback(() => {
    if (playRef.current) {
      clearInterval(playRef.current);
      playRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const startPlay = useCallback(() => {
    setIsPlaying(true);
    playRef.current = setInterval(() => {
      setTimelineIndex(prev => {
        if (prev >= timelineSteps.length - 1) {
          stopPlay();
          return prev;
        }
        return prev + 1;
      });
    }, 600);
  }, [timelineSteps.length, stopPlay]);

  useEffect(() => () => stopPlay(), [stopPlay]);

  // KPI derived values
  const uniqueContacts  = new Set(logs.map(l => l.contact_id)).size;

  // Meetings + contacts per year
  const byYear = useMemo(() => {
    const yearMap: Record<string, { meetings: number; contactIds: Set<string> }> = {};
    for (const log of logs) {
      if (!log.logged_at) continue;
      const d = new Date(log.logged_at);
      if (isNaN(d.getTime())) continue;
      const y = String(d.getFullYear());
      if (!yearMap[y]) yearMap[y] = { meetings: 0, contactIds: new Set() };
      yearMap[y].meetings++;
      yearMap[y].contactIds.add(log.contact_id);
    }
    return Object.entries(yearMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, v]) => ({ year, meetings: v.meetings, contacts: v.contactIds.size }));
  }, [logs]);
  const mostActiveMonth = timelineData.length > 0
    ? timelineData.reduce((a, b) => (a.count > b.count ? a : b)).month
    : '—';
  const topType = typeDistribution.length > 0 ? typeDistribution[0].type : '—';

  // Color mapping for contact types
  const typeColors: Record<string, string> = {
    Meeting: '#4F46E5',
    'Phone Call': '#7C3AED',
    Zoom: '#0EA5E9',
    Email: '#10B981',
    Message: '#F59E0B',
    Note: '#6B7280',
    Other: '#D1D5DB',
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-[#6B7280]">Loading analytics...</div>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center">
        <p className="text-[#6B7280] text-lg">No interaction logs recorded yet.</p>
        <p className="text-[#9CA3AF] text-sm mt-1">Start logging meetings to see analytics.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-6">

      {/* KPI Cards — 4 summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Interactions" value={logs.length} />
        <StatCard label="Unique Contacts" value={uniqueContacts} />
        <StatCard label="Most Active Month" value={mostActiveMonth} />
        <StatCard label="Top Interaction Type" value={topType} />
      </div>

      {/* Meetings & Contacts per Year */}
      {byYear.length > 0 && (
        <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
          <h3 className="text-lg font-semibold text-[#111827] mb-4">Meetings & Contacts per Year</h3>
          <div className="flex gap-3 flex-wrap">
            {byYear.map(({ year, meetings, contacts }) => (
              <div key={year} className="bg-[#F9FAFB] rounded-xl p-4 border border-[#E5E7EB] text-center flex-1 min-w-[100px]">
                <p className="text-sm font-bold text-[#4F46E5]">{year}</p>
                <p className="text-2xl font-bold text-[#111827] mt-1">{meetings}</p>
                <p className="text-xs text-[#6B7280] mt-0.5">meetings</p>
                <p className="text-lg font-semibold text-[#374151] mt-2">{contacts}</p>
                <p className="text-xs text-[#6B7280]">contacts</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline chart */}
      {timelineData.length > 0 && (
        <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
          <h3 className="text-lg font-semibold text-[#111827] mb-4">Interactions Over Time</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={timelineData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <XAxis dataKey="month" stroke="#6B7280" style={{ fontSize: '12px' }} />
              <YAxis stroke="#6B7280" style={{ fontSize: '12px' }} />
              <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px' }} />
              <Area type="monotone" dataKey="count" stroke="#4F46E5" fillOpacity={1} fill="url(#colorCount)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Row: Top Contacts + Type Distribution */}
      <div className="grid grid-cols-2 gap-6">
        {topContacts.length > 0 && (
          <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
            <h3 className="text-lg font-semibold text-[#111827] mb-4">Top Contacts</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topContacts} layout="vertical" margin={{ top: 5, right: 30, left: 120, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" stroke="#6B7280" style={{ fontSize: '12px' }} />
                <YAxis dataKey="name" type="category" stroke="#6B7280" style={{ fontSize: '11px' }} width={115} />
                <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px' }} />
                <Bar dataKey="count" fill="#4F46E5" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {typeDistribution.length > 0 && (
          <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
            <h3 className="text-lg font-semibold text-[#111827] mb-4">Interaction Types</h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={typeDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="count"
                >
                  {typeDistribution.map((entry) => (
                    <Cell key={`cell-${entry.type}`} fill={typeColors[entry.type] || '#D1D5DB'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Playable Timeline Network */}
      {timelineSteps.length > 0 && (
        <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-lg font-semibold text-[#111827]">Network Growth Timeline</h3>
              <p className="text-xs text-[#6B7280] mt-0.5">
                Watch your contact network grow over time. Nodes appear as first meeting is logged.
              </p>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-[#6B7280]">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: LABEL_ALIVENESS }} />
                AlivenessLAB
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: LABEL_SLOWYOU }} />
                SlowYou
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: LABEL_BOTH }} />
                Both
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: LABEL_DEFAULT }} />
                Other
              </span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3 mb-4">
            <button
              type="button"
              onClick={isPlaying ? stopPlay : startPlay}
              className="px-4 py-1.5 rounded-lg bg-[#4F46E5] text-white text-sm font-medium hover:bg-[#4338CA] transition-colors"
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
            <button
              type="button"
              onClick={() => { stopPlay(); setTimelineIndex(0); }}
              className="px-3 py-1.5 rounded-lg bg-[#F3F4F6] text-[#4B5563] text-sm hover:bg-[#E5E7EB] transition-colors"
            >
              ↩ Reset
            </button>
            <input
              type="range"
              min={0}
              max={timelineSteps.length - 1}
              value={timelineIndex}
              onChange={e => { stopPlay(); setTimelineIndex(Number(e.target.value)); }}
              className="flex-1 accent-[#4F46E5]"
              aria-label="Timeline position"
              title="Drag to navigate through time"
            />
            <span className="text-sm font-mono font-semibold text-[#4F46E5] min-w-[72px] text-right">
              {currentStep}
            </span>
            <span className="text-xs text-[#9CA3AF]">
              {timelineGraph.nodes.length} contacts
            </span>
          </div>

          <CytoscapePanel nodes={timelineGraph.nodes} edges={timelineGraph.edges} />
        </div>
      )}

      {/* Full static network */}
      {fullGraph.nodes.length > 0 && (
        <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
          <h3 className="text-lg font-semibold text-[#111827] mb-1">Full Contact Network</h3>
          <p className="text-xs text-[#6B7280] mb-3">
            All contacts connected by shared calendar events. Node size = interaction frequency.
          </p>
          <CytoscapePanel nodes={fullGraph.nodes} edges={fullGraph.edges} />
        </div>
      )}

    </div>
  );
}
