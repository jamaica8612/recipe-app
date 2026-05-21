import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type FailureReason =
  | "not_recipe"
  | "unavailable"
  | "schema_invalid"
  | "insufficient_content"
  | "too_long"
  | "api_unavailable";

type AnalyzeResponse = {
  ok: boolean;
  source: "cache" | "gemini" | "mock" | "edge";
  analysis: Record<string, unknown> | null;
  failure: null | {
    reason: FailureReason;
    message: string;
    chargeable: false;
  };
  quota: {
    charged: boolean;
    remaining: number | null;
  };
};

type RequestBody = {
  action?: "analyze" | "accept" | "report";
  url?: string;
  videoId?: string;
  message?: string;
};

type AuthUser = {
  id: string;
  email: string | null;
};

type QuotaState = {
  allowed: boolean;
  charged: boolean;
  remaining: number | null;
  message?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const freeMonthlyLimit = Number(Deno.env.get("FREE_MONTHLY_ANALYSES") || "20");

const failureCopy: Record<FailureReason, string> = {
  not_recipe: "요리 영상으로 판단되지 않았습니다.",
  unavailable: "비공개, 삭제, 일부공개, 지역 제한 영상일 수 있습니다.",
  schema_invalid: "분석 결과가 저장 가능한 형식이 아니었습니다.",
  insufficient_content: "재료나 단계 정보가 부족해 보정이 필요합니다.",
  too_long: "영상이 너무 길어 자동 분석 전 확인이 필요합니다.",
  api_unavailable: "Gemini API 제한 또는 일시 장애가 발생했습니다.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(failure("edge", "api_unavailable", "POST만 지원합니다."), 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(failure("edge", "api_unavailable", "Supabase 환경 변수가 없습니다."), 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const authHeader = req.headers.get("Authorization") || "";
  const authUser = await getAuthUser(supabase, authHeader);
  const userId = authUser?.id || null;

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json(failure("edge", "schema_invalid", "요청 JSON을 읽을 수 없습니다."), 400);
  }

  const videoId = body.videoId || extractVideoId(body.url || "");
  if (!videoId) {
    return json(failure("edge", "unavailable", "YouTube videoId를 찾을 수 없습니다."), 400);
  }

  if (body.action === "accept" || body.action === "report") {
    if (!userId) {
      return json(failure("edge", "api_unavailable", "로그인이 필요합니다."), 401);
    }
    const result = await recordQualitySignal(supabase, videoId, userId, body.action, body.message);
    if (!result.ok) {
      return json(failure("edge", result.reason, result.message), result.status);
    }
    return json({
      ok: true,
      source: "edge",
      analysis: null,
      failure: null,
      quota: { charged: false, remaining: null },
    });
  }

  const cached = await readCachedAnalysis(supabase, videoId);
  if (cached) {
    return json({
      ok: true,
      source: "cache",
      analysis: cached,
      failure: null,
      quota: { charged: false, remaining: null },
    });
  }

  const mockFailure = detectMockFailure(body.url || "");
  if (mockFailure) {
    await logFailure(supabase, videoId, userId, mockFailure);
    return json(failure("edge", mockFailure), 200);
  }

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const quota = geminiKey && authUser
    ? await readQuotaState(supabase, authUser)
    : { allowed: true, charged: false, remaining: null };
  if (!quota.allowed) {
    return json(failure("edge", "api_unavailable", quota.message, quota), 200);
  }

  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  // 2.5-flash-lite는 가벼운 모델이라 별도 capacity pool에 가까움 — flash/pro 고수요 시 먼저 회피.
  // (2.0-flash는 2026년에 신규 사용자에게 deprecated 되어 404 반환됨)
  const fallbackModel = Deno.env.get("GEMINI_FALLBACK_MODEL") || "gemini-2.5-flash-lite";
  const secondaryFallbackModel = Deno.env.get("GEMINI_SECONDARY_FALLBACK_MODEL") || "gemini-2.5-pro";
  const analysisResult = geminiKey
    ? await analyzeWithGemini({
      apiKey: geminiKey,
      model,
      fallbackModel,
      secondaryFallbackModel,
      url: body.url || `https://youtu.be/${videoId}`,
      videoId,
    })
    : { ok: true as const, analysis: makeMockAnalysis(videoId), source: "mock" as const };

  if (!analysisResult.ok) {
    await logFailure(supabase, videoId, userId, analysisResult.reason, analysisResult.message);
    // Gemini의 raw 영문 에러 메시지는 로그에만 남기고, 사용자에겐 failureCopy[reason]만 노출
    return json(failure("gemini", analysisResult.reason), 200);
  }

  const analysis = analysisResult.analysis;
  const { error } = await supabase.from("video_analyses").upsert({
    youtube_video_id: videoId,
    title: analysis.title,
    raw_recipe: analysis,
    suggested_category: analysis.suggestedCategory,
    confidence: analysis.confidence,
    status: analysis.needsReview ? "needs_review" : "ready",
    needs_review: analysis.needsReview,
    thumbnail_url_yt: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    model_version: analysisResult.source === "gemini" ? analysisResult.model : "edge-mock-v1",
    last_validated_at: new Date().toISOString(),
  });

  if (error) {
    await logFailure(supabase, videoId, userId, "api_unavailable", error.message);
    return json(failure("edge", "api_unavailable"), 500);
  }

  const chargedQuota = analysisResult.source === "gemini" && authUser
    ? await chargeQuota(supabase, authUser)
    : quota;

  return json({
    ok: true,
    source: analysisResult.source,
    analysis,
    failure: null,
    quota: {
      charged: chargedQuota.charged,
      remaining: chargedQuota.remaining,
    },
  });
});

async function getAuthUser(supabase: ReturnType<typeof createClient>, authHeader: string): Promise<AuthUser | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data } = await supabase.auth.getUser(token);
  if (!data.user) return null;
  return {
    id: data.user.id,
    email: data.user.email || null,
  };
}

async function readCachedAnalysis(supabase: ReturnType<typeof createClient>, videoId: string) {
  const { data, error } = await supabase
    .from("video_analyses")
    .select("raw_recipe, status, needs_review, confidence")
    .eq("youtube_video_id", videoId)
    .maybeSingle();
  if (error || !data || data.status === "failed") return null;
  return {
    ...(data.raw_recipe as Record<string, unknown>),
    confidence: Number(data.confidence ?? (data.raw_recipe as Record<string, unknown>).confidence ?? 0),
    needsReview: Boolean(data.needs_review || data.status === "needs_review"),
  };
}

async function logFailure(
  supabase: ReturnType<typeof createClient>,
  videoId: string,
  userId: string | null,
  reason: FailureReason,
  message?: string,
) {
  await supabase.from("analysis_failures").insert({
    youtube_video_id: videoId,
    user_id: userId,
    reason,
    message: message || failureCopy[reason],
  });
}

async function recordQualitySignal(
  supabase: ReturnType<typeof createClient>,
  videoId: string,
  userId: string,
  action: "accept" | "report",
  message?: string,
): Promise<{ ok: true } | { ok: false; reason: FailureReason; message: string; status: number }> {
  const { data, error } = await supabase
    .from("video_analyses")
    .select("accepted_count, reported_count")
    .eq("youtube_video_id", videoId)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: "api_unavailable", message: error.message, status: 500 };
  }
  if (!data) {
    return { ok: false, reason: "unavailable", message: "공유 분석 원본을 찾을 수 없습니다.", status: 404 };
  }

  const patch = action === "accept"
    ? {
      accepted_count: Number(data.accepted_count || 0) + 1,
      last_validated_at: new Date().toISOString(),
    }
    : {
      reported_count: Number(data.reported_count || 0) + 1,
      failure_reason: "schema_invalid" as const,
      status: "needs_review" as const,
      needs_review: true,
    };

  const update = await supabase
    .from("video_analyses")
    .update(patch)
    .eq("youtube_video_id", videoId);

  if (update.error) {
    return { ok: false, reason: "api_unavailable", message: update.error.message, status: 500 };
  }

  if (action === "report" && message) {
    await supabase.from("analysis_failures").insert({
      youtube_video_id: videoId,
      user_id: userId,
      reason: "schema_invalid",
      message,
    });
  }

  return { ok: true };
}

function json(payload: AnalyzeResponse, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function failure(
  source: AnalyzeResponse["source"],
  reason: FailureReason,
  message = failureCopy[reason],
  quota: QuotaState = { charged: false, remaining: null, allowed: true },
): AnalyzeResponse {
  return {
    ok: false,
    source,
    analysis: null,
    failure: { reason, message, chargeable: false },
    quota: { charged: false, remaining: quota.remaining },
  };
}

async function readQuotaState(
  supabase: ReturnType<typeof createClient>,
  user: AuthUser,
): Promise<QuotaState> {
  const profile = await ensureFreshProfile(supabase, user);
  if (!profile) return { allowed: true, charged: false, remaining: null };

  const limit = planLimit(profile.plan);
  if (limit == null) return { allowed: true, charged: false, remaining: null };

  const used = Number(profile.monthly_analyses_used || 0);
  const remaining = Math.max(0, limit - used);
  return {
    allowed: remaining > 0,
    charged: false,
    remaining,
    message: remaining > 0 ? undefined : "이번 달 분석 안전 한도를 모두 사용했습니다.",
  };
}

async function chargeQuota(
  supabase: ReturnType<typeof createClient>,
  user: AuthUser,
): Promise<QuotaState> {
  const profile = await ensureFreshProfile(supabase, user);
  if (!profile) return { allowed: true, charged: false, remaining: null };

  const limit = planLimit(profile.plan);
  if (limit == null) return { allowed: true, charged: true, remaining: null };

  const used = Number(profile.monthly_analyses_used || 0) + 1;
  const remaining = Math.max(0, limit - used);
  await supabase
    .from("profiles")
    .update({ monthly_analyses_used: used })
    .eq("id", user.id);

  return { allowed: true, charged: true, remaining };
}

async function ensureFreshProfile(supabase: ReturnType<typeof createClient>, user: AuthUser) {
  const { data } = await supabase
    .from("profiles")
    .select("id, plan, monthly_analyses_used, monthly_reset_at")
    .eq("id", user.id)
    .maybeSingle();

  let profile = data;
  if (!profile) {
    const insert = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email,
        monthly_analyses_used: 0,
        monthly_reset_at: nextMonthStartIso(),
      })
      .select("id, plan, monthly_analyses_used, monthly_reset_at")
      .single();
    profile = insert.data;
  }

  if (!profile) return null;

  if (new Date(profile.monthly_reset_at).getTime() <= Date.now()) {
    const reset = await supabase
      .from("profiles")
      .update({
        monthly_analyses_used: 0,
        monthly_reset_at: nextMonthStartIso(),
      })
      .eq("id", user.id)
      .select("id, plan, monthly_analyses_used, monthly_reset_at")
      .single();
    profile = reset.data || profile;
  }

  return profile;
}

function planLimit(plan: string | null | undefined) {
  if (plan === "pro" || plan === "family") return null;
  return freeMonthlyLimit;
}

function nextMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

function extractVideoId(text: string) {
  const match = text.match(/(?:youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return match?.[1] || null;
}

function detectMockFailure(input: string): FailureReason | null {
  const text = input.toLowerCase();
  if (text.includes("notrecipe")) return "not_recipe";
  if (text.includes("private") || text.includes("deleted")) return "unavailable";
  if (text.includes("schema")) return "schema_invalid";
  if (text.includes("weak")) return "insufficient_content";
  if (text.includes("toolong")) return "too_long";
  if (text.includes("apierr")) return "api_unavailable";
  return null;
}

async function analyzeWithGemini({
  apiKey,
  model,
  fallbackModel,
  secondaryFallbackModel,
  url,
  videoId,
}: {
  apiKey: string;
  model: string;
  fallbackModel: string;
  secondaryFallbackModel?: string;
  url: string;
  videoId: string;
}): Promise<
  | { ok: true; source: "gemini"; model: string; analysis: ReturnType<typeof makeMockAnalysis> }
  | { ok: false; reason: FailureReason; message?: string }
> {
  // Cascade: primary (2.5-flash) → fallback (2.5-flash-lite) → secondary (2.5-pro).
  // 각 단계 자체에 503/429 재시도가 들어있어 capacity 일시 부족을 최대한 흡수.
  const attempts: string[] = [model];
  if (fallbackModel && fallbackModel !== model) attempts.push(fallbackModel);
  if (secondaryFallbackModel && !attempts.includes(secondaryFallbackModel)) attempts.push(secondaryFallbackModel);

  type GeminiResult =
    | { ok: true; parsed: unknown }
    | { ok: false; reason: FailureReason; message?: string };
  let lastResult: GeminiResult = { ok: false, reason: "api_unavailable" };
  let usedModel = model;
  for (const m of attempts) {
    lastResult = await callGemini({ apiKey, model: m, url });
    if (lastResult.ok) {
      usedModel = m;
      break;
    }
    // schema_invalid · not_recipe 같은 결정적 실패는 모델을 바꿔도 동일하므로 즉시 중단
    if (lastResult.reason !== "api_unavailable") break;
  }
  const result = lastResult;

  if (!result.ok) return result;

  const normalized = normalizeGeminiRecipe(result.parsed, videoId);
  if (!normalized) {
    return { ok: false, reason: "schema_invalid" };
  }
  if (!normalized.isRecipe) {
    return { ok: false, reason: "not_recipe" };
  }
  if (normalized.ingredients.length === 0 || normalized.steps.length === 0 || normalized.confidence < 0.5) {
    return {
      ok: true,
      source: "gemini",
      model: usedModel,
      analysis: { ...normalized, needsReview: true },
    };
  }

  return {
    ok: true,
    source: "gemini",
    model: usedModel,
    analysis: normalized,
  };
}

async function callGemini({
  apiKey,
  model,
  url,
}: {
  apiKey: string;
  model: string;
  url: string;
}): Promise<
  | { ok: true; parsed: unknown }
  | { ok: false; reason: FailureReason; message?: string }
> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const requestBody = JSON.stringify({
    contents: [{
      parts: [
        { text: recipePrompt() },
        { file_data: { file_uri: url } },
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: recipeResponseSchema(),
    },
  });

  // 503/429 일시 부하 대비: 1.2초 백오프 후 1회 재시도
  const maxAttempts = 2;
  let response: Response | null = null;
  let attempt = 0;
  while (attempt < maxAttempts) {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: requestBody,
    }).catch(() => null);

    const transient = !response || response.status === 503 || response.status === 429;
    if (!transient) break;
    attempt += 1;
    if (attempt < maxAttempts) {
      console.error(`[gemini] transient status=${response?.status ?? "network"} model=${model} attempt=${attempt}/retrying`);
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  if (!response) {
    return { ok: false, reason: "api_unavailable" };
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    // 진단용 로그 — Supabase Functions 로그에서 status code + 본문 확인 가능
    console.error(`[gemini] status=${response.status} model=${model} body=${errorText.slice(0, 500)}`);
    return {
      ok: false,
      reason: mapGeminiFailure(response.status),
      message: compactGeminiError(response.status, errorText),
    };
  }

  const payload = await response.json().catch(() => null);
  const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("");
  if (!text) {
    return { ok: false, reason: "schema_invalid" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "schema_invalid" };
  }

  return { ok: true, parsed };
}

function recipePrompt() {
  return [
    "이 YouTube 요리 영상을 한국어 레시피로 구조화하세요.",
    "요리 영상이 아니면 isRecipe를 false로 반환하세요.",
    "channelName에는 셰프 개인명이 아니라 YouTube 채널명 또는 영상 출처명을 넣으세요. 확실하지 않으면 빈 문자열로 두세요.",
    "situationTagIds에는 허용된 태그 ID 중 적절한 것을 0~3개만 고르세요: party(홈파티), solo(혼밥), lunchbox(도시락), diet(다이어트), quick(초스피드), airfryer(에어프라이어), guest(손님상), late(야식).",
    "재료명, 수량, 단위, 조리 단계, 원본 영상 timestampSec, 팁을 추출하세요.",
    "확실하지 않은 값은 빈 문자열 또는 0으로 두고 confidence를 낮추세요.",
  ].join("\n");
}

function recipeResponseSchema() {
  return {
    type: "object",
    properties: {
      isRecipe: { type: "boolean" },
      confidence: { type: "number" },
      title: { type: "string" },
      channelName: { type: "string" },
      situationTagIds: {
        type: "array",
        items: {
          type: "string",
          enum: ["party", "solo", "lunchbox", "diet", "quick", "airfryer", "guest", "late"],
        },
      },
      suggestedCategory: {
        type: "string",
        enum: ["한식", "양식", "일식", "중식", "디저트", "기타"],
      },
      servings: { type: "integer" },
      cookTimeMin: { type: "integer" },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            amount: { type: "string" },
            unit: { type: "string" },
          },
          required: ["name", "amount", "unit"],
        },
      },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            order: { type: "integer" },
            text: { type: "string" },
            timestampSec: { type: "integer" },
          },
          required: ["order", "text", "timestampSec"],
        },
      },
      tips: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "isRecipe",
      "confidence",
      "title",
      "channelName",
      "situationTagIds",
      "suggestedCategory",
      "servings",
      "cookTimeMin",
      "ingredients",
      "steps",
      "tips",
    ],
  };
}

function normalizeGeminiRecipe(value: unknown, videoId: string) {
  if (!value || typeof value !== "object") return null;
  const recipe = value as Record<string, unknown>;
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        name: String(row.name || "").trim(),
        amount: String(row.amount || "").trim(),
        unit: String(row.unit || "").trim(),
      };
    }).filter((item) => item.name)
    : [];
  const steps = Array.isArray(recipe.steps)
    ? recipe.steps.map((item, index) => {
      const row = item as Record<string, unknown>;
      return {
        order: Number(row.order) || index + 1,
        text: String(row.text || "").trim(),
        timestampSec: Math.max(0, Number(row.timestampSec) || 0),
      };
    }).filter((step) => step.text)
    : [];

  return {
    youtubeVideoId: videoId,
    isRecipe: Boolean(recipe.isRecipe),
    title: String(recipe.title || "이름 없는 레시피").trim(),
    channelName: String(recipe.channelName || recipe.chefName || "").trim(),
    situationTagIds: normalizeSituationTagIds(recipe.situationTagIds),
    suggestedCategory: String(recipe.suggestedCategory || "기타").trim(),
    confidence: clamp(Number(recipe.confidence) || 0, 0, 1),
    needsReview: false,
    servings: Math.max(1, Number(recipe.servings) || 1),
    cookTimeMin: Math.max(0, Number(recipe.cookTimeMin) || 0),
    ingredients,
    steps,
    tips: Array.isArray(recipe.tips) ? recipe.tips.map((tip) => String(tip).trim()).filter(Boolean) : [],
  };
}

function normalizeSituationTagIds(value: unknown) {
  const allowed = new Set(["party", "solo", "lunchbox", "diet", "quick", "airfryer", "guest", "late"]);
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value.map((item) => String(item || "").trim()).filter((item) => allowed.has(item)),
  )).slice(0, 3);
}

function mapGeminiFailure(status: number): FailureReason {
  if (status === 400) return "schema_invalid";
  if (status === 403 || status === 404) return "unavailable";
  if (status === 429 || status >= 500) return "api_unavailable";
  return "api_unavailable";
}

function compactGeminiError(status: number, body: string) {
  if (!body) return `Gemini API 응답 오류 (${status})`;
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message;
    if (message) return `Gemini API 응답 오류 (${status}): ${String(message).slice(0, 180)}`;
  } catch {
    // fall through
  }
  return `Gemini API 응답 오류 (${status}): ${body.slice(0, 180)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function makeMockAnalysis(videoId: string) {
  return {
    youtubeVideoId: videoId,
    title: "새 레시피 (Edge 목업 분석)",
    channelName: "Edge 목업 채널",
    situationTagIds: ["quick"],
    suggestedCategory: "기타",
    confidence: 0.82,
    needsReview: false,
    servings: 2,
    cookTimeMin: 30,
    ingredients: [
      { name: "주재료", amount: "1", unit: "개" },
      { name: "양념", amount: "2", unit: "큰술" },
    ],
    steps: [
      { order: 1, text: "재료를 손질하고 팬을 예열한다.", timestampSec: 0 },
      { order: 2, text: "양념을 넣고 중불에서 익힌다.", timestampSec: 90 },
      { order: 3, text: "간을 보고 그릇에 담아 마무리한다.", timestampSec: 240 },
    ],
    tips: ["Gemini REST 연동 전까지 사용하는 Edge Function 계약 목업입니다."],
  };
}
