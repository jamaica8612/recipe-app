const DEFAULT_SUPABASE_URL = 'https://xrrdokcjhjqdfvwtbenl.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_prnLDb7bcWORu7wrqTRsXQ_NWJL8Jnk';
const DEFAULT_ANALYZE_ENDPOINT = 'https://xrrdokcjhjqdfvwtbenl.supabase.co/functions/v1/analyze-video';

export function getAnalyzeEndpoint() {
  const fromWindow = globalThis.RECIPE_APP_CONFIG?.analyzeEndpoint;
  const fromStorage = safeLocalStorageGet('recipe-app:analyze-endpoint');
  return normalizeEndpoint(fromWindow || fromStorage || DEFAULT_ANALYZE_ENDPOINT);
}

export function getAnalyzeHeaders() {
  const anonKey = globalThis.RECIPE_APP_CONFIG?.supabaseAnonKey
    || safeLocalStorageGet('recipe-app:supabase-anon-key')
    || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  return anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {};
}

export function getBackendSettings() {
  return {
    analyzeEndpoint: getAnalyzeEndpoint() || '',
    supabaseAnonKey: globalThis.RECIPE_APP_CONFIG?.supabaseAnonKey
      || safeLocalStorageGet('recipe-app:supabase-anon-key')
      || DEFAULT_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function getSupabaseConfig() {
  return {
    url: globalThis.RECIPE_APP_CONFIG?.supabaseUrl
      || safeLocalStorageGet('recipe-app:supabase-url')
      || DEFAULT_SUPABASE_URL,
    key: globalThis.RECIPE_APP_CONFIG?.supabaseAnonKey
      || safeLocalStorageGet('recipe-app:supabase-anon-key')
      || DEFAULT_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function saveBackendSettings({ analyzeEndpoint, supabaseAnonKey }) {
  safeLocalStorageSet('recipe-app:analyze-endpoint', normalizeEndpoint(analyzeEndpoint) || '');
  safeLocalStorageSet('recipe-app:supabase-anon-key', String(supabaseAnonKey || '').trim());
}

export function clearBackendSettings() {
  safeLocalStorageRemove('recipe-app:analyze-endpoint');
  safeLocalStorageRemove('recipe-app:supabase-anon-key');
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // ignore storage errors
  }
}

function safeLocalStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage errors
  }
}

function normalizeEndpoint(value) {
  const endpoint = String(value || '').trim();
  if (!endpoint) return null;
  return endpoint.replace(/\/$/, '');
}
