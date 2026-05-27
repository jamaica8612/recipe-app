// Gmail OAuth 콜백 처리
// 흐름: 프론트엔드가 Google OAuth 화면으로 보냄(scope=gmail.readonly, access_type=offline, prompt=consent)
//       redirect_uri = 이 함수의 URL, state = Supabase user access token(JWT)
//       이 함수가 code를 access_token+refresh_token으로 교환, email_integrations에 저장 후
//       앱으로 리다이렉트.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_URL = Deno.env.get("APP_URL") || "https://recipe-app.example/app.html";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const GOOGLE_REDIRECT_URI = Deno.env.get("GOOGLE_REDIRECT_URI") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // Supabase user access token
  const error = url.searchParams.get("error");

  if (error) return redirectToApp(`gmail_error=${encodeURIComponent(error)}`);
  if (!code || !state) return redirectToApp("gmail_error=missing_params");

  try {
    // 1. state(JWT)로 사용자 확인
    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
      global: { headers: { Authorization: `Bearer ${state}` } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(state);
    if (userError || !userData.user) {
      return redirectToApp("gmail_error=unauthorized");
    }
    const userId = userData.user.id;

    // 2. code → access_token + refresh_token 교환
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.refresh_token) {
      console.error("token exchange failed", tokenJson);
      return redirectToApp("gmail_error=token_exchange");
    }

    // 3. 이메일 주소 조회
    const meRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${tokenJson.access_token}` } },
    );
    const profile = await meRes.json();
    const emailAddress = profile.emailAddress || userData.user.email || "unknown";

    // 4. DB 저장 (service role)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { error: insertError } = await admin
      .from("email_integrations")
      .upsert({
        user_id: userId,
        provider: "gmail",
        email_address: emailAddress,
        refresh_token: tokenJson.refresh_token,
        is_active: true,
      }, { onConflict: "user_id,provider,email_address" });

    if (insertError) {
      console.error("db insert failed", insertError);
      return redirectToApp("gmail_error=db_save");
    }

    return redirectToApp(`gmail_connected=${encodeURIComponent(emailAddress)}`);
  } catch (e) {
    console.error("callback error", e);
    return redirectToApp("gmail_error=internal");
  }
});

function redirectToApp(query: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${APP_URL}#/settings?${query}` },
  });
}
