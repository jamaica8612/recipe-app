import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type HistoryItem = {
  role: "user" | "assistant";
  content: string;
};

type RequestBody = {
  recipe: {
    title: string;
    ingredients?: { name: string; amount?: number | string; unit?: string }[];
    steps?: { order: number; text: string }[];
    tips?: string[];
    servings?: number;
    cookTimeMin?: number;
    channelName?: string;
  };
  question: string;
  history?: HistoryItem[];
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST만 지원합니다." }, 405);
  }

  // Auth check
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, error: "서버 설정 오류" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const authHeader = req.headers.get("Authorization") || "";
  const { data: { user } } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", "")
  ).catch(() => ({ data: { user: null } }));

  if (!user) {
    return json({ ok: false, error: "로그인이 필요합니다." }, 401);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, 400);
  }

  const { recipe, question, history = [] } = body;
  if (!recipe || !question?.trim()) {
    return json({ ok: false, error: "recipe와 question이 필요합니다." }, 400);
  }

  const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!openrouterKey) {
    return json({ ok: false, error: "AI 기능이 설정되지 않았습니다." }, 500);
  }

  try {
    const answer = await askQwen({ recipe, question, history, apiKey: openrouterKey });
    return json({ ok: true, answer });
  } catch (err) {
    console.error("ask-recipe error:", err);
    return json({ ok: false, error: "답변 생성에 실패했습니다." }, 500);
  }
});

function buildRecipeContext(recipe: RequestBody["recipe"]): string {
  const lines: string[] = [`레시피명: ${recipe.title}`];
  if (recipe.channelName) lines.push(`채널: ${recipe.channelName}`);
  if (recipe.servings) lines.push(`기준 분량: ${recipe.servings}인분`);
  if (recipe.cookTimeMin) lines.push(`조리 시간: ${recipe.cookTimeMin}분`);

  if (recipe.ingredients?.length) {
    lines.push("\n재료:");
    for (const ing of recipe.ingredients) {
      const amt = [ing.amount, ing.unit].filter(Boolean).join("");
      lines.push(`- ${ing.name}${amt ? ` ${amt}` : ""}`);
    }
  }

  if (recipe.steps?.length) {
    lines.push("\n조리 순서:");
    for (const step of recipe.steps) {
      lines.push(`${step.order}. ${step.text}`);
    }
  }

  if (recipe.tips?.length) {
    lines.push("\nTip:");
    for (const tip of recipe.tips) {
      lines.push(`- ${tip}`);
    }
  }

  return lines.join("\n");
}

async function askQwen(params: {
  recipe: RequestBody["recipe"];
  question: string;
  history: HistoryItem[];
  apiKey: string;
}): Promise<string> {
  const { recipe, question, history, apiKey } = params;

  const systemPrompt = `당신은 요리 전문가입니다. 아래 레시피에 대한 질문에 한국어로 친절하고 간결하게 답변해주세요.

${buildRecipeContext(recipe)}

규칙:
- 답변은 2~4문장으로 간결하게
- 레시피와 관련 없는 질문에는 "이 레시피와 관련된 질문을 해주세요"라고 안내
- 재료 대체, 분량 조절, 조리 팁 등에 대한 질문에 적극적으로 답변`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-6), // 최근 6개 메시지만 컨텍스트로
    { role: "user", content: question },
  ];

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://jamaica8612.github.io/recipe-app/",
      "X-Title": "Recipe App",
    },
    body: JSON.stringify({
      model: "qwen/qwen-2.5-72b-instruct",
      messages,
      max_tokens: 400,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenRouter error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("빈 응답");
  return String(content).trim();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
