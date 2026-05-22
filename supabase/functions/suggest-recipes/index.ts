import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RecipeSnippet = {
  id: string;
  title: string;
  ingredients: string[];
};

type RequestBody = {
  fridgeItems: string[];
  recipes: RecipeSnippet[];
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST만 지원합니다." }, 405);
  }

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

  const { fridgeItems = [], recipes = [] } = body;
  if (!fridgeItems.length) {
    return json({ ok: false, error: "냉장고 재료가 없습니다." }, 400);
  }

  const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!openrouterKey) {
    return json({ ok: false, error: "AI 기능이 설정되지 않았습니다." }, 500);
  }

  try {
    const result = await suggestWithQwen({ fridgeItems, recipes, apiKey: openrouterKey });
    return json({ ok: true, ...result });
  } catch (err) {
    console.error("suggest-recipes error:", err);
    return json({ ok: false, error: "추천 생성에 실패했습니다." }, 500);
  }
});

async function suggestWithQwen(params: {
  fridgeItems: string[];
  recipes: RecipeSnippet[];
  apiKey: string;
}): Promise<{ suggestion: string; recommendedIds: string[] }> {
  const { fridgeItems, recipes, apiKey } = params;

  // 레시피 목록을 컴팩트하게 정리
  const recipeList = recipes.slice(0, 20).map((r) =>
    `[${r.id}] ${r.title} (재료: ${r.ingredients.slice(0, 6).join(", ")})`
  ).join("\n");

  const systemPrompt = `당신은 가족 요리 전문가입니다. 사용자의 냉장고 재료를 보고 오늘 뭘 만들지 추천해주세요.

냉장고 재료: ${fridgeItems.join(", ")}

저장된 레시피 목록:
${recipeList || "저장된 레시피 없음"}

답변 규칙:
1. 저장된 레시피 중 냉장고 재료와 잘 맞는 것 1~2개를 추천 (없으면 생략)
2. 냉장고 재료로 만들 수 있는 새로운 요리 아이디어 1개 제안
3. 따뜻하고 친근한 한국어로 3~5문장
4. 마지막 줄에 반드시 추천한 레시피 ID를 JSON 배열로: RECOMMENDED_IDS: ["id1","id2"]
   (추천 레시피 없으면 RECOMMENDED_IDS: [])`;

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
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "오늘 뭐 만들면 좋을까요?" },
      ],
      max_tokens: 500,
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenRouter error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("빈 응답");

  // RECOMMENDED_IDS 파싱
  const idMatch = content.match(/RECOMMENDED_IDS:\s*(\[.*?\])/s);
  let recommendedIds: string[] = [];
  if (idMatch) {
    try {
      recommendedIds = JSON.parse(idMatch[1]);
    } catch {
      recommendedIds = [];
    }
  }

  // RECOMMENDED_IDS 줄은 표시 텍스트에서 제거
  const suggestion = content.replace(/RECOMMENDED_IDS:\s*\[.*?\]/s, "").trim();

  return { suggestion, recommendedIds };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
