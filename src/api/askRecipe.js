import { getSupabaseConfig } from '../config.js';
import { getSupabaseClient } from '../supabaseClient.js';

const ENDPOINT = 'https://xrrdokcjhjqdfvwtbenl.supabase.co/functions/v1/ask-recipe';

/**
 * @param {{ recipe: object, question: string, history?: Array<{role:string,content:string}> }}
 * @returns {Promise<{ ok: boolean, answer?: string, error?: string }>}
 */
export async function askRecipe({ recipe, question, history = [] }) {
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
      body: JSON.stringify({ recipe, question, history }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || '답변 생성에 실패했습니다.' };
    }
    return { ok: true, answer: data.answer };
  } catch {
    return { ok: false, error: '네트워크 오류가 발생했습니다.' };
  }
}
