# Supabase 백엔드

이 디렉터리는 가족 레시피 앱의 백엔드 (Postgres + Auth + Edge Functions)를 정의합니다.

- **프로젝트 ref**: `xrrdokcjhjqdfvwtbenl`
- **대시보드**: https://supabase.com/dashboard/project/xrrdokcjhjqdfvwtbenl

## 데이터 모델

| 테이블 | 용도 |
|---|---|
| `profiles` | 유저 프로필 |
| `members` | 가족 구성원 (이름·이모지·색상) |
| `categories` | 레시피 카테고리 (기본 + 사용자 정의) |
| `recipes` | 레시피 본문 |
| `recipe_ingredients` / `recipe_steps` / `recipe_members` | 레시피 자식 테이블 |
| `video_analyses` | YouTube 분석 결과 캐시 (전체 사용자 공유) |
| `analysis_failures` | 분석 실패 로그 |
| `fridge_items` | 냉장고·냉동·실온보관 재료. `storage ∈ {'fridge','freezer','pantry'}` |
| `recipe_shares` | 외부 공유 링크 |
| `email_integrations` | Gmail OAuth refresh_token 저장 |
| `processed_emails` | 자동입고 처리 이력 (중복 방지) |

모든 사용자 소유 테이블은 RLS로 `auth.uid()` 기준 격리. 공유 캐시(`video_analyses`)는 인증 유저 읽기 가능, Edge Function 서비스 롤로만 쓰기.

## 마이그레이션 적용

```bash
supabase db push
```

또는 Supabase MCP `apply_migration` 사용. `migrations/` 안 SQL은 시간순 적용.

## Edge Functions

| 함수 | 역할 | verify_jwt |
|---|---|---|
| [`analyze-video`](functions/analyze-video) | YouTube URL → Gemini 영상 분석 + Qwen 댓글 요약 → `video_analyses` 캐시 | false |
| [`recipe-share`](functions/recipe-share) | 레시피 공유 링크 생성·조회 | false |
| [`gmail-oauth-callback`](functions/gmail-oauth-callback) | Gmail OAuth 콜백, refresh_token 저장 | false |
| [`ingest-orders`](functions/ingest-orders) | 주문 메일 검색 → Gemini 파싱 → 냉장고 자동입고 | false |

배포:

```bash
supabase functions deploy <function-name>
```

### 공통 환경 변수

```bash
supabase secrets set GEMINI_API_KEY=...
supabase secrets set GEMINI_MODEL=gemini-2.5-flash             # 기본값
supabase secrets set GEMINI_FALLBACK_MODEL=gemini-2.5-flash-lite
supabase secrets set GEMINI_SECONDARY_FALLBACK_MODEL=gemini-2.5-pro
supabase secrets set YOUTUBE_API_KEY=...      # 댓글 가져오기
supabase secrets set OPENROUTER_API_KEY=...   # Qwen 댓글 요약
```

### Gmail 자동입고 전용

[`functions/ingest-orders/README.md`](functions/ingest-orders/README.md) 참조.

## analyze-video API

요청:

```json
POST /functions/v1/analyze-video
{ "action": "analyze", "url": "https://www.youtube.com/watch?v=..." }
```

응답:

```json
{
  "ok": true,
  "source": "cache" | "gemini" | "mock" | "edge",
  "analysis": {
    "title": "...",
    "channelName": "...",
    "suggestedCategory": "한식",
    "ingredients": [...],
    "steps": [...],
    "tips": [...],
    "commentInsights": [{ "emoji": "🧂", "text": "설탕 반만 넣어도 충분히 답니다" }]
  },
  "failure": null,
  "quota": { "charged": false, "remaining": null }
}
```

품질 신호:

```json
{ "action": "accept", "videoId": "YOUTUBE_ID" }
{ "action": "report", "videoId": "YOUTUBE_ID", "message": "재료 누락" }
```

`accept`는 `accepted_count++`, `report`는 `reported_count++` 및 `needs_review` 표시.

## 프론트엔드 연결

기본값(`src/config.js`)이 prod URL로 설정돼 있어 별도 설정 불필요. 다른 환경을 쓰려면:

```js
localStorage.setItem("recipe-app:analyze-endpoint", "https://YOUR.functions.supabase.co/analyze-video");
localStorage.setItem("recipe-app:supabase-anon-key", "YOUR_SUPABASE_ANON_KEY");
location.reload();
```

요청 헤더: `apikey: <publishable_key>`, 로그인 시 `Authorization: Bearer <user_access_token>`, 익명 시 publishable key를 bearer로.

## pg_cron

`ingest-orders`는 10분 주기로 자동 실행됨. 스케줄 관리는 SQL Editor에서:

```sql
select * from cron.job;
select cron.unschedule('ingest-orders-every-10min');
```
