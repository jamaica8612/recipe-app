import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSupabaseConfig } from './config.js';

let client = null;

export function getSupabaseClient() {
  if (client) return client;
  const { url, key } = getSupabaseConfig();
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

export async function getCurrentUser() {
  const { data } = await getSupabaseClient().auth.getUser();
  return data.user || null;
}
