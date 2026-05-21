import { getAnalyzeEndpoint, getAnalyzeHeaders } from '../config.js';
import { getSupabaseClient } from '../supabaseClient.js';

const FAILURE_COPY = {
  not_recipe: '요리 영상으로 판단되지 않았습니다.',
  unavailable: '비공개, 삭제, 일부공개, 지역 제한 영상일 수 있습니다.',
  schema_invalid: '분석 결과가 저장 가능한 형식이 아니었습니다.',
  insufficient_content: '재료나 단계 정보가 부족해 보정이 필요합니다.',
  too_long: '영상이 너무 길어 자동 분석 전 확인이 필요합니다.',
  api_unavailable: 'Gemini API 제한 또는 일시 장애가 발생했습니다.',
};

const EMPTY_QUOTA = { charged: false, remaining: null };

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeMockAnalysis(videoId) {
  return {
    youtubeVideoId: videoId,
    title: '새 레시피 (목업 분석)',
    channelName: '목업 채널',
    suggestedCategory: 'etc',
    confidence: 0.82,
    needsReview: false,
    servings: 2,
    cookTimeMin: 30,
    ingredients: [
      { name: '주재료', amount: 1, unit: '개' },
      { name: '양념', amount: 2, unit: '큰술' },
    ],
    steps: [
      { order: 1, text: '재료를 손질하고 팬을 예열한다.', timestampSec: 0 },
      { order: 2, text: '양념을 넣고 중불에서 익힌다.', timestampSec: 90 },
      { order: 3, text: '간을 보고 그릇에 담아 마무리한다.', timestampSec: 240 },
    ],
    tips: ['실제 Gemini 연동 전까지 사용하는 계약 고정용 목업입니다.'],
  };
}

function detectMockFailure(input) {
  const text = String(input || '').toLowerCase();
  if (text.includes('notrecipe')) return 'not_recipe';
  if (text.includes('private') || text.includes('deleted')) return 'unavailable';
  if (text.includes('schema')) return 'schema_invalid';
  if (text.includes('weak')) return 'insufficient_content';
  if (text.includes('toolong')) return 'too_long';
  if (text.includes('apierr')) return 'api_unavailable';
  return null;
}

export async function analyzeVideo({ url, videoId }) {
  const endpoint = getAnalyzeEndpoint();
  if (endpoint) {
    return analyzeViaEdgeFunction({ endpoint, url, videoId });
  }
  return analyzeViaMock({ url, videoId });
}

export async function markAnalysisAccepted(videoId) {
  return sendQualitySignal({ action: 'accept', videoId });
}

export async function reportAnalysis(videoId, message = '') {
  return sendQualitySignal({ action: 'report', videoId, message });
}

async function analyzeViaEdgeFunction({ endpoint, url, videoId }) {
  try {
    const headers = await getAnalyzeRequestHeaders();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url, videoId }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return failureResponse({
        source: 'edge',
        reason: data?.failure?.reason || 'api_unavailable',
        message: data?.failure?.message,
      });
    }
    return normalizeAnalyzeResponse(data, 'edge');
  } catch {
    return failureResponse({ source: 'edge', reason: 'api_unavailable' });
  }
}

async function sendQualitySignal({ action, videoId, message }) {
  const endpoint = getAnalyzeEndpoint();
  if (!endpoint || !videoId || videoId.startsWith('fake-')) {
    return { ok: false, skipped: true };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: await getAnalyzeRequestHeaders(),
      body: JSON.stringify({ action, videoId, message }),
    });
    const data = await res.json().catch(() => null);
    return {
      ok: res.ok && Boolean(data?.ok),
      skipped: false,
      status: res.status,
      failure: data?.failure || null,
    };
  } catch {
    return { ok: false, skipped: false, status: 0 };
  }
}

async function getAnalyzeRequestHeaders() {
  const headers = { 'Content-Type': 'application/json', ...getAnalyzeHeaders() };

  try {
    const { data } = await getSupabaseClient().auth.getSession();
    if (data.session?.access_token) {
      headers.Authorization = `Bearer ${data.session.access_token}`;
    }
  } catch {
    // Anonymous analysis still works with the publishable key header.
  }

  return headers;
}

function normalizeAnalyzeResponse(data, fallbackSource) {
  if (!data || typeof data !== 'object') {
    return failureResponse({ source: fallbackSource, reason: 'schema_invalid' });
  }

  const source = data.source || fallbackSource;
  if (!data.ok) {
    const reason = data.failure?.reason || 'api_unavailable';
    // 서버가 raw 영문 에러를 전달했을 때 한국어 카피로 강제 치환.
    // (서버 측에서도 같이 막지만, 옛 배포본 응답도 클린업되도록 클라이언트에서 보호)
    const rawMessage = data.failure?.message || '';
    const looksRawForeign = /[A-Za-z]{12,}/.test(rawMessage);
    return failureResponse({
      source,
      reason,
      message: looksRawForeign ? undefined : rawMessage,
      analysis: data.analysis || null,
      quota: data.quota,
    });
  }

  if (!data.analysis || !Array.isArray(data.analysis.ingredients) || !Array.isArray(data.analysis.steps)) {
    return failureResponse({ source, reason: 'schema_invalid', quota: data.quota });
  }

  return {
    ok: true,
    source,
    analysis: normalizeAnalysis(data.analysis),
    failure: null,
    quota: data.quota || EMPTY_QUOTA,
  };
}

function normalizeAnalysis(analysis) {
  return {
    ...analysis,
    channelName: analysis.channelName || analysis.chefName || '',
    situationTagIds: Array.isArray(analysis.situationTagIds) ? analysis.situationTagIds : [],
  };
}

function failureResponse({ source, reason, message, analysis = null, quota = EMPTY_QUOTA }) {
  return {
    ok: false,
    source,
    analysis,
    failure: {
      reason,
      message: message || FAILURE_COPY[reason] || FAILURE_COPY.api_unavailable,
      chargeable: false,
    },
    quota: { ...EMPTY_QUOTA, ...quota, charged: false },
  };
}

async function analyzeViaMock({ url, videoId }) {
  await delay(900);

  const reason = detectMockFailure(url);
  if (reason) {
    const partial = reason === 'insufficient_content'
      ? { ...makeMockAnalysis(videoId), confidence: 0.42, needsReview: true, steps: [] }
      : null;

    return failureResponse({
      source: 'mock',
      reason,
      analysis: partial,
    });
  }

  return {
    ok: true,
    source: 'mock',
    analysis: makeMockAnalysis(videoId),
    failure: null,
    quota: EMPTY_QUOTA,
  };
}

export { FAILURE_COPY };
