// 분석 — AI 영상 분석 뷰
import { html, extractVideoId } from '../util.js';
import { createAnalysisDraft } from '../store.js';
import { analyzeVideo } from '../api/analyzeVideo.js';
import { getAnalyzeEndpoint } from '../config.js';

export function renderAnalyze() {
  return {
    header: html`
      <button class="back-btn" data-action="back">← 뒤로</button>
      <div class="title">새 레시피</div>
      <div style="width:36px"></div>
    `,
    body: html`
      <h1 class="page-title">URL 붙여넣기</h1>
      <p class="page-sub">유튜브 요리 영상을 붙여넣으면 자동으로 정리됩니다.</p>

      <div class="field">
        <label class="field-label">YouTube URL</label>
        <input class="input" id="yt-url" placeholder="https://youtu.be/..." autofocus />
        <div class="field-help" id="yt-help">짧은 형식·shorts 모두 인식합니다</div>
      </div>

      <button class="btn btn--primary btn--lg btn--block" data-action="analyze">분석 시작</button>
      <button class="btn btn--secondary btn--block" data-action="manual-entry">수동으로 입력</button>

      <div class="analyze-hint">
        💡 <strong style="color:var(--c-ink)">또는</strong> 유튜브 앱에서 <strong style="color:var(--c-ink)">공유하기</strong> → 이 앱을 선택하면 자동으로 분석이 시작됩니다.
      </div>

      <div id="analyze-status"></div>
    `,
    flush: false,
    showNav: true,
    activeNav: 'analyze',
  };
}

export function bindAnalyze(rootEl, navigate) {
  rootEl.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    if (t.dataset.action === 'back') {
      history.back();
    } else if (t.dataset.action === 'manual-entry') {
      const draftId = createAnalysisDraft({
        url: '',
        videoId: `fake-manual-${Date.now()}`,
        response: makeManualDraftResponse(),
      });
      navigate(`/preview/${draftId}`);
    } else if (t.dataset.action === 'analyze') {
      const input = rootEl.querySelector('#yt-url');
      const help = rootEl.querySelector('#yt-help');
      const status = rootEl.querySelector('#analyze-status');
      const videoId = extractVideoId(input.value);

      if (!videoId) {
        help.textContent = '⚠ 유효한 YouTube URL이 아닙니다';
        help.style.color = 'var(--c-danger)';
        return;
      }

      help.textContent = '영상 인식 완료';
      help.style.color = 'var(--c-ink-3)';
      t.disabled = true;
      status.innerHTML = `
        <div class="spinner-box">
          <div class="dots">●●●</div>
          <div style="margin-top:8px; font-size:var(--t-sm); color:var(--c-ink-2)">
            Gemini 분석 중…
          </div>
        </div>
      `;

      try {
        const response = await analyzeVideo({ url: input.value, videoId });
        const draftId = createAnalysisDraft({ url: input.value, videoId, response });
        navigate(`/preview/${draftId}`);
      } finally {
        t.disabled = false;
      }
    }
  });

  // 공유 인텐트로 들어왔을 때 URL이 query string에 있다면 자동 채우기
  const params = new URLSearchParams(location.search);
  const shared = normalizeSharedInput(params.get('url') || params.get('v'));
  if (shared) {
    const input = rootEl.querySelector('#yt-url');
    if (input) {
      input.value = shared;
      autoAnalyzeSharedUrl(rootEl, shared);
    }
  }
}

function normalizeSharedInput(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^[\w-]{11}$/.test(text)) return `https://youtu.be/${text}`;
  return text;
}

function autoAnalyzeSharedUrl(rootEl, shared) {
  const videoId = extractVideoId(shared);
  if (!videoId) return;

  const key = `recipe-app:auto-analyzed:${videoId}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    // If sessionStorage is unavailable, a normal tap still works.
  }

  setTimeout(() => {
    rootEl.querySelector('[data-action="analyze"]')?.click();
  }, 0);
}

function makeManualDraftResponse() {
  return {
    ok: true,
    source: 'manual',
    analysis: {
      youtubeVideoId: null,
      title: '',
      suggestedCategory: 'etc',
      confidence: null,
      needsReview: true,
      servings: 2,
      cookTimeMin: 30,
      ingredients: [{ name: '', amount: '', unit: '' }],
      steps: [{ order: 1, text: '', timestampSec: 0 }],
      tips: [],
    },
    failure: null,
    quota: { charged: false, remaining: null },
  };
}
