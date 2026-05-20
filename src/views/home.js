// 홈 — 레시피 목록 + 필터
import { html, raw, ytThumbnail } from '../util.js';
import {
  getState, getFilteredRecipes,
  setCategoryFilter, setSearchQuery, toggleMemberFilter, toggleFavoriteFilter, toggleFavorite,
} from '../store.js';
import { syncRecipeToSupabase } from '../api/syncSupabase.js';

export function renderHome() {
  const s = getState();
  const list = getFilteredRecipes();

  const categoryChips = s.categories.map((c) => html`
    <span class="chip ${c.id === s.filter.categoryId ? 'chip--on' : ''}"
          data-action="filter-category" data-id="${c.id}">${c.icon} ${c.name}</span>
  `).join('');

  const memberChips = s.members.map((m) => html`
    <span class="chip ${m.id === s.filter.memberId ? 'chip--on' : ''}"
          data-action="filter-member" data-id="${m.id}">${m.emoji} ${m.name}</span>
  `).join('');

  const recipeCards = list.map((r) => {
    const cat = s.categories.find((category) => category.id === r.categoryId);
    const thumb = ytThumbnail(r.videoId);
    const thumbStyle = thumb ? `background-image:url('${thumb}')` : '';
    return html`
      <div class="recipe-card" data-action="open-recipe" data-id="${r.id}">
        <div class="thumb" style="${raw(thumbStyle)}"></div>
        <div class="meta">
          <div class="title">${r.title}</div>
          <div class="sub">${cat?.name || ''} · ${r.cookTimeMin}분 · ${r.servings}인분</div>
        </div>
        <div class="fav" data-action="toggle-fav" data-id="${r.id}">
          ${r.isFavorite ? '⭐' : raw('<span style="color:var(--c-ink-3)">☆</span>')}
        </div>
      </div>
    `;
  }).join('');

  const body = list.length > 0 ? recipeCards : html`
    <div class="empty">
      <span class="emo">🍳</span>
      <div class="ttl">아직 저장된 레시피가 없어요</div>
      <div>아래 ＋ 버튼으로 유튜브 URL을 추가해보세요</div>
    </div>
  `;

  return {
    header: html`
      <div class="title">🍳 <span>내 레시피</span></div>
      <div class="actions">
        <button class="icon-btn ${s.filter.favoriteOnly ? 'is-primary' : ''}"
                data-action="toggle-fav-filter"
                title="즐겨찾기만 보기">⭐</button>
        <button class="icon-btn" data-action="open-account" title="계정">👤</button>
        <button class="icon-btn" data-action="open-settings" title="설정">⚙</button>
      </div>
    `,
    body: html`
      <label class="field">
        <span class="field-label">검색</span>
        <input class="input" id="recipe-search" value="${s.filter.query || ''}" placeholder="레시피, 재료, 팁 검색" />
      </label>
      <div class="filter-section">
        <div class="filter-label">카테고리</div>
        <div class="chip-row">${raw(categoryChips)}</div>
      </div>
      <div class="filter-section">
        <div class="filter-label">구성원</div>
        <div class="chip-row">${raw(memberChips)}</div>
      </div>
      <div class="stack">${raw(body)}</div>
    `,
    flush: false,
    showNav: true,
    activeNav: 'home',
  };
}

export function bindHome(rootEl, navigate) {
  rootEl.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    if (action === 'filter-category') setCategoryFilter(id);
    else if (action === 'filter-member') toggleMemberFilter(id);
    else if (action === 'toggle-fav-filter') toggleFavoriteFilter();
    else if (action === 'open-account') navigate('/account');
    else if (action === 'open-settings') navigate('/settings');
    else if (action === 'toggle-fav') {
      e.stopPropagation();
      toggleFavorite(id);
      persistRecipe(id);
    } else if (action === 'open-recipe') {
      navigate(`/recipe/${id}`);
    }
  });

  const search = rootEl.querySelector('#recipe-search');
  search?.addEventListener('input', (e) => {
    setSearchQuery(e.target.value);
  });
}

function persistRecipe(id) {
  const recipe = getState().recipes.find((item) => item.id === id);
  if (!recipe) return;
  syncRecipeToSupabase(recipe).catch((err) => {
    console.warn('Supabase favorite sync failed', err);
  });
}
