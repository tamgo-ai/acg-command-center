// ACG Command Center — Supabase Client
// Proporciona el cliente de Supabase con service_role (admin) para ingestion.

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './index';

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const config = getConfig();
  _supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  console.log('✅ Supabase conectado');
  return _supabase;
}

export function getSupabaseAnon(): SupabaseClient {
  const config = getConfig();
  return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}
