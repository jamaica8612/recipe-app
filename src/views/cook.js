import { esc, html, raw, formatTimestamp } from '../util.js';
import { getState } from '../store.js';
import { icon } from '../icons.js';

const TIMER_PRESETS = [60, 180, 300, 600];
let activeTimerId = null;
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
  const timerPresets = TIMER_PRESETS.map((seconds) => html`
    <button type="button" data-action="timer-set" data-seconds="${seconds}">${formatTimer(seconds)}</button>
  `).join('');
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
        data-total-steps="${steps.length}"
        data-timer-left="${state.timerLeft || 0}"
        data-timer-running="false">
        <div class="cook-top">
          <div class="cook-dots">${raw(dots)}</div>
          <span class="cook-count">${index + 1} / ${steps.length}</span>
        </div>

        <div class="cook-stage">
          <div class="cook-of">단계</div>
          <div class="cook-stepnum">${String(index + 1).padStart(2, '0')}</div>
          <p class="cook-text">${step.text}</p>

          <div class="cook-timer">
            <span class="cook-timer-label">${raw(icon('timer', 14))} 타이머</span>
            <span class="cook-digits" data-role="timer-digits">${formatTimer(state.timerLeft || 0)}</span>
            <div class="cook-timer-actions">
              <button type="button" data-action="timer-toggle">${state.timerLeft ? '시작' : '타이머 시작'}</button>
              <button type="button" data-action="timer-reset">초기화</button>
            </div>
            <div class="cook-timer-presets">${raw(timerPresets)}</div>
          </div>

          ${videoLink ? raw(`
            <a class="cook-link" href="${esc(videoLink)}" target="_blank" rel="noreferrer">
              ${icon('play', 12)} 영상의 ${formatTimestamp(step.timestampSec || 0)}부터 보기
            </a>
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
  clearInterval(activeTimerId);
  activeTimerId = null;
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
    if (target.dataset.action === 'timer-set') setTimer(rootEl, recipeId, Number(target.dataset.seconds) || 0);
    if (target.dataset.action === 'timer-reset') {
      stopTimer();
      setTimer(rootEl, recipeId, 0);
    }
    if (target.dataset.action === 'timer-toggle') {
      const running = shell.dataset.timerRunning === 'true';
      if (running) stopTimer();
      else startTimer();
      updateTimerButton(rootEl);
    }
  });

  function startTimer() {
    const shell = rootEl.querySelector('.cook-screen');
    if (!shell) return;
    if ((Number(shell.dataset.timerLeft) || 0) <= 0) {
      setTimer(rootEl, recipeId, 300);
    }
    shell.dataset.timerRunning = 'true';
    updateTimerButton(rootEl);
    clearInterval(activeTimerId);
    activeTimerId = setInterval(() => {
      const current = Number(shell.dataset.timerLeft) || 0;
      const next = Math.max(0, current - 1);
      shell.dataset.timerLeft = String(next);
      paintTimer(rootEl, next);
      saveCookPatch(rootEl, recipeId, { timerLeft: next });
      if (next <= 0) {
        stopTimer();
        shell.classList.add('is-timer-done');
      }
    }, 1000);
  }

  function stopTimer() {
    clearInterval(activeTimerId);
    activeTimerId = null;
    const shell = rootEl.querySelector('.cook-screen');
    if (shell) shell.dataset.timerRunning = 'false';
    updateTimerButton(rootEl);
  }

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

function setTimer(rootEl, recipeId, seconds) {
  const shell = rootEl.querySelector('.cook-screen');
  if (!shell) return;
  shell.classList.remove('is-timer-done');
  shell.dataset.timerLeft = String(Math.max(0, seconds));
  paintTimer(rootEl, seconds);
  saveCookPatch(rootEl, recipeId, { timerLeft: Math.max(0, seconds) });
}

function paintTimer(rootEl, seconds) {
  const node = rootEl.querySelector('[data-role="timer-digits"]');
  if (node) node.textContent = formatTimer(seconds);
}

function updateTimerButton(rootEl) {
  const shell = rootEl.querySelector('.cook-screen');
  const button = rootEl.querySelector('[data-action="timer-toggle"]');
  if (!shell || !button) return;
  button.textContent = shell.dataset.timerRunning === 'true' ? '일시정지' : '시작';
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
      timerLeft: Math.max(0, Number(saved.timerLeft) || 0),
    };
  } catch {
    return { index: 0, doneSteps: [], timerLeft: 0 };
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

function formatTimer(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}
