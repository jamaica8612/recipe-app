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
  source: "cache" | "gemini" | "openrouter" | "mock" | "edge";
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

type CommentInsight = {
  emoji: string;
  text: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  const youtubeApiKey = Deno.env.get("YOUTUBE_API_KEY");
  const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");

  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  const fallbackModel = Deno.env.get("GEMINI_FALLBACK_MODEL") || "gemini-2.5-flash-lite";
  const secondaryFallbackModel = Deno.env.get("GEMINI_SECONDARY_FALLBACK_MODEL") || "gemini-2.5-pro";

  // 댓글 가져오기 + Gemini 분석을 병렬 실행
  // Gemini는 영상만 분석 (댓글 없이) → 빠르고 저렴
  // Qwen은 댓글만 요약 → 한국어 품질 우수, 저렴
  const [comments, geminiResult] = await Promise.all([
    youtubeApiKey ? fetchYouTubeComments(videoId, youtubeApiKey) : Promise.resolve([]),
    geminiKey
      ? analyzeWithGemini({
        apiKey: geminiKey,
        model,
        fallbackModel,
        secondaryFallbackModel,
        url: body.url || `https://youtu.be/${videoId}`,
        videoId,
      })
      : Promise.resolve({ ok: true as const, analysis: makeMockAnalysis(videoId), source: "mock" as const }),
  ]);

  // Gemini 전체 실패 시 OpenRouter 텍스트 기반 폴백
  type AnyAnalysisResult =
    | { ok: true; source: "gemini" | "openrouter" | "mock"; model?: string; analysis: ReturnType<typeof makeMockAnalysis> }
    | { ok: false; reason: FailureReason; message?: string };
  let analysisResult: AnyAnalysisResult = geminiResult as AnyAnalysisResult;
  if (!geminiResult.ok && (geminiResult as { reason: FailureReason }).reason === "api_unavailable" && openrouterKey) {
    console.log("[fallback] Gemini unavailable, trying OpenRouter text fallback");
    const orResult = await analyzeWithOpenRouter({ videoId, youtubeApiKey: youtubeApiKey || null, openrouterKey });
    if (orResult.ok) analysisResult = orResult as AnyAnalysisResult;
  }

  if (!analysisResult.ok) {
    const failResult = analysisResult as { reason: FailureReason; message?: string };
    await logFailure(supabase, videoId, userId, failResult.reason, failResult.message);
    return json(failure("gemini", failResult.reason), 200);
  }

  // 댓글 요약: OpenRouter Qwen이 있으면 사용, 없으면 빈 배열
  const commentInsights: CommentInsight[] = (openrouterKey && comments.length > 0)
    ? await summarizeCommentsWithQwen(comments, openrouterKey)
    : [];

  const analysis = {
    ...analysisResult.analysis,
    commentInsights,
  };

  const { error } = await supabase.from("video_analyses").upsert({
    youtube_video_id: videoId,
    title: analysis.title,
    raw_recipe: analysis,
    suggested_category: analysis.suggestedCategory,
    confidence: analysis.confidence,
    status: analysis.needsReview ? "needs_review" : "ready",
    needs_review: analysis.needsReview,
    thumbnail_url_yt: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    model_version: analysisResult.source === "gemini"
      ? (analysisResult as { model: string }).model
      : analysisResult.source === "openrouter"
        ? `openrouter-${(analysisResult as { model: string }).model}`
        : "edge-mock-v1",
    last_validated_at: new Date().toISOString(),
  });

  if (error) {
    await logFailure(supabase, videoId, userId, "api_unavailable", error.message);
    return json(failure("edge", "api_unavailable"), 500);
  }

  return json({
    ok: true,
    source: analysisResult.source,
    analysis,
    failure: null,
    quota: {
      charged: false,
      remaining: null,
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
): AnalyzeResponse {
  return {
    ok: false,
    source,
    analysis: null,
    failure: { reason, message, chargeable: false },
    quota: { charged: false, remaining: null },
  };
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

// 댓글 요약 — OpenRouter Qwen2.5-72B (한국어 특화, 저렴)
async function summarizeCommentsWithQwen(
  comments: string[],
  apiKey: string,
): Promise<CommentInsight[]> {
  try {
    const commentText = comments.slice(0, 50).join("\n");
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://jamaica8612.github.io/recipe-app/",
        "X-Title": "Recipe App",
      },
      body: JSON.stringify({
        model: "qwen/qwen-2.5-72b-instruct",
        messages: [
          {
            role: "user",
            content: `아래는 유튜브 요리 영상의 시청자 댓글입니다.
이 댓글들을 분석해서 시청자들의 주요 의견을 3~5개로 요약하세요.

댓글:
${commentText}

반드시 JSON 배열만 반환하세요 (다른 텍스트 없이):
[{"emoji": "이모지1개", "text": "한 줄 한국어 요약"}, ...]

규칙:
- 맛 평가, 재료 대체, 조리 팁, 양 조절 등 실질적으로 도움되는 의견 우선
- 단순 칭찬("맛있겠다", "해봐야지")은 제외
- 의미있는 의견이 없으면 [] 반환`,
          },
        ],
        max_tokens: 600,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      console.error(`[qwen] status=${response.status}`);
      return [];
    }

    const data = await response.json();
    const text = (data.choices?.[0]?.message?.content || "").trim();
    console.log(`[qwen] response: ${text.slice(0, 200)}`);

    // JSON 배열 추출 (마크다운 코드블록 등 감싸진 경우 처리)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item: unknown) => {
        const i = item as Record<string, unknown>;
        return {
          emoji: String(i.emoji || "💬").trim().slice(0, 4),
          text: String(i.text || "").trim(),
        };
      })
      .filter((i) => i.text)
      .slice(0, 5);
  } catch (err) {
    console.error(`[qwen] error: ${err}`);
    return [];
  }
}

function recipePrompt() {
  return [
    "이 YouTube 요리 영상을 한국어 레시피로 구조화하세요.",
    "요리 영상이 아니면 isRecipe를 false로 반환하세요.",
    "channelName에는 셰프 개인명이 아니라 YouTube 채널명 또는 영상 출처명을 넣으세요. 확실하지 않으면 빈 문자열로 두세요.",
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
    suggestedCategory: String(recipe.suggestedCategory || "기타").trim(),
    confidence: clamp(Number(recipe.confidence) || 0, 0, 1),
    needsReview: false,
    servings: Math.max(1, Number(recipe.servings) || 1),
    cookTimeMin: Math.max(0, Number(recipe.cookTimeMin) || 0),
    ingredients,
    steps,
    tips: Array.isArray(recipe.tips) ? recipe.tips.map((tip) => String(tip).trim()).filter(Boolean) : [],
    commentInsights: [] as CommentInsight[], // Qwen이 채움
  };
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

async function fetchYouTubeComments(videoId: string, apiKey: string): Promise<string[]> {
  try {
    const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${encodeURIComponent(videoId)}&maxResults=50&order=relevance&key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resp.ok) return [];
    type CommentItem = { snippet?: { topLevelComment?: { snippet?: { textDisplay?: string } } } };
    const data = await resp.json() as { items?: CommentItem[] };
    return (data.items || [])
      .map((item) => item?.snippet?.topLevelComment?.snippet?.textDisplay || "")
      .filter(Boolean)
      .slice(0, 50);
  } catch {
    return [];
  }
}

// OpenRouter 텍스트 폴백 — Gemini 전체 실패 시
async function analyzeWithOpenRouter({
  videoId,
  youtubeApiKey,
  openrouterKey,
}: {
  videoId: string;
  youtubeApiKey: string | null;
  openrouterKey: string;
}): Promise<
  | { ok: true; source: "openrouter"; model: string; analysis: ReturnType<typeof makeMockAnalysis> }
  | { ok: false; reason: FailureReason; message?: string }
> {
  const [metadata, transcript] = await Promise.all([
    youtubeApiKey ? fetchVideoMetadata(videoId, youtubeApiKey) : Promise.resolve(null),
    fetchTranscript(videoId),
  ]);

  const titlePart = metadata?.title ? `제목: ${metadata.title}` : "";
  const descPart = metadata?.description ? `설명:\n${metadata.description.slice(0, 3000)}` : "";
  const transcriptPart = transcript ? `자막/스크립트:\n${transcript.slice(0, 4000)}` : "";
  const context = [titlePart, descPart, transcriptPart].filter(Boolean).join("\n\n");

  if (!context.trim()) {
    return { ok: false, reason: "api_unavailable", message: "영상 텍스트 정보를 가져올 수 없습니다." };
  }

  const prompt =
    `다음은 YouTube 요리 영상의 텍스트 정보입니다. 이를 분석해서 레시피를 추출하세요.\n` +
    `요리 영상이 아니면 isRecipe를 false로 반환하세요.\n` +
    `재료명, 수량, 단위, 조리 단계, 팁을 추출하세요.\n` +
    `확실하지 않은 값은 빈 문자열 또는 0으로 두고 confidence를 낮추세요.\n` +
    `timestampSec은 자막에서 확인된 경우에만 입력하고, 모르면 0으로 하세요.\n\n` +
    `${context}\n\n` +
    `반드시 다음 JSON 형식으로만 응답하세요:\n` +
    `{"isRecipe":true,"confidence":0.8,"title":"레시피 제목","channelName":"","suggestedCategory":"한식","servings":2,"cookTimeMin":30,` +
    `"ingredients":[{"name":"재료명","amount":"수량","unit":"단위"}],` +
    `"steps":[{"order":1,"text":"단계 설명","timestampSec":0}],"tips":["팁"]}`;

  const models = ["deepseek/deepseek-chat", "qwen/qwen-2.5-72b-instruct"];

  for (const model of models) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openrouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://jamaica8612.github.io/recipe-app/",
          "X-Title": "Recipe App",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2000,
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        console.error(`[openrouter] model=${model} status=${response.status}`);
        continue;
      }

      const data = await response.json();
      const text = (data.choices?.[0]?.message?.content || "").trim();
      if (!text) continue;

      let parsed: unknown;
      try {
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/({[\s\S]*})/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[1] : text);
      } catch {
        console.error(`[openrouter] parse error model=${model}`);
        continue;
      }

      const normalized = normalizeGeminiRecipe(parsed, videoId);
      if (!normalized) continue;
      if (!normalized.isRecipe) return { ok: false, reason: "not_recipe" };

      return {
        ok: true,
        source: "openrouter",
        model,
        analysis: { ...normalized, needsReview: normalized.confidence < 0.6 } as ReturnType<typeof makeMockAnalysis>,
      };
    } catch (err) {
      console.error(`[openrouter] model=${model} error=${err}`);
    }
  }

  return { ok: false, reason: "api_unavailable", message: "OpenRouter 분석 실패" };
}

async function fetchVideoMetadata(
  videoId: string,
  apiKey: string,
): Promise<{ title: string; description: string } | null> {
  try {
    const url =
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const snippet = data.items?.[0]?.snippet;
    if (!snippet) return null;
    return { title: snippet.title || "", description: snippet.description || "" };
  } catch {
    return null;
  }
}

async function fetchTranscript(videoId: string): Promise<string | null> {
  // 한국어 자막 → 영어 자막 → 자동생성 한국어/영어 순으로 시도
  const langs = ["ko", "en", "a.ko", "a.en"];
  for (const lang of langs) {
    try {
      const url =
        `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${lang}&fmt=json3`;
      const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (!Array.isArray(data.events) || !data.events.length) continue;
      const text = (data.events as Array<{ segs?: Array<{ utf8?: string }> }>)
        .flatMap((ev) => ev.segs || [])
        .map((seg) => seg.utf8 || "")
        .join("")
        .replace(/\n/g, " ")
        .trim();
      if (text.length > 100) return text;
    } catch {
      continue;
    }
  }
  return null;
}

function makeMockAnalysis(videoId: string) {
  return {
    youtubeVideoId: videoId,
    title: "새 레시피 (Edge 목업 분석)",
    channelName: "Edge 목업 채널",
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
    commentInsights: [] as CommentInsight[],
  };
}
