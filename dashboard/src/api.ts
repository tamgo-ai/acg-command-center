/**
 * API Abstraction Layer
 * - Default: local SQLite API (via nginx proxy or direct)
 * - Supabase mode: only when VITE_LOCAL_API=supabase
 * - In dev: VITE_LOCAL_API=http://localhost:3456
 * - In prod (nginx): VITE_LOCAL_API not needed (uses same origin)
 */
import { createClient } from '@supabase/supabase-js';

// Determinar base URL de la API local
const configuredApi = import.meta.env.VITE_LOCAL_API || '';
const supabaseMode = configuredApi === 'supabase';

// Si no se configura, usar el mismo origin (producción con nginx)
// Si está configurado con URL, usar esa (dev con localhost)
const LOCAL_API = configuredApi && configuredApi !== 'supabase'
  ? configuredApi
  : (typeof window !== 'undefined' ? window.location.origin : '');

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isLocal = !supabaseMode;

// ── Supabase client ─────────────────────────────────────────────
const supabase = SUPA_URL && SUPA_KEY
  ? createClient(SUPA_URL, SUPA_KEY)
  : null;

// ── Local API helper ────────────────────────────────────────────
async function fetchLocal(path: string): Promise<any> {
  const res = await fetch(`${LOCAL_API}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── Types ───────────────────────────────────────────────────────
export interface Stats {
  total_calls: number;
  total_messages: number;
  attributed_calls_30d: number;
  appointments: number;
  drop_offs: number;
  attribution_rate: string;
}

export interface HeatmapCell {
  location_id: string;
  channel: string;
  call_count: number;
}

export interface Location {
  location_id: string;
  name: string;
  city: string;
}

export interface FunnelData {
  calls: Array<{ location_id: string; calls: number }>;
  appointments: Array<{ location_id: string; appointments: number; arrived: number; drop_offs: number }>;
}

export interface ApiCall {
  call_sid: string;
  to_number: string;
  from_number: string;
  direction: string;
  duration_sec: number;
  status: string;
  occurred_at: string;
  location_id: string;
  channel: string;
  display_name: string;
}

export interface Recommendation {
  id: number;
  generated_at: string;
  agent: string;
  type: string;
  location_id: string | null;
  channel: string | null;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  supporting_data: any;
  confidence: number;
  status: 'new' | 'reviewed' | 'actioned' | 'dismissed';
}

export interface AttributionOverview {
  total_journeys: number;
  attributed: number;
  unique_phones: number;
  channels_detected: number;
  locations_detected: number;
  drop_rate: number;
  attribution_rate: number;
  avg_confidence: number;
  total_spend: number;
  cost_per_drop: string;
}

export interface ChannelPerformance {
  channel: string;
  journeys: number;
  drop_offs: number;
  unique_phones: number;
  drop_rate: number;
  avg_confidence: number;
  appointments: number;
  total_calls: number;
  total_spend?: number;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  cost_per_lead: number;
  cost_per_drop: number;
}

export interface LocationLeader {
  location_id: string;
  name: string;
  journeys: number;
  drop_offs: number;
  drop_rate: number;
  channels: number;
  unique_phones: number;
  total_calls: number;
  total_spend: number;
  cost_per_drop: number;
}

export interface SourceGroup {
  source_group: string;
  count: number;
  drop_offs: number;
  pct: number;
}

export interface AttributionTrends {
  daily: Array<{ day: string; channel: string; journeys: number; drop_offs: number }>;
}

// ── API ─────────────────────────────────────────────────────────
export const api = {
  async getStats(): Promise<Stats> {
    if (isLocal) return fetchLocal('/api/stats');

    // Supabase
    const { count: totalCalls } = await supabase!.from('calls').select('*', { count: 'exact', head: true });
    const { count: totalMsgs } = await supabase!.from('messages').select('*', { count: 'exact', head: true });
    const { count: apps } = await supabase!.from('appointments').select('*', { count: 'exact', head: true });
    const { count: drops } = await supabase!.from('appointments').select('*', { count: 'exact', head: true }).eq('drop_off', true);

    // Attributed calls: count calls that match number_registry (approximation)
    const { data: attrData } = await supabase!.from('calls').select('to_number');
    const { data: nums } = await supabase!.from('number_registry').select('twilio_number');
    const numSet = new Set((nums || []).map(n => n.twilio_number));
    const attributed = (attrData || []).filter(c => numSet.has(c.to_number)).length;

    return {
      total_calls: totalCalls || 0,
      total_messages: totalMsgs || 0,
      attributed_calls_30d: attributed,
      appointments: apps || 0,
      drop_offs: drops || 0,
      attribution_rate: totalCalls ? ((attributed / totalCalls) * 100).toFixed(1) : '0',
    };
  },

  async getHeatmap(days = 90): Promise<{ data: HeatmapCell[]; locations: Location[] }> {
    if (isLocal) return fetchLocal(`/api/heatmap?days=${days}`);

    // Query calls joined with number_registry, grouped by location + channel
    const { data: calls } = await supabase!
      .from('calls')
      .select('to_number');
    const { data: nums } = await supabase!
      .from('number_registry')
      .select('twilio_number, location_id, channel')
      .neq('channel', 'call_center');

    const numMap = new Map<string, { location_id: string; channel: string }>();
    for (const n of (nums || [])) {
      numMap.set(n.twilio_number, { location_id: n.location_id, channel: n.channel });
    }

    const counts: Record<string, number> = {};
    for (const c of (calls || [])) {
      const info = numMap.get(c.to_number);
      if (info) {
        const key = `${info.location_id}|${info.channel}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }

    const data = Object.entries(counts).map(([key, call_count]) => {
      const [location_id, channel] = key.split('|');
      return { location_id, channel, call_count };
    });

    const { data: locs } = await supabase!.from('locations').select('location_id, name, city').eq('active', true);

    return { data, locations: locs || [] };
  },

  async getFunnel(days = 90): Promise<FunnelData> {
    if (isLocal) return fetchLocal(`/api/funnel?days=${days}`);

    const { data: calls } = await supabase!
      .from('calls')
      .select('to_number');
    const { data: nums } = await supabase!
      .from('number_registry')
      .select('twilio_number, location_id, channel')
      .neq('channel', 'call_center');

    const numMap = new Map<string, string>();
    for (const n of (nums || [])) {
      numMap.set(n.twilio_number, n.location_id);
    }

    const locCounts: Record<string, number> = {};
    for (const c of (calls || [])) {
      const loc = numMap.get(c.to_number);
      if (loc) locCounts[loc] = (locCounts[loc] || 0) + 1;
    }

    const callsByLoc = Object.entries(locCounts).map(([location_id, calls]) => ({ location_id, calls }));

    const { data: apps } = await supabase!
      .from('appointments')
      .select('location_id, arrived, drop_off');

    const appCounts: Record<string, { appointments: number; arrived: number; drop_offs: number }> = {};
    for (const a of (apps || [])) {
      if (!a.location_id) continue;
      if (!appCounts[a.location_id]) appCounts[a.location_id] = { appointments: 0, arrived: 0, drop_offs: 0 };
      appCounts[a.location_id].appointments++;
      if (a.arrived) appCounts[a.location_id].arrived++;
      if (a.drop_off) appCounts[a.location_id].drop_offs++;
    }

    const appointments = Object.entries(appCounts).map(([location_id, counts]) => ({ location_id, ...counts }));

    return { calls: callsByLoc, appointments };
  },

  async getRecommendations(): Promise<Recommendation[]> {
    if (isLocal) return fetchLocal('/api/recommendations');

    const { data } = await supabase!
      .from('recommendations')
      .select('*')
      .order('generated_at', { ascending: false })
      .limit(20);

    return data || [];
  },

  async getTrends(): Promise<any> {
    if (isLocal) return fetchLocal('/api/trends');

    // Simple daily trend from calls
    const { data: calls } = await supabase!
      .from('calls')
      .select('occurred_at');
    const { data: nums } = await supabase!
      .from('number_registry')
      .select('twilio_number, channel')
      .neq('channel', 'call_center');

    const numMap = new Map<string, string>();
    for (const n of (nums || [])) {
      numMap.set(n.twilio_number, n.channel);
    }

    const dailyCounts: Record<string, { total: number; channels: Record<string, number> }> = {};
    for (const c of (calls || [])) {
      const day = c.occurred_at?.split('T')[0];
      if (!day) continue;
      if (!dailyCounts[day]) dailyCounts[day] = { total: 0, channels: {} };
      dailyCounts[day].total++;
    }

    const total = Object.entries(dailyCounts)
      .map(([day, d]) => ({ day, total_calls: d.total }))
      .sort((a, b) => a.day.localeCompare(b.day));

    return { byChannel: [], total };
  },

  async getRecentCalls(): Promise<ApiCall[]> {
    if (isLocal) return fetchLocal('/api/calls/recent');

    const { data } = await supabase!
      .from('calls')
      .select('call_sid, to_number, from_number, direction, duration_sec, status, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(100);

    return (data || []) as ApiCall[];
  },

  async getLocations(): Promise<Location[]> {
    if (isLocal) return fetchLocal('/api/locations');

    const { data } = await supabase!
      .from('locations')
      .select('location_id, name, city')
      .eq('active', true);

    return data || [];
  },

  async getAttributionOverview(days = 90): Promise<AttributionOverview> {
    if (isLocal) return fetchLocal(`/api/attribution/overview?days=${days}`);
    return fetchLocal(`/api/attribution/overview?days=${days}`);
  },
  async getChannelPerformance(days = 90): Promise<ChannelPerformance[]> {
    if (isLocal) return fetchLocal(`/api/attribution/channels?days=${days}`);
    return fetchLocal(`/api/attribution/channels?days=${days}`);
  },
  async getLocationLeaderboard(days = 90): Promise<LocationLeader[]> {
    if (isLocal) return fetchLocal(`/api/attribution/locations?days=${days}`);
    return fetchLocal(`/api/attribution/locations?days=${days}`);
  },
  async getAttributionSources(days = 90): Promise<SourceGroup[]> {
    if (isLocal) return fetchLocal(`/api/attribution/sources?days=${days}`);
    return fetchLocal(`/api/attribution/sources?days=${days}`);
  },
  async getAttributionTrends(days = 60): Promise<AttributionTrends> {
    if (isLocal) return fetchLocal(`/api/attribution/trends?days=${days}`);
    return fetchLocal(`/api/attribution/trends?days=${days}`);
  },

  isLocal: () => isLocal,
};
