// 검색 — 제목·재료·팁·채널·태그 통합 검색
import { html, raw, ytThumbnail } from '../util.js';
import { getState, setSearchQuery } from '../store.js';
import { icon } from '../icons.js';
import { hasFuzzyOverlap, makeIngredientTerms, normalizeSearchText } from '../ingredientMatch.js';

function recipeMatches(recipe, query) {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const queryTerms = makeIngredientTerms(query);
  const fields = [
    recipe.title,
    recipe.sub,
    recipe.channelName || recipe.chefName,
    ...(recipe.ingredients || []).map((i) => i.name),
    ...(recipe.steps || []).map((s) => s.text),
    ...(recipe.tips || []),
  ];
  if (fields.some((v) => normalizeSearchText(v).includes(q))) return true;
  return (recipe.ingredients || []).some((item) =>
    hasFuzzyOverlap(makeIngredientTerms(item.name).terms, queryTerms.terms),
  );
}

export function renderSearch() {
  const s = getState();
  const q = s.filter.query || '';
  const matched = q.trim() ? s.recipes.filter((r) => recipeMatches(r, q)) : [];

  const cards = matched.map((r) => {
    const cat = s.categories.find((c) => c.id === r.categoryId);
    const thumb = ytThumbnail(r.videoId);
    const thumbStyle = thumb ? `background-image:url('${thumb}')` : '';
    return html`
      <div class="recipe-card" data-action="open-recipe" data-id="${r.id}">
        <div class="thumb" style="${raw(thumbStyle)}"></div>
        <div class="meta">
          <div class="title">${r.title}</div>
          <div class="sub">${cat?.name || ''} · ${r.cookTimeMin}분${getChannelName(r) ? ` · ${getChannelName(r)}` : ''}</div>
        </div>
      </div>
    `;
  }).join('');

  const body = q.trim() === ''
    ? html`
        <div class="empty">
          <span class="emo">🔍</span>
          <div class="ttl">레시피 검색</div>
          <div>제목·재료·팁·채널·태그까지 한 번에</div>
        </div>
      `
    : matched.length === 0
      ? html`
          <div class="empty">
            <span class="emo">🫥</span>
            <div class="ttl">"${q}" 결과가 없어요</div>
            <div>다른 단어로 시도해보세요</div>
          </div>
        `
      : html`
          <div class="search-meta">${matched.length}개 결과</div>
          <div class="stack">${raw(cards)}</div>
        `;

  return {
    header: html`
      <div class="title">${raw(icon('search', 18))}<span>검색</span></div>
      <div style="width:36px"></div>
    `,
    body: html`
      <label class="field" style="margin-bottom:14px;">
        <input class="input" id="search-input" value="${q}" autofocus
               placeholder="레시피, 재료, 팁, 채널, 태그…" />
      </label>
      ${raw(body)}
    `,
    flush: false,
    showNav: true,
    activeNav: 'search',
  };
}

function getChannelName(recipe) {
  return String(recipe.channelName || recipe.chefName || '').trim();
}

export function bindSearch(rootEl, navigate) {
  const input = rootEl.querySelector('#search-input');
  let composing = false;
  let timer = null;
  const commitQuery = (value) => {
    clearTimeout(timer);
    timer = setTimeout(() => setSearchQuery(value), 120);
  };
  input?.addEventListener('compositionstart', () => {
    composing = true;
  });
  input?.addEventListener('compositionend', (e) => {
    composing = false;
    setSearchQuery(e.target.value);
  });
  input?.addEventListener('input', (e) => {
    if (!composing) commitQuery(e.target.value);
  });
  rootEl.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (target?.dataset.action === 'open-recipe') {
      navigate(`/recipe/${target.dataset.id}`);
    }
  });
}
