# Supabase backend draft

This folder contains the first backend scaffold for the recipe app.

## Migration

Apply the schema:

```bash
supabase db push
```

The migration creates:

- `profiles`
- `categories`
- `members`
- `video_analyses`
- `analysis_failures`
- `recipes`
- `recipe_ingredients`
- `recipe_steps`
- `recipe_members`

RLS is enabled for all app tables. User-owned tables are restricted by `auth.uid()`. Shared video analysis cache is readable by authenticated users; writes are intended to happen from Edge Functions using the service role key.

## Edge Function

Deploy the draft function:

```bash
supabase secrets set GEMINI_API_KEY=your_gemini_key
supabase secrets set GEMINI_MODEL=gemini-2.5-flash
supabase functions deploy analyze-video
```

`supabase/config.toml` currently sets `verify_jwt = false`, but the frontend sends the Supabase user access token in the `Authorization` header when a session exists. Anonymous requests still carry the publishable key for public analysis attempts.

Expected client response shape:

```json
{
  "ok": true,
  "source": "cache",
  "analysis": {},
  "failure": null,
  "quota": { "charged": false, "remaining": null }
}
```

The function supports cache lookup, failure logging, CORS, request validation, Gemini REST integration, and deterministic mock fallback. With `GEMINI_API_KEY` set, it calls Gemini REST `generateContent` using the YouTube URL as `file_data.file_uri`, requests JSON with `generationConfig.responseMimeType` and `responseJsonSchema`, then stores successful responses in `video_analyses`. Without `GEMINI_API_KEY`, it falls back to a deterministic mock response so the frontend contract remains testable.

There is no monthly application-level analysis limit. The response still includes `quota` with `{ "charged": false, "remaining": null }` for older frontend compatibility.

The same function also accepts quality events for shared analysis cache rows:

```json
{ "action": "accept", "videoId": "YOUTUBE_ID" }
```

`accept` increments `video_analyses.accepted_count` after a user saves a cached/analyzed recipe. `report` increments `reported_count` and marks the row as `needs_review`; both quality events require a signed-in user token and are handled with the service role inside the Edge Function.

## Local frontend connection

Point the static frontend at the deployed function:

```js
localStorage.setItem(
  "recipe-app:analyze-endpoint",
  "https://YOUR_PROJECT.functions.supabase.co/analyze-video",
);
localStorage.setItem("recipe-app:supabase-anon-key", "YOUR_SUPABASE_ANON_KEY");
location.reload();
```

The client sends the publishable key as `apikey`. If signed in, it sends `Authorization: Bearer <user access token>`; otherwise it falls back to the publishable key bearer header.
