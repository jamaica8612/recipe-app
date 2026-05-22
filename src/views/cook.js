import { esc, html, raw, formatTimestamp } from '../util.js';
import { getState } from '../store.js';
import { icon } from '../icons.js';

let activeWakeLock = null;

export function renderCook(recipeId) {
  const recipe = getState().recipes.find((item) => item.id === recipeId);
  if (!recipe) {
    return {
      header: html`
        <button class="back-btn" data-action="back">← 뒤로</button>
        <div class="title">조리 모드</div>
        <div style="width:36px"></div>
      `,
      body: html`
        <div class="empty">
          <span class="emo">🍽</span>
          <div class="ttl">레시피를 찾을 수 없어요</div>
        </div>
      `,
      flush: false,
      showNav: false,
    };
  }

  const steps = recipe.steps?.length ? recipe.steps : [{ order: 1, text: '조리 단계를 입력해주세요.', timestampSec: 0 }];
  const state = loadCookState(recipe.id, steps.length);
  const index = Math.min(state.index, steps.length - 1);
  const step = steps[index];
  const doneSteps = new Set(state.doneSteps || []);
  const dots = steps.map((_, i) => {
    const cls = i < index || doneSteps.has(String(i)) ? 'is-done' : i === index ? 'is-on' : '';
    return `<span class="cook-dot ${cls}"></span>`;
  }).join('');
  const videoLink = recipe.videoId && !recipe.videoId.startsWith('fake-')
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(recipe.videoId)}&t=${Math.max(0, Number(step.timestampSec) || 0)}s`
    : '';

  return {
    header: html`
      <button class="back-btn" data-action="back">← 뒤로</button>
      <div class="title">조리 모드 · ${recipe.title}</div>
      <span class="cook-keepawake"><span class="led"></span> 화면 켜둠</span>
    `,
    body: html`
        <section class="cook-screen"
        data-recipe-id="${recipe.id}"
        data-step-index="${index}"
        data-total-steps="${steps.length}">
        <div class="cook-top">
          <div class="cook-dots">${raw(dots)}</div>
          <span class="cook-count">${index + 1} / ${steps.length}</span>
        </div>

        <div class="cook-stage">
          <div class="cook-of">단계</div>
          <div class="cook-stepnum">${String(index + 1).padStart(2, '0')}</div>
          <p class="cook-text">${step.text}</p>

          ${videoLink ? raw(`
            <button class="cook-link" type="button" data-action="show-video"
              data-video-id="${recipe.videoId}"
              data-timestamp="${step.timestampSec || 0}">
              ${icon('play', 12)} 영상의 ${formatTimestamp(step.timestampSec || 0)}부터 보기
            </button>
            <div class="cook-video-box" id="cook-video-box" hidden></div>
          `) : ''}
        </div>

        <div class="cook-bottom">
          <button class="cook-prev" type="button" data-action="prev-step" ${index === 0 ? 'disabled' : ''}>
            ${raw(icon('chev-l', 16))} 이전
          </button>
          <button class="cook-done" type="button" data-action="toggle-done">
            ${raw(icon('check', 16))} ${doneSteps.has(String(index)) ? '완료 취소' : '단계 완료'}
          </button>
          <button class="cook-next" type="button" data-action="next-step">
            ${index >= steps.length - 1 ? '끝내기' : '다음 단계'} ${raw(icon('chev-r', 16))}
          </button>
        </div>
      </section>
    `,
    flush: true,
    showNav: false,
  };
}

export function bindCook(rootEl, navigate, recipeId) {
  requestWakeLock();

  document.addEventListener('visibilitychange', handleVisibilityChange);

  rootEl.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const shell = rootEl.querySelector('.cook-screen');
    if (!shell) {
      if (target.dataset.action === 'back') history.back();
      return;
    }

    if (target.dataset.action === 'back') history.back();
    if (target.dataset.action === 'prev-step') moveStep(rootEl, navigate, recipeId, -1);
    if (target.dataset.action === 'next-step') moveStep(rootEl, navigate, recipeId, 1);
    if (target.dataset.action === 'toggle-done') toggleDone(rootEl, recipeId);
    if (target.dataset.action === 'show-video') toggleVideoBox(rootEl, target);
    if (target.dataset.action === 'close-video') closeVideoBox(rootEl);
  });

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') requestWakeLock();
  }
}

async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator)) return;
    activeWakeLock = await navigator.wakeLock.request('screen');
    activeWakeLock.addEventListener('release', () => {
      activeWakeLock = null;
    });
  } catch {
    activeWakeLock = null;
  }
}

function moveStep(rootEl, navigate, recipeId, delta) {
  const shell = rootEl.querySelector('.cook-screen');
  const total = Number(shell?.dataset.totalSteps) || 1;
  const index = Number(shell?.dataset.stepIndex) || 0;
  const next = index + delta;
  if (delta > 0 && next >= total) {
    navigate(`/recipe/${recipeId}`);
    return;
  }
  const clamped = Math.max(0, Math.min(total - 1, next));
  saveCookPatch(rootEl, recipeId, { index: clamped });
  navigate(`/cook/${recipeId}`);
}

function toggleDone(rootEl, recipeId) {
  const shell = rootEl.querySelector('.cook-screen');
  const index = String(Number(shell?.dataset.stepIndex) || 0);
  const state = loadCookState(recipeId, Number(shell?.dataset.totalSteps) || 1);
  const done = new Set(state.doneSteps || []);
  if (done.has(index)) done.delete(index);
  else done.add(index);
  saveCookPatch(rootEl, recipeId, { doneSteps: Array.from(done) });
  location.hash = `#/cook/${recipeId}`;
}

function key(recipeId) {
  return `recipe-app:cook:${recipeId}`;
}

function loadCookState(recipeId, totalSteps) {
  try {
    const saved = JSON.parse(localStorage.getItem(key(recipeId)) || '{}');
    return {
      index: Math.max(0, Math.min(totalSteps - 1, Number(saved.index) || 0)),
      doneSteps: Array.isArray(saved.doneSteps) ? saved.doneSteps : [],
    };
  } catch {
    return { index: 0, doneSteps: [] };
  }
}

function saveCookPatch(rootEl, recipeId, patch) {
  const shell = rootEl.querySelector('.cook-screen');
  const current = loadCookState(recipeId, Number(shell?.dataset.totalSteps) || 1);
  try {
    localStorage.setItem(key(recipeId), JSON.stringify({ ...current, ...patch }));
  } catch {
    /* ignore */
  }
}

function toggleVideoBox(rootEl, btn) {
  const box = rootEl.querySelector('#cook-video-box');
  if (!box) return;
  if (!box.hidden) {
    closeVideoBox(rootEl);
    return;
  }
  const videoId = encodeURIComponent(btn.dataset.videoId || '');
  const ts = Number(btn.dataset.timestamp) || 0;
  box.innerHTML = `
    <div class="cook-video-header">
      <span>영상 미리보기</span>
      <button class="cook-video-close" type="button" data-action="close-video">✕ 닫기</button>
    </div>
    <iframe
      class="cook-video-iframe"
      src="https://www.youtube.com/embed/${videoId}?start=${ts}&autoplay=1"
      frameborder="0"
      allow="autoplay; encrypted-media; picture-in-picture"
      allowfullscreen
    ></iframe>
  `;
  box.hidden = false;
}

function closeVideoBox(rootEl) {
  const box = rootEl.querySelector('#cook-video-box');
  if (!box) return;
  box.innerHTML = '';
  box.hidden = true;
}
