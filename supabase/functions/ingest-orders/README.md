# Gmail 주문 자동입고 셋업

## 1. Google Cloud Console

1. https://console.cloud.google.com → 새 프로젝트
2. **APIs & Services → Library** → "Gmail API" 사용 설정
3. **OAuth consent screen** 설정
   - User type: **External**
   - App name, 지원 이메일 입력
   - Scopes: `.../auth/gmail.readonly` 추가
   - Test users: 사용할 가족 Gmail 주소 모두 등록 (최대 100명)
   - 검증 안 받아도 test user는 무제한 사용 가능
4. **Credentials → Create OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs:
     ```
     https://xrrdokcjhjqdfvwtbenl.functions.supabase.co/gmail-oauth-callback
     ```
   - 발급된 **Client ID**, **Client Secret** 복사

## 2. Supabase Secrets

```bash
supabase secrets set GOOGLE_CLIENT_ID=<from step 1>
supabase secrets set GOOGLE_CLIENT_SECRET=<from step 1>
supabase secrets set GOOGLE_REDIRECT_URI=https://xrrdokcjhjqdfvwtbenl.functions.supabase.co/gmail-oauth-callback
supabase secrets set APP_URL=https://YOUR-DEPLOYED-APP/app.html
supabase secrets set INGEST_CRON_TOKEN=<랜덤 문자열 32자>
# GEMINI_API_KEY 는 analyze-video와 공유
```

## 3. Edge Functions 배포

```bash
supabase functions deploy gmail-oauth-callback
supabase functions deploy ingest-orders
```

## 4. pg_cron 스케줄링 (10분마다)

Supabase SQL Editor에서 실행:

```sql
-- 확장 활성화 (1회만)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ingest-orders-every-10min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://xrrdokcjhjqdfvwtbenl.functions.supabase.co/ingest-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', '<INGEST_CRON_TOKEN 값과 동일>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

## 5. 프론트엔드 OAuth 시작 URL

```js
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
authUrl.searchParams.set("redirect_uri", "https://xrrdokcjhjqdfvwtbenl.functions.supabase.co/gmail-oauth-callback");
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.readonly");
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");
authUrl.searchParams.set("state", supabaseSessionAccessToken);
location.href = authUrl.toString();
```
