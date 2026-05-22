import { esc, html, raw, parseLines } from '../util.js';
import { getState, setFlash, updateRecipe } from '../store.js';
import { syncRecipeToSupabase } from '../api/syncSupabase.js';

function ingredientRow(item = {}) {
  return `
    <div class="edit-row ingredient-edit-row" data-kind="ingredient">
      <input class="input" name="ingredientName" placeholder="재료" value="${esc(item.name || '')}" />
      <input class="input amount-input" name="ingredientAmount" placeholder="수량" value="${esc(item.amount ?? '')}" />
      <input class="input unit-input" name="ingredientUnit" placeholder="단위" value="${esc(item.unit || '')}" />
      <button class="icon-btn" type="button" data-action="remove-edit-row" title="삭제">×</button>
    </div>
  `;
}

function stepRow(item = {}, index = 0) {
  return `
    <div class="edit-row step-edit-row" data-kind="step">
      <span class="step-order">${index + 1}</span>
      <textarea class="textarea" name="stepText" rows="2" placeholder="조리 단계를 입력">${esc(item.text || '')}</textarea>
      <input class="input time-input" name="stepTimestamp" type="number" min="0" value="${esc(item.timestampSec ?? 0)}" />
      <button class="icon-btn" type="button" data-action="remove-edit-row" title="삭제">×</button>
    </div>
  `;
}

function renderMissing() {
  return {
    header: html`
      <button class="back-btn" data-action="back">← 뒤로</button>
      <div class="title">레시피 수정</div>
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

export function renderEditRecipe(recipeId) {
  const state = getState();
  const recipe = state.recipes.find((item) => item.id === recipeId);
  if (!recipe) return renderMissing();

  const categories = state.categories.filter((category) => category.id !== 'all');
  const categoryOptions = categories.map((category) => html`
    <option value="${category.id}" ${category.id === recipe.categoryId ? raw('selected') : ''}>
      ${category.icon} ${category.name}
    </option>
  `).join('');
  const ingredientRows = (recipe.ingredients?.length ? recipe.ingredients : [{}])
    .map((item) => ingredientRow(item))
    .join('');
  const stepRows = (recipe.steps?.length ? recipe.steps : [{}])
    .map((item, index) => stepRow(item, index))
    .join('');
  const memberChips = state.members.map((member) => html`
    <label class="check-chip">
      <input type="checkbox" name="memberIds" value="${member.id}" ${recipe.memberIds?.includes(member.id) ? raw('checked') : ''} />
      <span class="avatar avatar--sm is-${member.color || 'terra'}">${member.emoji || '👤'}</span>
      <span>${member.name}</span>
    </label>
  `).join('');
  return {
    header: html`
      <button class="back-btn" data-action="back">← 뒤로</button>
      <div class="title">레시피 수정</div>
      <div style="width:36px"></div>
    `,
    body: html`
      <form id="edit-recipe-form" class="stack">
        <label class="field">
          <span class="field-label">제목</span>
          <input class="input" name="title" value="${recipe.title || ''}" />
          <div class="field-error" data-error-for="title"></div>
        </label>

        <label class="field">
          <span class="field-label">채널</span>
          <input class="input" name="channelName" value="${recipe.channelName || recipe.chefName || ''}" placeholder="예: 백종원 PAIK's CUISINE" />
        </label>

        <div class="row">
          <label class="field" style="flex:1 1 120px">
            <span class="field-label">카테고리</span>
            <select class="select" name="categoryId">${raw(categoryOptions)}</select>
          </label>
          <label class="field" style="flex:1 1 90px">
            <span class="field-label">인분</span>
            <input class="input" name="servings" type="number" min="1" value="${recipe.servings || 1}" />
          </label>
          <label class="field" style="flex:1 1 90px">
            <span class="field-label">시간(분)</span>
            <input class="input" name="cookTimeMin" type="number" min="0" value="${recipe.cookTimeMin || 0}" />
          </label>
        </div>

        <div class="field">
          <span class="field-label">재료</span>
          <div class="edit-list" id="ingredient-list">${raw(ingredientRows)}</div>
          <button class="btn btn--secondary btn--block" type="button" data-action="add-ingredient">재료 추가</button>
          <div class="field-error" data-error-for="ingredients"></div>
        </div>

        <div class="field">
          <span class="field-label">조리 순서</span>
          <div class="edit-list" id="step-list">${raw(stepRows)}</div>
          <button class="btn btn--secondary btn--block" type="button" data-action="add-step">단계 추가</button>
          <div class="field-help">시간은 원본 영상의 초 단위입니다</div>
          <div class="field-error" data-error-for="steps"></div>
        </div>

        <label class="field">
          <span class="field-label">팁</span>
          <textarea class="textarea" name="tips" rows="3" placeholder="팁을 한 줄씩 입력">${(recipe.tips || []).join('\n')}</textarea>
        </label>

        <div class="field">
          <span class="field-label">좋아할 구성원</span>
          <div class="check-chip-row">${raw(memberChips)}</div>
        </div>

        <button class="btn btn--primary btn--lg btn--block" type="submit">수정 저장</button>
        <div class="field-help" id="edit-status"></div>
      </form>
    `,
    flush: false,
    showNav: false,
  };
}

export function bindEditRecipe(rootEl, navigate, recipeId) {
  rootEl.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (target?.dataset.action === 'back') history.back();
    if (target?.dataset.action === 'add-ingredient') {
      rootEl.querySelector('#ingredient-list')?.insertAdjacentHTML('beforeend', ingredientRow());
    }
    if (target?.dataset.action === 'add-step') {
      const list = rootEl.querySelector('#step-list');
      list?.insertAdjacentHTML('beforeend', stepRow({}, list.querySelectorAll('[data-kind="step"]').length));
      renumberSteps(list);
    }
    if (target?.dataset.action === 'remove-edit-row') {
      const row = target.closest('.edit-row');
      const list = row?.parentElement;
      if (list && list.querySelectorAll('.edit-row').length > 1) {
        row.remove();
        renumberSteps(list);
      }
    }
  });

  const form = rootEl.querySelector('#edit-recipe-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(form)) return;

    const previous = getState().recipes.find((item) => item.id === recipeId);
    if (!previous) return;

    const status = form.querySelector('#edit-status');
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    if (status) status.textContent = '저장 중...';

    const patch = readPatch(form);
    updateRecipe(recipeId, patch);
    const updated = getState().recipes.find((item) => item.id === recipeId);

    try {
      if (updated) await syncRecipeToSupabase(updated);
      setFlash('저장했습니다.');
    } catch (err) {
      console.warn('Supabase recipe edit sync failed', err);
      setFlash('저장에 실패했습니다. 네트워크 연결을 확인해주세요.');
    }

    navigate(`/recipe/${recipeId}`);
  });
}

function readPatch(form) {
  const memberIds = Array.from(form.querySelectorAll('input[name="memberIds"]:checked'))
    .map((input) => input.value);
  const ingredients = Array.from(form.querySelectorAll('[data-kind="ingredient"]'))
    .map((row) => ({
      name: row.querySelector('[name="ingredientName"]').value.trim(),
      amount: row.querySelector('[name="ingredientAmount"]').value.trim(),
      unit: row.querySelector('[name="ingredientUnit"]').value.trim(),
    }))
    .filter((item) => item.name);
  const steps = Array.from(form.querySelectorAll('[data-kind="step"]'))
    .map((row, index) => ({
      order: index + 1,
      text: row.querySelector('[name="stepText"]').value.trim(),
      timestampSec: Number(row.querySelector('[name="stepTimestamp"]').value) || 0,
    }))
    .filter((step) => step.text);

  return {
    title: form.title.value.trim(),
    channelName: form.channelName.value.trim(),
    categoryId: form.categoryId.value,
    cookTimeMin: Number(form.cookTimeMin.value) || 0,
    servings: Number(form.servings.value) || 1,
    memberIds,
    situationTagIds: [],
    ingredients,
    steps,
    tips: parseLines(form.tips.value),
  };
}

function validateForm(form) {
  clearErrors(form);
  const title = form.title.value.trim();
  const ingredientRows = Array.from(form.querySelectorAll('[data-kind="ingredient"]'));
  const stepRows = Array.from(form.querySelectorAll('[data-kind="step"]'));
  const hasIngredient = ingredientRows.some((row) => row.querySelector('[name="ingredientName"]').value.trim());
  const hasStep = stepRows.some((row) => row.querySelector('[name="stepText"]').value.trim());
  const errors = [];

  if (!title) errors.push({ key: 'title', message: '레시피 제목을 입력해주세요.', focus: form.title });
  if (!hasIngredient) errors.push({ key: 'ingredients', message: '재료를 하나 이상 입력해주세요.', focus: ingredientRows[0]?.querySelector('[name="ingredientName"]') });
  if (!hasStep) errors.push({ key: 'steps', message: '조리 단계를 하나 이상 입력해주세요.', focus: stepRows[0]?.querySelector('[name="stepText"]') });

  errors.forEach((error) => showError(form, error));
  if (errors.length) {
    errors[0].focus?.focus();
  }
  return errors.length === 0;
}

function clearErrors(form) {
  form.querySelectorAll('.field-error').forEach((node) => {
    node.textContent = '';
  });
}

function showError(form, error) {
  const node = form.querySelector(`[data-error-for="${error.key}"]`);
  if (node) node.textContent = error.message;
}

function renumberSteps(list) {
  list?.querySelectorAll('.step-order').forEach((node, index) => {
    node.textContent = index + 1;
  });
}
