import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code || code.length < 4) {
    return json({ error: "invalid_code" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // share_code로 레시피 조회 (서비스 롤 → RLS 우회)
  const { data: recipe, error } = await supabase
    .from("recipes")
    .select(`
      id,
      title,
      channel_name,
      situation_tag_ids,
      servings,
      cook_time_min,
      custom_notes,
      video_id,
      created_at,
      categories(name, icon),
      recipe_ingredients(name, amount, unit, sort_order),
      recipe_steps(step_order, text, timestamp_sec)
    `)
    .eq("share_code", code)
    .maybeSingle();

  if (error) {
    console.error("DB error", error);
    return json({ error: "db_error" }, 500);
  }

  if (!recipe) {
    return json({ error: "not_found" }, 404);
  }

  // 정렬
  const ingredients = [...(recipe.recipe_ingredients || [])]
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map(({ name, amount, unit }) => ({ name, amount, unit }));

  const steps = [...(recipe.recipe_steps || [])]
    .sort((a, b) => (a.step_order || 0) - (b.step_order || 0))
    .map(({ step_order, text, timestamp_sec }) => ({
      order: step_order,
      text,
      timestampSec: timestamp_sec || 0,
    }));

  const tips = String(recipe.custom_notes || "")
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean);

  return json({
    ok: true,
    recipe: {
      title: recipe.title,
      channelName: recipe.channel_name || "",
      categoryName: (recipe.categories as { name?: string; icon?: string } | null)?.name || "기타",
      categoryIcon: (recipe.categories as { name?: string; icon?: string } | null)?.icon || "",
      servings: recipe.servings || 1,
      cookTimeMin: recipe.cook_time_min || 0,
      videoId: recipe.video_id || null,
      ingredients,
      steps,
      tips,
    },
  });
});
