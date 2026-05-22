import { getSupabaseConfig } from '../config.js';
import { getSupabaseClient } from '../supabaseClient.js';

const ENDPOINT = 'https://xrrdokcjhjqdfvwtbenl.supabase.co/functions/v1/suggest-recipes';

/**
 * @param {{ fridgeItems: string[], recipes: Array<{id:string,title:string,ingredients:string[]}> }}
 * @returns {Promise<{ ok: boolean, suggestion?: string, recommendedIds?: string[], error?: string }>}
 */
export async function suggestRecipes({ fridgeItems, recipes }) {
  try {
    const { key } = getSupabaseConfig();
    const headers = {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    };

    try {
      const { data } = await getSupabaseClient().auth.getSession();
      if (data.session?.access_token) {
        headers['Authorization'] = `Bearer ${data.session.access_token}`;
      }
    } catch {
      // anonymous — will 401
    }

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fridgeItems, recipes }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || '추천 생성에 실패했습니다.' };
    }
    return {
      ok: true,
      suggestion: data.suggestion,
      recommendedIds: Array.isArray(data.recommendedIds) ? data.recommendedIds : [],
    };
  } catch {
    return { ok: false, error: '네트워크 오류가 발생했습니다.' };
  }
}
