import { html, raw, ytThumbnail, formatTimestamp } from '../util.js';
import { consumeFlash, deleteRecipe, getState, toggleFavorite } from '../store.js';
import { deleteRecipeFromSupabase, syncRecipeToSupabase } from '../api/syncSupabase.js';

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
  const thumbStyle = thumb
    ? `width:100%;height:132px;border-radius:12px;background-color:var(--c-surface-3);background-image:url('${thumb}');background-size:cover;background-position:center`
    : 'width:100%;height:132px;border-radius:12px;background-color:var(--c-surface-3);background-size:cover;background-position:center';
  const ingredients = (recipe.ingredients || []).map((item) => html`
    <li><span>${item.name}</span><span class="amt">${item.amount || ''}${item.unit || ''}</span></li>
  `).join('');
  const steps = (recipe.steps || []).map((step) => html`
    <div class="step-item">
      <span class="num">${step.order}</span>
      <span class="text">${step.text}</span>
      <span class="ts">${formatTimestamp(step.timestampSec || 0)}</span>
    </div>
  `).join('');
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
      <button class="back-btn" data-action="back">← 뒤로</button>
      <div class="title">${recipe.title}</div>
      <button class="icon-btn ${recipe.isFavorite ? 'is-primary' : ''}" data-action="favorite">⭐</button>
    `,
    body: html`
      ${flash ? raw(`
        <div class="callout callout--olive">
          <span class="icon">✓</span>
          <div>${flash}</div>
        </div>
      `) : ''}
      <div class="detail-hero">
        <div class="cat">${category?.name || '기타'}</div>
        <h1>${recipe.title}</h1>
        <p class="sub">${recipe.sub || '개인 레시피'}</p>
        <div class="stats">
          <span>${recipe.cookTimeMin || 0}분</span>
          <span>${recipe.servings || 1}인분</span>
        </div>
        ${members ? raw(`<div class="member-tags">${members}</div>`) : ''}
      </div>
      <div class="detail-section">
        <div class="thumb" style="${raw(thumbStyle)}"></div>
      </div>
      <div class="detail-section">
        <h3>재료</h3>
        <ul class="ing-list">${raw(ingredients)}</ul>
      </div>
      <div class="detail-section">
        <h3>조리 순서</h3>
        <div class="steps">${raw(steps)}</div>
      </div>
      ${tips ? raw(`<div class="detail-section"><h3>팁</h3><ul class="tip-list">${tips}</ul></div>`) : ''}
      <div class="detail-section">
        <button class="btn btn--primary btn--block" data-action="edit-recipe" type="button">레시피 수정</button>
        <button class="btn btn--secondary btn--block" data-action="delete-recipe" type="button">레시피 삭제</button>
        <div class="field-help" id="delete-status"></div>
      </div>
    `,
    flush: true,
    showNav: false,
  };
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
    if (target.dataset.action === 'edit-recipe') {
      navigate(`/edit/${recipeId}`);
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
