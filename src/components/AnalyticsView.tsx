import React, { useMemo, useRef, useEffect } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import { Contact, ContactLog } from '../types';

// Register layout engine
cytoscape.use(coseBilkent);

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

interface CyNode {
  data: { id: string; label: string; size: number; color: string };
}
interface CyEdge {
  data: { id: string; source: string; target: string; weight: number };
}

function buildGraphElements(
  logs: ContactLog[],
  contacts: Contact[]
): { nodes: CyNode[]; edges: CyEdge[] } {
  // Node sizes: count logs per contact
  const logCounts: Record<string, number> = {};
  for (const log of logs) {
    logCounts[log.contact_id] = (logCounts[log.contact_id] || 0) + 1;
  }

  // Group by event_uid to find co-attendees
  const eventGroups: Record<string, string[]> = {};
  for (const log of logs) {
    if (!log.event_uid) continue;
    if (!eventGroups[log.event_uid]) eventGroups[log.event_uid] = [];
    eventGroups[log.event_uid].push(log.contact_id);
  }

  // Edge weight: how many shared events between two contacts
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

  // Label color mapping
  const LABEL_COLORS = [
    '#4F46E5', '#7C3AED', '#0EA5E9', '#10B981',
    '#F59E0B', '#EF4444', '#EC4899', '#6B7280',
  ];
  const allLabels = Array.from(new Set(contacts.flatMap(c => c.labels)));
  const labelColorMap = new Map(allLabels.map((l, i) => [l, LABEL_COLORS[i % LABEL_COLORS.length]]));

  // Only include contacts that appear in logs
  const activeContactIds = new Set(logs.map(l => l.contact_id));
  const contactMap = new Map(contacts.map(c => [c.id, c]));

  const nodes: CyNode[] = [];
  let nodeCount = 0;
  for (const id of activeContactIds) {
    if (nodeCount >= 100) break; // Cap at 100 nodes for performance
    const contact = contactMap.get(id);
    if (!contact) continue;
    const dominantLabel = contact.labels[0] || '';
    nodes.push({
      data: {
        id,
        label: contact.fullName.substring(0, 14),
        size: Math.max(20, Math.min(60, (logCounts[id] || 1) * 5)),
        color: labelColorMap.get(dominantLabel) || '#6B7280',
      },
    });
    nodeCount++;
  }

  const edges: CyEdge[] = Object.entries(edgeWeights)
    .filter(([key]) => {
      const [s, t] = key.split('__');
      return activeContactIds.has(s) && activeContactIds.has(t);
    })
    .map(([key, weight]) => {
      const [source, target] = key.split('__');
      return { data: { id: key, source, target, weight } };
    });

  return { nodes, edges };
}

// ─── Stat Card Component ──────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-[#E5E7EB]">
      <p className="text-xs text-[#6B7280] font-medium uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-[#111827] mt-2">{value}</p>
    </div>
  );
}

// ─── Main AnalyticsView Component ─────────────────────────────────────────

export function AnalyticsView({ contacts, logs, loading }: AnalyticsViewProps) {
  const timelineData = useMemo(() => buildTimelineData(logs), [logs]);
  const typeDistribution = useMemo(() => buildTypeDistribution(logs), [logs]);
  const topContacts = useMemo(() => buildTopContacts(logs, contacts, 10), [logs, contacts]);
  const graphElements = useMemo(() => buildGraphElements(logs, contacts), [logs, contacts]);

  const cyRef = useRef<HTMLDivElement>(null);
  const cyInstance = useRef<cytoscape.Core | null>(null);

  // Cytoscape initialization
  useEffect(() => {
    if (!cyRef.current || graphElements.nodes.length === 0) return;

    if (cyInstance.current) {
      cyInstance.current.destroy();
    }

    cyInstance.current = cytoscape({
      container: cyRef.current,
      elements: [...graphElements.nodes, ...graphElements.edges],
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
            'opacity': 0.6,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#4F46E5',
          },
        },
      ],
    });

    return () => {
      cyInstance.current?.destroy();
      cyInstance.current = null;
    };
  }, [graphElements.nodes, graphElements.edges]);

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

  const uniqueContacts = new Set(logs.map(l => l.contact_id)).size;
  const mostActiveMonth = timelineData.length > 0
    ? timelineData.reduce((a, b) => (a.count > b.count ? a : b)).month
    : '—';
  const topType = typeDistribution.length > 0 ? typeDistribution[0].type : '—';

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Interactions" value={logs.length} />
        <StatCard label="Unique Contacts" value={uniqueContacts} />
        <StatCard label="Most Active Month" value={mostActiveMonth} />
        <StatCard label="Top Interaction Type" value={topType} />
      </div>

      {/* Timeline */}
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
              <Area
                type="monotone"
                dataKey="count"
                stroke="#4F46E5"
                fillOpacity={1}
                fill="url(#colorCount)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Row 2: Top Contacts + Type Distribution */}
      <div className="grid grid-cols-2 gap-6">
        {/* Top Contacts */}
        {topContacts.length > 0 && (
          <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
            <h3 className="text-lg font-semibold text-[#111827] mb-4">Top Contacts</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={topContacts}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 120, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" stroke="#6B7280" style={{ fontSize: '12px' }} />
                <YAxis dataKey="name" type="category" stroke="#6B7280" style={{ fontSize: '11px' }} width={115} />
                <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px' }} />
                <Bar dataKey="count" fill="#4F46E5" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Type Distribution */}
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

      {/* Cytoscape Network */}
      {graphElements.nodes.length > 0 && (
        <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
          <h3 className="text-lg font-semibold text-[#111827] mb-4">Contact Network</h3>
          <p className="text-xs text-[#6B7280] mb-3">
            Showing contacts connected by shared calendar events. Node size = interaction frequency.
          </p>
          <div ref={cyRef} style={{ height: '500px', width: '100%', borderRadius: '8px', border: '1px solid #E5E7EB' }} />
        </div>
      )}
    </div>
  );
}
