// 홈 — 3-view 세그먼트로 그룹핑된 레시피 목록
// viewMode: 'category' | 'member' | 'chef'
import { html, raw, ytThumbnail } from '../util.js';
import {
  getState, getFilteredRecipes,
  setSearchQuery, toggleFavoriteFilter, toggleFavorite, setViewMode, setSituationFilter,
} from '../store.js';
import { loadSupabaseDataIntoLocalState, syncRecipeToSupabase } from '../api/syncSupabase.js';
import { icon } from '../icons.js';
import { SITUATION_TAGS } from '../data.js';

const VIEW_MODES = [
  { id: 'category',  label: '카테고리', iconName: 'tag' },
  { id: 'member',    label: '구성원',   iconName: 'users' },
  { id: 'chef',      label: '채널',     iconName: 'play' },
];

const UNGROUPED = '__ungrouped__';

export function renderHome() {
  const s = getState();
  const viewMode = s.filter.viewMode || 'category';
  const list = getFilteredRecipes();

  const segments = VIEW_MODES.map((m) => html`
    <button class="seg ${m.id === viewMode ? 'is-on' : ''}"
            data-action="set-view" data-id="${m.id}">
      <span class="seg-ic">${raw(icon(m.iconName || m.icon, 14))}</span>
      <span class="seg-lbl">${m.label}</span>
    </button>
  `).join('');

  const groups = groupRecipes(list, viewMode, s);

  const groupsHtml = groups.length > 0
    ? groups.map((g) => renderGroup(g, s)).join('')
    : renderEmptyState(s);

  return {
    header: html`
      <div class="title app-brand">${raw(icon('book', 18))}<span>Recipe</span></div>
      <div class="actions">
        <button class="icon-btn ${s.filter.favoriteOnly ? 'is-primary' : ''}"
                data-action="toggle-fav-filter"
                title="즐겨찾기만 보기">${raw(icon('star', 18))}</button>
        <button class="icon-btn" data-action="restore-supabase" title="클라우드에서 가져오기">${raw(icon('cloud', 18))}</button>
        <button class="icon-btn" data-action="open-account" title="계정">${raw(icon('user', 18))}</button>
        <button class="icon-btn" data-action="open-settings" title="설정">${raw(icon('settings', 18))}</button>
      </div>
    `,
    body: html`
      <label class="field" style="margin-bottom:12px;">
        <input class="input" id="recipe-search" value="${s.filter.query || ''}"
               placeholder="레시피, 재료, 팁 검색" />
      </label>
      <div class="situation-pills">
        ${raw([
          { id: '', icon: '🍽️', name: '전체' },
          ...SITUATION_TAGS,
        ].map((tag) => html`
          <button class="situation-pill ${!tag.id && !s.filter.situationTagId ? 'is-on' : tag.id && s.filter.situationTagId === tag.id ? 'is-on' : ''}"
                  data-action="set-situation" data-id="${tag.id}">
            <span>${tag.icon}</span><span>${tag.name}</span>
          </button>
        `).join(''))}
      </div>
      <div class="view-seg">${raw(segments)}</div>
      <div class="groups">${raw(groupsHtml)}</div>
    `,
    flush: false,
    showNav: true,
    activeNav: 'home',
  };
}

function renderEmptyState(s) {
  if ((s.recipes || []).length > 0) {
    return html`
      <div class="empty">
        <span class="emo">🔎</span>
        <div class="ttl">조건에 맞는 레시피가 없어요</div>
        <div>검색어를 줄이거나 다른 보기로 바꿔보세요</div>
      </div>
    `;
  }

  return html`
    <div class="empty">
      <span class="emo">🍳</span>
      <div class="ttl">아직 저장된 레시피가 없어요</div>
      <div>아래 ＋ 버튼으로 유튜브 URL을 추가하거나, 클라우드에 저장된 레시피를 가져오세요</div>
      <div class="empty-actions">
        <button class="primary-btn" data-action="restore-supabase">저장된 레시피 가져오기</button>
        <button class="ghost-btn" data-action="go-analyze">유튜브 URL 추가</button>
      </div>
      <div class="empty-status" data-role="restore-status"></div>
    </div>
  `;
}

// ──────────────────────────────────────────────────────────
// 그룹 만들기
// ──────────────────────────────────────────────────────────
function groupRecipes(list, viewMode, s) {
  if (viewMode === 'category') return groupByCategory(list, s);
  if (viewMode === 'member')   return groupByMember(list, s);
  if (viewMode === 'chef')     return groupByChef(list);
  return groupByCategory(list, s);
}

function groupByCategory(list, s) {
  const buckets = new Map();
  for (const r of list) {
    const cat = s.categories.find((c) => c.id === r.categoryId);
    const key = cat?.id || 'etc';
    if (!buckets.has(key)) {
      buckets.set(key, { key, label: cat?.name || '기타', icon: cat?.icon || '📦', recipes: [] });
    }
    buckets.get(key).recipes.push(r);
  }
  return Array.from(buckets.values()).filter((g) => g.key !== 'all');
}

function groupByMember(list, s) {
  const buckets = new Map();
  // 각 구성원별로 그 사람이 좋아하는 레시피 모음
  for (const m of s.members) {
    buckets.set(m.id, { key: m.id, label: m.name, icon: m.emoji, recipes: [] });
  }
  for (const r of list) {
    const members = r.memberIds || [];
    if (members.length === 0) {
      if (!buckets.has(UNGROUPED)) {
        buckets.set(UNGROUPED, { key: UNGROUPED, label: '아직 태깅 안 됨', icon: '❓', recipes: [] });
      }
      buckets.get(UNGROUPED).recipes.push(r);
    } else {
      for (const mid of members) {
        if (buckets.has(mid)) buckets.get(mid).recipes.push(r);
      }
    }
  }
  // 빈 구성원 그룹은 제외 (시각적 noise 줄임)
  return Array.from(buckets.values()).filter((g) => g.recipes.length > 0);
}

function groupByChef(list) {
  const buckets = new Map();
  for (const r of list) {
    const channel = getChannelName(r);
    const key = channel || UNGROUPED;
    const label = channel || '출처 없음';
    const icon = channel ? '▶' : '—';
    if (!buckets.has(key)) buckets.set(key, { key, label, icon, recipes: [] });
    buckets.get(key).recipes.push(r);
  }
  // 채널 이름 알파벳/한글 정렬, 미분류는 맨 뒤
  return Array.from(buckets.values()).sort((a, b) => {
    if (a.key === UNGROUPED) return 1;
    if (b.key === UNGROUPED) return -1;
    return a.label.localeCompare(b.label, 'ko');
  });
}

// ──────────────────────────────────────────────────────────
// 렌더링
// ──────────────────────────────────────────────────────────
function renderGroup(g, s) {
  const cards = g.recipes.map((r) => renderRecipeCard(r, s)).join('');
  return html`
    <section class="group">
      <header class="group-head">
        <span class="group-ic">${g.icon}</span>
        <span class="group-label">${g.label}</span>
        <span class="group-count">${g.recipes.length}</span>
      </header>
      <div class="group-body">${raw(cards)}</div>
    </section>
  `;
}

function renderRecipeCard(r, s) {
  const cat = s.categories.find((c) => c.id === r.categoryId);
  const thumb = ytThumbnail(r.videoId);
  const thumbStyle = thumb ? `background-image:url('${thumb}')` : '';
  return html`
    <div class="recipe-card" data-action="open-recipe" data-id="${r.id}">
      <div class="thumb" style="${raw(thumbStyle)}"></div>
      <div class="meta">
        <div class="title">${r.title}</div>
        <div class="sub">${cat?.name || ''} · ${r.cookTimeMin}분 · ${r.servings}인분${getChannelName(r) ? ` · ${getChannelName(r)}` : ''}</div>
      </div>
      <div class="fav" data-action="toggle-fav" data-id="${r.id}">
        ${r.isFavorite ? '⭐' : raw('<span style="color:var(--c-ink-3)">☆</span>')}
      </div>
    </div>
  `;
}

function getChannelName(recipe) {
  return String(recipe.channelName || recipe.chefName || '').trim();
}

// ──────────────────────────────────────────────────────────
// 바인딩
// ──────────────────────────────────────────────────────────
export function bindHome(rootEl, navigate) {
  rootEl.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    if (action === 'set-situation') setSituationFilter(id || null);
    else if (action === 'set-view') setViewMode(id);
    else if (action === 'toggle-fav-filter') toggleFavoriteFilter();
    else if (action === 'open-account') navigate('/account');
    else if (action === 'open-settings') navigate('/settings');
    else if (action === 'go-analyze') navigate('/analyze');
    else if (action === 'restore-supabase') {
      await restoreFromSupabase(rootEl, target, navigate);
    }
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

async function restoreFromSupabase(rootEl, button, navigate) {
  if (getState().recipes.length > 0) {
    const ok = window.confirm('현재 로컬 목록을 클라우드에 저장된 목록으로 바꿀까요?');
    if (!ok) return;
  }

  const status = rootEl.querySelector('[data-role="restore-status"]');
  button.disabled = true;
  button.textContent = '가져오는 중...';
  if (status) status.textContent = '클라우드에서 레시피와 구성원 정보를 불러오고 있어요.';

  try {
    const result = await loadSupabaseDataIntoLocalState();
    if (status) status.textContent = `${result.recipes}개 레시피를 가져왔어요.`;
  } catch (err) {
    const message = err?.message || '클라우드 데이터를 가져오지 못했어요.';
    if (message.includes('로그인')) {
      if (status) status.textContent = '먼저 계정에서 로그인한 뒤 다시 가져올 수 있어요.';
      navigate('/account');
      return;
    }
    if (status) status.textContent = message;
    console.warn('Supabase restore failed', err);
  } finally {
    button.disabled = false;
    button.textContent = '저장된 레시피 가져오기';
  }
}

function persistRecipe(id) {
  const recipe = getState().recipes.find((item) => item.id === id);
  if (!recipe) return;
  syncRecipeToSupabase(recipe).catch((err) => {
    console.warn('Supabase favorite sync failed', err);
  });
}
