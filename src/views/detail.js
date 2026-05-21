import { esc, html, raw, ytThumbnail, formatTimestamp } from '../util.js';
import { consumeFlash, deleteRecipe, getState, toggleFavorite } from '../store.js';
import { deleteRecipeFromSupabase, syncRecipeToSupabase } from '../api/syncSupabase.js';
import { icon } from '../icons.js';

export function renderDetail(recipeId) {
  const state = getState();
  const recipe = state.recipes.find((item) => item.id === recipeId);
  if (!recipe) {
    return {
      header: html`
        <button class="back-btn" data-action="back">← 뒤로</button>
        <div class="title">레시피</div>
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

  const category = state.categories.find((item) => item.id === recipe.categoryId);
  const flash = consumeFlash();
  const thumb = ytThumbnail(recipe.videoId);
  const prefs = loadDetailPrefs(recipe.id, recipe.servings || 1);
  const targetServings = prefs.servings;
  const checkedSteps = new Set(prefs.checkedSteps || []);
  const thumbStyle = thumb ? `background-image:url('${thumb}')` : '';
  const videoUrl = getYouTubeUrl(recipe.videoId);
  const ingredients = (recipe.ingredients || []).map((item) => ingredientChip(item, recipe.servings || 1, targetServings)).join('');
  const steps = (recipe.steps || []).map((step, index) => {
    const stepId = String(step.order || index + 1);
    const isDone = checkedSteps.has(stepId);
    return html`
      <label class="cook-step ${isDone ? 'is-done' : ''}" data-step-row="${stepId}">
        <input type="checkbox" data-action="toggle-step" data-step-id="${stepId}" ${isDone ? 'checked' : ''} />
        <span class="cook-step-box"></span>
        <span class="cook-step-main">
          <span class="cook-step-text"><strong>${step.order || index + 1}.</strong> ${step.text}</span>
          ${step.timestampSec ? raw(`<span class="cook-step-time">${formatTimestamp(step.timestampSec || 0)}</span>`) : ''}
        </span>
      </label>
    `;
  }).join('');
  const tips = (recipe.tips || []).map((tip) => html`<li>${tip}</li>`).join('');
  const members = state.members
    .filter((member) => recipe.memberIds?.includes(member.id))
    .map((member) => html`
      <span class="chip chip--outline">
        <span class="avatar avatar--sm is-${member.color || 'terra'}">${member.emoji || '👤'}</span>
        ${member.name}
      </span>
    `).join('');

  return {
    header: html`
      <div></div>
    `,
    body: html`
      ${flash ? raw(`
        <div class="callout callout--olive">
          <span class="icon">✓</span>
          <div>${flash}</div>
        </div>
      `) : ''}
      <article class="recipe-detail-card v2-detail-card" data-recipe-id="${recipe.id}" data-base-servings="${recipe.servings || 1}" data-current-servings="${targetServings}">
        <div class="recipe-cover v2-cover" style="${raw(thumbStyle)}">
          <div class="detail-overlay detail-overlay-left">
            <button class="detail-round-btn" data-action="back" type="button" aria-label="뒤로">${raw(icon('chev-l', 18))}</button>
          </div>
          <div class="detail-overlay detail-overlay-right">
            <button class="detail-round-btn ${recipe.isFavorite ? 'is-on' : ''}" data-action="favorite" type="button" aria-label="즐겨찾기">${raw(icon('star', 17))}</button>
            ${videoUrl ? raw(`<a class="detail-video-btn" href="${esc(videoUrl)}" target="_blank" rel="noreferrer">${icon('external', 14)} 원본</a>`) : ''}
          </div>
        </div>
        <div class="recipe-detail-head">
          <div class="detail-kicker">
            <span class="detail-dot"></span>
            <span>${category?.name || '기타'}</span>
            ${getChannelName(recipe) ? raw(`<span class="detail-sep">·</span><span>${esc(getChannelName(recipe))}</span>`) : ''}
          </div>
          <h1>${recipe.title}</h1>
          <div class="detail-pills">
            ${videoUrl ? raw(`<a href="${esc(videoUrl)}" target="_blank" rel="noreferrer">${icon('play', 13)} 원본 영상 보기</a>`) : ''}
            <span>${recipe.cookTimeMin || 0}분</span>
            <span>${targetServings}인분</span>
          </div>
          ${members ? raw(`<div class="member-tags">${members}</div>`) : ''}
        </div>
        <section class="detail-section detail-section--soft">
          <div class="section-row">
            <div>
              <h3>재료</h3>
              <p class="section-note">기준: ${recipe.servings || 1}인분</p>
            </div>
            <div class="serving-control" aria-label="인분 조절">
              <button type="button" data-action="servings-down" aria-label="인분 줄이기">-</button>
              <strong><span data-role="servings-label">${targetServings}</span>인분</strong>
              <button type="button" data-action="servings-up" aria-label="인분 늘리기">+</button>
            </div>
          </div>
          <div class="ingredient-pills">${raw(ingredients)}</div>
        </section>
        <section class="detail-section">
          <h3>조리 순서</h3>
          <div class="cook-steps">${raw(steps)}</div>
        </section>
        ${tips ? raw(`<section class="detail-section"><h3>Tip</h3><ul class="tip-list">${tips}</ul></section>`) : ''}
        <section class="detail-section detail-actions">
          <button class="btn btn--primary btn--lg btn--block" data-action="start-cooking" type="button">${raw(icon('timer', 17))} 조리 모드 시작</button>
          <div class="detail-sub-actions">
            <button class="btn btn--secondary btn--block" data-action="edit-recipe" type="button">${raw(icon('edit', 15))} 수정</button>
            <button class="btn btn--secondary btn--block" data-action="delete-recipe" type="button">${raw(icon('trash', 15))} 삭제</button>
          </div>
          <div class="field-help" id="delete-status"></div>
        </section>
      </article>
    `,
    flush: true,
    hideHeader: true,
    showNav: false,
  };
}

function getChannelName(recipe) {
  return String(recipe.channelName || recipe.chefName || '').trim();
}

function getYouTubeUrl(videoId) {
  if (!videoId || String(videoId).startsWith('fake-')) return '';
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function bindDetail(rootEl, navigate, recipeId) {
  rootEl.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'back') history.back();
    if (target.dataset.action === 'favorite') {
      toggleFavorite(recipeId);
      const recipe = getState().recipes.find((item) => item.id === recipeId);
      if (recipe) {
        syncRecipeToSupabase(recipe).catch((err) => {
          console.warn('Supabase favorite sync failed', err);
        });
      }
    }
    if (target.dataset.action === 'servings-down' || target.dataset.action === 'servings-up') {
      const shell = rootEl.querySelector('.recipe-detail-card');
      if (!shell) return;
      const base = Number(shell.dataset.baseServings) || 1;
      const current = Number(shell.dataset.currentServings) || base;
      const next = target.dataset.action === 'servings-up'
        ? Math.min(20, current + 1)
        : Math.max(1, current - 1);
      updateServingsUi(rootEl, recipeId, next);
    }
    if (target.dataset.action === 'toggle-step') {
      const row = target.closest('[data-step-row]');
      row?.classList.toggle('is-done', target.checked);
      saveStepState(rootEl, recipeId);
    }
    if (target.dataset.action === 'edit-recipe') {
      navigate(`/edit/${recipeId}`);
    }
    if (target.dataset.action === 'start-cooking') {
      navigate(`/cook/${recipeId}`);
    }
    if (target.dataset.action === 'delete-recipe') {
      if (!confirm('이 레시피를 삭제할까요?')) return;
      const status = rootEl.querySelector('#delete-status');
      target.disabled = true;
      if (status) status.textContent = '삭제 중...';
      try {
        await deleteRecipeFromSupabase(recipeId);
      } catch (err) {
        console.warn('Supabase delete failed', err);
      }
      deleteRecipe(recipeId);
      navigate('/home');
    }
  });
}

function ingredientChip(item, baseServings, targetServings) {
  const amount = formatScaledAmount(item.amount, baseServings, targetServings);
  const displayAmount = [amount, item.unit || ''].filter(Boolean).join('');
  const label = [item.name, displayAmount].filter(Boolean).join(' ');
  return html`
    <span class="ingredient-pill"
          data-name="${item.name}"
          data-base-amount="${item.amount ?? ''}"
          data-unit="${item.unit || ''}">
      <span>${label}</span>
    </span>
  `;
}

function updateServingsUi(rootEl, recipeId, servings) {
  const shell = rootEl.querySelector('.recipe-detail-card');
  if (!shell) return;
  const baseServings = Number(shell.dataset.baseServings) || 1;
  shell.dataset.currentServings = String(servings);
  rootEl.querySelectorAll('[data-role="servings-label"]').forEach((node) => {
    node.textContent = String(servings);
  });
  rootEl.querySelectorAll('.detail-pills span').forEach((node) => {
    if (node.textContent.includes('인분')) node.textContent = `${servings}인분`;
  });
  rootEl.querySelectorAll('.ingredient-pill').forEach((node) => {
    const amount = formatScaledAmount(node.dataset.baseAmount, baseServings, servings);
    const unit = node.dataset.unit || '';
    const value = [amount, unit].filter(Boolean).join('');
    const name = node.dataset.name || '';
    node.querySelector('span').textContent = [name, value].filter(Boolean).join(' ');
  });
  saveDetailPrefs(recipeId, { servings });
}

function saveStepState(rootEl, recipeId) {
  const checkedSteps = Array.from(rootEl.querySelectorAll('[data-action="toggle-step"]:checked'))
    .map((input) => input.dataset.stepId);
  saveDetailPrefs(recipeId, { checkedSteps });
}

function prefsKey(recipeId) {
  return `recipe-app:detail:${recipeId}`;
}

function loadDetailPrefs(recipeId, baseServings) {
  try {
    const saved = readRawDetailPrefs(recipeId);
    return {
      servings: clampServings(saved.servings || baseServings),
      checkedSteps: Array.isArray(saved.checkedSteps) ? saved.checkedSteps : [],
    };
  } catch {
    return { servings: clampServings(baseServings), checkedSteps: [] };
  }
}

function saveDetailPrefs(recipeId, patch) {
  try {
    const current = readRawDetailPrefs(recipeId);
    localStorage.setItem(prefsKey(recipeId), JSON.stringify({ ...current, ...patch }));
  } catch {
    /* ignore */
  }
}

function readRawDetailPrefs(recipeId) {
  try {
    const saved = JSON.parse(localStorage.getItem(prefsKey(recipeId)) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function clampServings(value) {
  return Math.max(1, Math.min(20, Number(value) || 1));
}

function formatScaledAmount(value, baseServings, targetServings) {
  if (value == null || value === '') return '';
  const numeric = parseQuantity(value);
  if (numeric == null) return String(value);
  const scaled = numeric * ((Number(targetServings) || 1) / (Number(baseServings) || 1));
  return formatQuantity(scaled);
}

function parseQuantity(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return null;
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = text.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const num = Number(text.replace(/,/g, ''));
  return Number.isFinite(num) ? num : null;
}

function formatQuantity(value) {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
  if (value >= 10) return String(Math.round(value * 10) / 10);
  const rounded = Math.round(value * 4) / 4;
  if (Number.isInteger(rounded)) return String(rounded);
  const fractions = [
    [0.25, '1/4'],
    [0.5, '1/2'],
    [0.75, '3/4'],
  ];
  const whole = Math.floor(rounded);
  const rest = rounded - whole;
  const match = fractions.find(([n]) => Math.abs(n - rest) < 0.001);
  if (match) return whole ? `${whole} ${match[1]}` : match[1];
  return String(Math.round(value * 100) / 100);
}
