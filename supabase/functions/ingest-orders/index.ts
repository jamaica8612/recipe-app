// 주문 이메일 자동입고
// 트리거: pg_cron(주기적) 또는 프론트엔드 수동 호출
//   POST 본문 없음 → 활성 integration 전체 처리(cron 용도)
//   POST { user_id } → 특정 유저만 처리(수동 동기화)
// 흐름: refresh_token으로 access_token 갱신 → Gmail 검색(쇼핑몰 발신자, newer_than:7d)
//       → 미처리 메일만 Gemini로 항목 추출 → fridge_items insert → processed_emails 기록

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INGEST_TOKEN = Deno.env.get("INGEST_CRON_TOKEN") || ""; // cron 호출 시 보안

// 쇼핑몰 발신 패턴 — Gmail 검색 쿼리
const VENDOR_QUERY = [
  "from:cs@coupang.com",
  "from:no-reply@coupang.com",
  "from:noreply@kurly.com",
  "from:noreply@market.kurly.com",
  "from:cs@ssg.com",
  "from:noreply@emart.com",
].join(" OR ");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const body = await safeJson(req);
  const isCron = req.headers.get("x-cron-token") === INGEST_TOKEN && INGEST_TOKEN;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 처리 대상 integration 조회
  let query = admin.from("email_integrations").select("*").eq("is_active", true);
  if (body?.user_id && !isCron) {
    // 사용자 수동 호출 → 본인 것만 처리하도록 JWT 검증
    const auth = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    const { data: userData, error } = await admin.auth.getUser(auth);
    if (error || !userData.user || userData.user.id !== body.user_id) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    query = query.eq("user_id", body.user_id);
  } else if (!isCron && !body?.user_id) {
    return json({ ok: false, error: "missing user_id or cron token" }, 400);
  }

  const { data: integrations, error: listErr } = await query;
  if (listErr) return json({ ok: false, error: listErr.message }, 500);

  const results: unknown[] = [];
  for (const integ of integrations || []) {
    try {
      results.push(await processIntegration(admin, integ));
    } catch (e) {
      console.error("integration failed", integ.id, e);
      results.push({ integration_id: integ.id, ok: false, error: String(e) });
    }
  }

  return json({ ok: true, results });
});

async function processIntegration(admin: any, integ: any) {
  const accessToken = await refreshAccessToken(integ.refresh_token);

  // 최근 7일 쇼핑몰 메일 검색
  const search = await gmailFetch(
    accessToken,
    `/users/me/messages?q=${encodeURIComponent(`(${VENDOR_QUERY}) newer_than:7d`)}&maxResults=20`,
  );
  const messages: { id: string; threadId: string }[] = search.messages || [];

  // 이미 처리한 message_id 제외
  const { data: processed } = await admin
    .from("processed_emails")
    .select("message_id")
    .eq("integration_id", integ.id)
    .in("message_id", messages.map((m) => m.id));
  const seen = new Set((processed || []).map((p: any) => p.message_id));

  let inserted = 0;
  for (const msg of messages) {
    if (seen.has(msg.id)) continue;

    const full = await gmailFetch(accessToken, `/users/me/messages/${msg.id}?format=full`);
    const headers = indexHeaders(full.payload?.headers || []);
    const bodyText = extractBodyText(full.payload);

    const parsed = await parseWithGemini({
      subject: headers.subject || "",
      from: headers.from || "",
      body: bodyText.slice(0, 8000),
    });

    if (!parsed?.items?.length) {
      await admin.from("processed_emails").insert({
        integration_id: integ.id,
        user_id: integ.user_id,
        message_id: msg.id,
        thread_id: msg.threadId,
        from_address: headers.from,
        subject: headers.subject,
        received_at: headers.date ? new Date(headers.date).toISOString() : null,
        status: "skipped",
        parsed_items: parsed || null,
      });
      continue;
    }

    const fridgeRows = parsed.items.map((item: any, idx: number) => ({
      user_id: integ.user_id,
      source_local_id: `email-${msg.id}-${idx}`,
      name: String(item.name || "").trim(),
      checked: true,
      storage: ["pantry", "freezer"].includes(item.storage) ? item.storage : "fridge",
      purchased_at: headers.date
        ? new Date(headers.date).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      expires_at: item.expires_at || null,
    })).filter((r: any) => r.name);

    const { data: insertedItems, error: insertErr } = await admin
      .from("fridge_items")
      .upsert(fridgeRows, { onConflict: "user_id,source_local_id" })
      .select("id");

    if (insertErr) {
      await admin.from("processed_emails").insert({
        integration_id: integ.id,
        user_id: integ.user_id,
        message_id: msg.id,
        thread_id: msg.threadId,
        from_address: headers.from,
        subject: headers.subject,
        status: "failed",
        error_message: insertErr.message,
        parsed_items: parsed,
      });
      continue;
    }

    inserted += insertedItems?.length || 0;
    await admin.from("processed_emails").insert({
      integration_id: integ.id,
      user_id: integ.user_id,
      message_id: msg.id,
      thread_id: msg.threadId,
      from_address: headers.from,
      subject: headers.subject,
      received_at: headers.date ? new Date(headers.date).toISOString() : null,
      status: "parsed",
      parsed_items: parsed,
      fridge_item_ids: (insertedItems || []).map((r: any) => r.id),
    });
  }

  await admin
    .from("email_integrations")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", integ.id);

  return { integration_id: integ.id, scanned: messages.length, inserted };
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function gmailFetch(accessToken: string, path: string): Promise<any> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`gmail ${path} ${res.status}`);
  return res.json();
}

function indexHeaders(headers: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) out[h.name.toLowerCase()] = h.value;
  return out;
}

function extractBodyText(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeB64(payload.body.data);
  if (Array.isArray(payload.parts)) {
    const text = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (text?.body?.data) return decodeB64(text.body.data);
    const html = payload.parts.find((p: any) => p.mimeType === "text/html");
    if (html?.body?.data) return stripHtml(decodeB64(html.body.data));
    for (const part of payload.parts) {
      const inner = extractBodyText(part);
      if (inner) return inner;
    }
  }
  return "";
}

function decodeB64(data: string): string {
  try {
    const norm = data.replace(/-/g, "+").replace(/_/g, "/");
    return new TextDecoder().decode(Uint8Array.from(atob(norm), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function parseWithGemini(input: { subject: string; from: string; body: string }): Promise<any> {
  if (!GEMINI_API_KEY) return { items: [] };

  const prompt = `다음은 한국 쇼핑몰(쿠팡/마켓컬리/SSG/이마트몰)의 주문 확정 이메일이야.
주문한 식료품 항목을 추출해 JSON으로 반환해.

규칙:
- 식료품/식자재만 추출 (배송비, 쿠폰, 비식품 제외)
- storage 분류:
  * "fridge" — 고기(닭/돼지/소/오리)/생선/해산물/채소/과일/우유/계란/두부/김치/요거트/치즈/반찬류 → 기본값, 애매하면 fridge
  * "freezer" — 상품명에 "냉동" 명시 또는 냉동만두/냉동피자/아이스크림/냉동돈까스/냉동새우/냉동과일 등
  * "pantry" — 라면/통조림/조미료/과자/쌀/파스타/오일/장류/레토르트/건과류 등 상온 보관 확실한 것만
- 수량/단위는 가능한 경우만
- 항목이 없거나 주문 메일이 아니면 items: []

제목: ${input.subject}
발신: ${input.from}
본문:
${input.body}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    quantity: { type: "string" },
                    unit: { type: "string" },
                    storage: { type: "string", enum: ["fridge", "freezer", "pantry"] },
                  },
                  required: ["name", "storage"],
                },
              },
            },
            required: ["items"],
          },
        },
      }),
    },
  );

  if (!res.ok) {
    console.error("gemini error", res.status, await res.text());
    return { items: [] };
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  try {
    return JSON.parse(text);
  } catch {
    return { items: [] };
  }
}

async function safeJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return null; }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
