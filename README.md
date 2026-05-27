# 가족 레시피 (Recipe App)

YouTube 요리 영상을 AI로 분석해 가족 레시피북으로 정리하는 PWA.

## 핵심 기능

- 🎥 **YouTube 영상 → 레시피 자동 변환** — Gemini가 영상 분석, 재료·단계·타임스탬프 추출
- 💬 **댓글 주류 의견 요약** — Qwen2.5(OpenRouter)가 시청자 댓글에서 실용 팁만 골라 본문에 합침
- 🧊 **냉장고/❄️ 냉동/🥫 실온보관** — 보유 재료 트래커 + 만들 수 있는 레시피 매칭
- 📧 **Gmail 주문 메일 자동입고** — 쿠팡/컬리/SSG 주문 확정 메일을 감지해 재료 자동 추가
- 👨‍👩‍👧 **가족 멤버 협업** — 멤버별 좋아하는 레시피·알러지 관리
- ▶️ **조리 모드** — 단계별 타임스탬프로 영상 자동 재생
- 🔗 **레시피 공유 링크** — 가족 외부에 레시피 공유

## 기술 스택

- **프론트엔드**: Vanilla JS (빌드리스), Service Worker(PWA), 해시 라우터
- **백엔드**: Supabase (Postgres + Auth + Edge Functions + Storage)
- **AI**: Gemini 2.5 Flash (영상), Qwen 2.5 72B Instruct (댓글), Gemini 2.5 Flash (메일 파싱)
- **외부 API**: YouTube Data API (댓글), OpenRouter (Qwen 호스팅), Gmail API (주문 메일)
- **호스팅**: GitHub Pages

## 프로젝트 구조

```
recipe-app/
├── app.html             # 메인 진입점
├── index.html           # 랜딩
├── manifest.webmanifest # PWA manifest
├── sw.js                # Service Worker
├── styles.css
├── src/
│   ├── app.js           # 라우터/렌더링 진입점
│   ├── router.js        # 해시 라우터
│   ├── store.js         # 전역 상태 + localStorage 영속화
│   ├── config.js        # Supabase·OAuth 설정
│   ├── supabaseClient.js
│   ├── data.js          # 초기 시드 데이터
│   ├── icons.js         # SVG 아이콘
│   ├── ingredientMatch.js # 재료 퍼지 매칭
│   ├── util.js
│   ├── api/             # 백엔드 호출 래퍼
│   │   ├── analyzeVideo.js
│   │   ├── syncSupabase.js
│   │   ├── gmailIntegration.js
│   │   └── shareRecipe.js
│   └── views/           # 라우트별 화면
│       ├── home.js, search.js, analyze.js, preview.js
│       ├── detail.js, cook.js, editRecipe.js
│       ├── fridge.js    # 냉장고·냉동·실온보관 공용
│       ├── members.js, settings.js, account.js
│       └── share.js
└── supabase/            # 백엔드 (자세한 건 supabase/README.md)
```

## 로컬 실행

빌드 도구 없음. 정적 파일 서버 하나면 충분:

```bash
npx http-server . -p 5180 -c-1
# 브라우저에서 http://localhost:5180/app.html
```

## 배포

- **프론트엔드**: `main` 브랜치 push → GitHub Pages 자동 배포
- **DB 마이그레이션**: `supabase/migrations/` SQL 적용 (자세히는 `supabase/README.md`)
- **Edge Functions**: `supabase functions deploy <name>`

## 추가 문서

- [`supabase/README.md`](supabase/README.md) — 백엔드 (DB·Edge Functions)
- [`supabase/functions/ingest-orders/README.md`](supabase/functions/ingest-orders/README.md) — Gmail 자동입고 셋업
