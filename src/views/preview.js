import { esc, html, raw, parseLines } from '../util.js';
import { getState, getAnalysisDraft, saveDraftAsRecipe } from '../store.js';
import { reportAnalysis } from '../api/analyzeVideo.js';
import { saveRecipeToSupabase } from '../api/syncSupabase.js';
import { SITUATION_TAGS } from '../data.js';

function ingredientRows(items = []) {
  const rows = items.length ? items : [{ name: '', amount: '', unit: '' }];
  return rows.map((item) => ingredientRow(item)).join('');
}

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

function stepRows(items = []) {
  const rows = items.length ? items : [{ text: '', timestampSec: 0 }];
  return rows.map((item, index) => stepRow(item, index)).join('');
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

function tipText(items = []) {
  return items.join('\n');
}

function resolveCategoryId(value, categories) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return 'etc';
  const byId = categories.find((category) => category.id === rawValue);
  if (byId) return byId.id;
  const byName = categories.find((category) => category.name === rawValue);
  return byName?.id || 'etc';
}

function sourceLabel(source) {
  if (source === 'cache') return '캐시 결과';
  if (source === 'manual') return '수동 입력';
  if (source === 'mock') return '목업 분석';
  return 'Gemini 결과';
}

function quotaNote(quota) {
  if (!quota || quota.remaining == null) return '';
  const prefix = quota.charged ? '이번 분석 1회 기록' : '사용량 기록 없음';
  return `${prefix} · 비용 보호 한도 ${quota.remaining}회 남음`;
}

function readRecipeFromForm(form, draft) {
  const analysis = draft.response.analysis || {};
  const memberIds = Array.from(form.querySelectorAll('input[name="memberIds"]:checked'))
    .map((input) => input.value);
  const situationTagIds = Array.from(form.querySelectorAll('input[name="situationTagIds"]:checked'))
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

  // 분석이 실패해 빈 폼이었다면 사용자가 모든 내용을 직접 입력했다는 뜻 → "수동 입력"으로 라벨.
  const hadAnalysisContent =
    Array.isArray(analysis.ingredients) && analysis.ingredients.length > 0
    || Array.isArray(analysis.steps) && analysis.steps.length > 0;
  const subLabel = draft.response.ok || hadAnalysisContent
    ? sourceLabel(draft.response.source)
    : '수동 입력';

  return {
    title: form.title.value.trim() || '이름 없는 레시피',
    sub: subLabel,
    channelName: form.channelName.value.trim(),
    categoryId: form.categoryId.value,
    cookTimeMin: Number(form.cookTimeMin.value) || 0,
    servings: Number(form.servings.value) || 1,
    memberIds,
    situationTagIds,
    videoId: draft.videoId,
    ingredients,
    steps,
    tips: parseLines(form.tips.value),
    analysisMeta: {
      source: draft.response.source,
      confidence: analysis.confidence ?? null,
      needsReview: Boolean(analysis.needsReview || !draft.response.ok),
    },
  };
}

export function renderPreview(draftId) {
  const draft = getAnalysisDraft(draftId);
  const categories = getState().categories.filter((category) => category.id !== 'all');

  if (!draft) {
    return {
      header: html`
        <button class="back-btn" data-action="back">← 뒤로</button>
        <div class="title">분석 미리보기</div>
        <div style="width:36px"></div>
      `,
      body: html`
        <div class="empty">
          <span class="emo">⚠</span>
          <div class="ttl">분석 초안을 찾을 수 없어요</div>
          <div>다시 분석을 시작해주세요.</div>
        </div>
      `,
      flush: false,
      showNav: false,
    };
  }

  const { response } = draft;
  const members = getState().members;
  const analysis = response.analysis || {};
  const failure = response.failure;
  const selectedCategoryId = resolveCategoryId(analysis.suggestedCategory, categories);
  // 신고는 "서버에 분석 결과가 실제로 캐시되어 다른 사용자에게도 노출되는" 케이스에서만 의미가 있음.
  // api_unavailable/schema_invalid처럼 결과 자체가 없는 실패는 신고할 대상이 없으므로 버튼 숨김.
  const hasReportableResult = !failure || failure.reason === 'insufficient_content';
  const canReportAnalysis =
    hasReportableResult &&
    draft.videoId &&
    !draft.videoId.startsWith('fake-') &&
    response.source !== 'manual';
  const quotaMessage = quotaNote(response.quota);
  const categoryOptions = categories.map((category) => html`
    <option value="${category.id}" ${category.id === selectedCategoryId ? raw('selected') : ''}>
      ${category.icon} ${category.name}
    </option>
  `).join('');
  const memberChips = members.map((member) => html`
    <label class="check-chip">
      <input type="checkbox" name="memberIds" value="${member.id}" />
      <span class="avatar avatar--sm is-${member.color || 'terra'}">${member.emoji || '👤'}</span>
      <span>${member.name}</span>
    </label>
  `).join('');
  const selectedSituationTags = new Set(Array.isArray(analysis.situationTagIds) ? analysis.situationTagIds : []);
  const situationChips = SITUATION_TAGS.map((tag) => html`
    <label class="check-chip">
      <input type="checkbox" name="situationTagIds" value="${tag.id}" ${selectedSituationTags.has(tag.id) ? raw('checked') : ''} />
      <span>${tag.icon}</span>
      <span>${tag.name}</span>
    </label>
  `).join('');
  const reviewNote = failure || analysis.needsReview || !analysis.ingredients?.length || !analysis.steps?.length
    ? html`
      <div class="callout callout--mustard">
        <span class="icon">!</span>
        <div><strong>보정 모드</strong><br>비어 있는 재료나 단계는 직접 추가해서 저장하세요.</div>
      </div>
    `
    : '';

  return {
    header: html`
      <button class="back-btn" data-action="back">← 뒤로</button>
      <div class="title">분석 미리보기</div>
      <div style="width:36px"></div>
    `,
    body: html`
      ${failure ? raw(`
        <div class="callout callout--danger">
          <span class="icon">⚠</span>
          <div><strong>카운트 차감 없음</strong><br>${failure.message} 필요한 내용만 보정해서 저장할 수 있습니다.</div>
        </div>
      `) : raw(`
        <div class="callout callout--olive">
          <span class="icon">✓</span>
          <div><strong>분석 완료</strong><br>${response.source} 결과입니다. 저장 전 내용을 확인하고 고쳐주세요.</div>
        </div>
      `)}
      ${quotaMessage ? raw(`
        <div class="field-help">${quotaMessage}</div>
      `) : ''}
      ${raw(reviewNote)}
      ${canReportAnalysis ? raw(`
        <button class="btn btn--secondary btn--block" type="button" data-action="report-analysis">
          분석 결과 신고
        </button>
        <div class="field-help" id="report-status"></div>
      `) : ''}

      <form id="preview-form" class="stack">
        <label class="field">
          <span class="field-label">제목</span>
          <input class="input" name="title" value="${analysis.title || ''}" />
          <div class="field-error" data-error-for="title"></div>
        </label>

        <label class="field">
          <span class="field-label">채널</span>
          <input class="input" name="channelName" value="${analysis.channelName || analysis.chefName || ''}" placeholder="예: 백종원 PAIK's CUISINE" />
          <div class="field-help">AI가 읽어온 출처입니다. 저장 전 직접 고칠 수 있어요.</div>
        </label>

        <div class="field">
          <span class="field-label">상황 태그</span>
          <div class="check-chip-row">${raw(situationChips)}</div>
          <div class="field-help">AI 추천 태그입니다. 저장 전 직접 바꿀 수 있어요.</div>
        </div>

        <div class="row">
          <label class="field" style="flex:1 1 120px">
            <span class="field-label">카테고리</span>
            <select class="select" name="categoryId">${raw(categoryOptions)}</select>
          </label>
          <label class="field" style="flex:1 1 90px">
            <span class="field-label">인분</span>
            <input class="input" name="servings" type="number" min="1" value="${analysis.servings || 2}" />
          </label>
          <label class="field" style="flex:1 1 90px">
            <span class="field-label">시간(분)</span>
            <input class="input" name="cookTimeMin" type="number" min="0" value="${analysis.cookTimeMin || 30}" />
          </label>
        </div>

        <div class="field">
          <span class="field-label">재료</span>
          <div class="edit-list" id="ingredient-list">${raw(ingredientRows(analysis.ingredients))}</div>
          <button class="btn btn--secondary btn--block" type="button" data-action="add-ingredient">재료 추가</button>
          <div class="field-error" data-error-for="ingredients"></div>
        </div>

        <div class="field">
          <span class="field-label">조리 순서</span>
          <div class="edit-list" id="step-list">${raw(stepRows(analysis.steps))}</div>
          <button class="btn btn--secondary btn--block" type="button" data-action="add-step">단계 추가</button>
          <div class="field-help">시간은 원본 영상의 초 단위입니다</div>
          <div class="field-error" data-error-for="steps"></div>
        </div>

        <label class="field">
          <span class="field-label">팁</span>
          <textarea class="textarea" name="tips" rows="3" placeholder="팁을 한 줄씩 입력">${tipText(analysis.tips)}</textarea>
        </label>

        <div class="field">
          <span class="field-label">좋아할 구성원</span>
          <div class="check-chip-row">${raw(memberChips)}</div>
          <div class="field-help">저장 후 홈에서 구성원 칩으로 필터링할 수 있습니다</div>
        </div>

        <button class="btn btn--primary btn--lg btn--block" type="submit">개인 레시피로 저장</button>
        <div class="field-help" id="save-status"></div>
      </form>
    `,
    flush: false,
    showNav: false,
  };
}

export function bindPreview(rootEl, navigate, draftId) {
  rootEl.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (target?.dataset.action === 'back') history.back();
    if (target?.dataset.action === 'add-ingredient') {
      rootEl.querySelector('#ingredient-list').insertAdjacentHTML('beforeend', ingredientRow());
    }
    if (target?.dataset.action === 'add-step') {
      const list = rootEl.querySelector('#step-list');
      list.insertAdjacentHTML('beforeend', stepRow({}, list.querySelectorAll('[data-kind="step"]').length));
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
    if (target?.dataset.action === 'report-analysis') {
      const draft = getAnalysisDraft(draftId);
      const status = rootEl.querySelector('#report-status');
      target.disabled = true;
      if (status) status.textContent = '신고 중...';
      reportAnalysis(draft?.videoId, '사용자가 미리보기 화면에서 분석 결과를 신고했습니다.')
        .then((result) => {
          if (!status) return;
          status.textContent = result.ok
            ? '신고했습니다. 공유 분석 원본은 검토 대상으로 표시됩니다.'
            : '신고를 접수하지 못했습니다. 저장 전 직접 보정해 주세요.';
        })
        .finally(() => {
          target.disabled = false;
        });
    }
  });

  const form = rootEl.querySelector('#preview-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const draft = getAnalysisDraft(draftId);
    if (!draft) return;
    if (!validatePreviewForm(form)) return;

    const submit = form.querySelector('button[type="submit"]');
    const status = form.querySelector('#save-status');
    submit.disabled = true;
    if (status) status.textContent = '저장 중...';

    const recipeId = saveDraftAsRecipe(draftId, readRecipeFromForm(form, draft));
    const savedRecipe = getState().recipes.find((recipe) => recipe.id === recipeId);

    if (savedRecipe) {
      try {
        const remote = await saveRecipeToSupabase(savedRecipe);
        if (status) {
          status.textContent = remote.skipped
            ? '로컬에 저장했습니다. 로그인하면 Supabase에도 백업할 수 있어요.'
            : '로컬과 Supabase에 저장했습니다.';
        }
      } catch (err) {
        console.warn('Supabase save failed', err);
        if (status) status.textContent = '로컬에 저장했습니다. Supabase 저장은 계정 화면에서 다시 백업할 수 있어요.';
      }
    }

    navigate(`/recipe/${recipeId}`);
  });
}

function renumberSteps(list) {
  list?.querySelectorAll('.step-order').forEach((node, index) => {
    node.textContent = index + 1;
  });
}

function validatePreviewForm(form) {
  clearErrors(form);

  const title = form.title.value.trim();
  const ingredientRows = Array.from(form.querySelectorAll('[data-kind="ingredient"]'));
  const stepRows = Array.from(form.querySelectorAll('[data-kind="step"]'));
  const namedIngredients = ingredientRows.filter((row) =>
    row.querySelector('[name="ingredientName"]').value.trim(),
  );
  const filledSteps = stepRows.filter((row) =>
    row.querySelector('[name="stepText"]').value.trim(),
  );

  const errors = [];
  if (!title) {
    errors.push({
      key: 'title',
      message: '레시피 제목을 입력해주세요.',
      focus: form.title,
    });
  }
  if (namedIngredients.length === 0) {
    errors.push({
      key: 'ingredients',
      message: '재료를 하나 이상 입력해주세요.',
      focus: ingredientRows[0]?.querySelector('[name="ingredientName"]'),
    });
  }
  if (filledSteps.length === 0) {
    errors.push({
      key: 'steps',
      message: '조리 단계를 하나 이상 입력해주세요.',
      focus: stepRows[0]?.querySelector('[name="stepText"]'),
    });
  }

  errors.forEach((error) => showError(form, error));
  if (errors.length) {
    const first = errors[0].focus;
    first?.classList.add('input--error');
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    first?.focus();
  }
  return errors.length === 0;
}

function clearErrors(form) {
  form.querySelectorAll('.field-error').forEach((node) => {
    node.textContent = '';
  });
  form.querySelectorAll('.input--error').forEach((node) => {
    node.classList.remove('input--error');
  });
}

function showError(form, error) {
  const node = form.querySelector(`[data-error-for="${error.key}"]`);
  if (node) node.textContent = error.message;
}
