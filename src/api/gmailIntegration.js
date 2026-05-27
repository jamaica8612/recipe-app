// Gmail 자동입고 API 클라이언트
import { getSupabaseClient } from '../supabaseClient.js';
import { getGmailClientId, getGmailRedirectUri, getIngestEndpoint } from '../config.js';

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export async function startGmailOAuth() {
  const clientId = getGmailClientId();
  if (!clientId) throw new Error('Gmail Client ID가 설정되지 않았습니다.');

  const { data: sessionData, error } = await getSupabaseClient().auth.getSession();
  if (error || !sessionData.session) throw new Error('로그인이 필요합니다.');

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', getGmailRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GMAIL_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', sessionData.session.access_token);
  location.href = url.toString();
}

export async function listGmailIntegrations() {
  const supabase = getSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data, error } = await supabase
    .from('email_integrations')
    .select('id, provider, email_address, last_synced_at, is_active, created_at')
    .eq('user_id', userData.user.id)
    .eq('provider', 'gmail')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteGmailIntegration(id) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('email_integrations').delete().eq('id', id);
  if (error) throw error;
}

export async function triggerManualSync() {
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const { data: userData } = await supabase.auth.getUser();
  if (!sessionData.session || !userData.user) throw new Error('로그인이 필요합니다.');

  const res = await fetch(getIngestEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify({ user_id: userData.user.id }),
  });
  if (!res.ok) throw new Error(`동기화 실패: ${res.status}`);
  return res.json();
}

export async function listRecentImports(limit = 10) {
  const supabase = getSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data, error } = await supabase
    .from('processed_emails')
    .select('id, subject, from_address, status, parsed_items, received_at, created_at')
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
