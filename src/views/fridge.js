// 냉장고 — 가진 재료를 기준으로 만들 수 있는 레시피 추천
import { html, raw, ytThumbnail } from '../util.js';
import {
  addFridgeItem,
  deleteFridgeItem,
  getState,
  setFridgeFocusItem,
  setFridgeSort,
  setFridgeCompartment,
  toggleFridgeItem,
} from '../store.js';
import { deleteFridgeItemFromSupabase, syncFridgeItemToSupabase } from '../api/syncSupabase.js';
import { icon } from '../icons.js';
import { hasFuzzyOverlap, makeIngredientTerms } from '../ingredientMatch.js';

const STORAGE_META = {
  fridge: {
    title: '냉장고',
    iconName: 'fridge',
    activeNav: 'fridge',
    focusKey: 'fridgeFocusId',
    sortKey: 'fridgeSort',
    placeholder: '있는 재료 입력: 두부, 대파, 양파...',
    emptyEmoji: '🧊',
    emptyTitle: '아직 등록한 재료가 없어요',
    emptyDesc: '냉장고에 있는 재료를 하나씩 넣어보세요',
    promptPlaceholder: '예: 김치, 돼지고기, 두부처럼 냉장고에 있는 재료를 입력하세요.',
  },
  pantry: {
    title: '실온보관',
    iconName: 'pantry',
    activeNav: 'pantry',
    focusKey: 'pantryFocusId',
    sortKey: 'pantrySort',
    placeholder: '실온 보관 재료 입력: 라면, 통조림, 양파...',
    emptyEmoji: '🥫',
    emptyTitle: '아직 등록한 실온 재료가 없어요',
    emptyDesc: '실온 보관 중인 재료를 하나씩 넣어보세요',
    promptPlaceholder: '예: 라면, 통조림, 파스타처럼 실온 보관 중인 재료를 입력하세요.',
  },
};

export function renderFridge(storage = 'fridge') {
  const meta = STORAGE_META[storage] || STORAGE_META.fridge;
  const s = getState();
  const isFridge = storage === 'fridge';
  const compartment = isFridge ? (s.filter.fridgeCompartment || 'all') : 'all';
  const allItems = (s.fridgeItems || []).filter((item) => {
    const itemStorage = item.storage || 'fridge';
    if (isFridge) {
      if (itemStorage !== 'fridge' && itemStorage !== 'freezer') return false;
      if (compartment === 'fridge' && itemStorage !== 'fridge') return false;
      if (compartment === 'freezer' && itemStorage !== 'freezer') return false;
      return true;
    }
    return itemStorage === storage;
  });
  const items = allItems;
  const sortMode = s.filter[meta.sortKey] || 'expiry';
  const focusedItem = items.find((item) => item.id === s.filter[meta.focusKey]);
  const activeItems = focusedItem ? [focusedItem] : items.filter((item) => item.checked);
  const matches = rankRecipesByFridge(s.recipes || [], activeItems);
  const urgentCount = items.filter((item) => getExpiryState(item).tone === 'danger' || getExpiryState(item).tone === 'warn').length;

  return {
    header: html`
      <div class="title">${raw(icon(meta.iconName, 18))}<span>${meta.title}</span></div>
      <div style="width:36px"></div>
    `,
    body: html`
      <form class="fridge-form" data-action="add-fridge-item" data-storage="${storage}">
        <label class="field">
          <span class="field-label">재료</span>
          <input class="input" name="ingredient" autocomplete="off"
                 placeholder="${meta.placeholder}" />
        </label>
        <div class="fridge-form-meta">
          ${isFridge ? raw(`
            <label class="field">
              <span class="field-label">보관</span>
              <select class="input" name="compartment">
                <option value="fridge">🧊 냉장</option>
                <option value="freezer">❄️ 냉동</option>
              </select>
            </label>
          `) : ''}
          <label class="field">
            <span class="field-label">입고일</span>
            <input class="input" name="purchasedAt" type="date" value="${todayString()}" />
          </label>
          <label class="field">
            <span class="field-label">유통기한</span>
            <input class="input" name="expiresAt" type="date" />
          </label>
        </div>
        <button class="primary-btn" type="submit">추가</button>
      </form>

      ${isFridge ? raw(`
        <div class="fridge-sort" aria-label="냉장/냉동 필터" style="margin-top:8px">
          <button type="button" data-action="set-fridge-compartment" data-compartment="all" class="${compartment === 'all' ? 'is-on' : ''}">전체</button>
          <button type="button" data-action="set-fridge-compartment" data-compartment="fridge" class="${compartment === 'fridge' ? 'is-on' : ''}">🧊 냉장</button>
          <button type="button" data-action="set-fridge-compartment" data-compartment="freezer" class="${compartment === 'freezer' ? 'is-on' : ''}">❄️ 냉동</button>
        </div>
      `) : ''}

      <section class="fridge-section">
        <div class="section-row">
          <div>
            <h2 class="section-title">있는 재료</h2>
            <p class="section-note">${urgentCount ? `임박/만료 ${urgentCount}개 먼저 확인하세요` : '재료를 누르면 그 재료로 만들 수 있는 레시피를 보여줘요'}</p>
          </div>
        </div>
        <div class="fridge-sort" aria-label="${meta.title} 정렬">
          <button type="button" data-action="set-fridge-sort" data-sort="expiry" class="${sortMode === 'expiry' ? 'is-on' : ''}">유통기한순</button>
          <button type="button" data-action="set-fridge-sort" data-sort="name" class="${sortMode === 'name' ? 'is-on' : ''}">이름순</button>
        </div>
        ${raw(renderFridgeItems(items, focusedItem?.id, sortMode, meta))}
      </section>

      <section class="fridge-section">
        <div class="section-row">
          <div>
            <h2 class="section-title">${focusedItem ? `${focusedItem.name}로 만들 수 있는 것` : '오늘 만들 수 있는 것'}</h2>
            <p class="section-note">${activeItems.length ? `${activeItems.length}개 재료 기준` : '재료를 추가하면 추천이 떠요'}</p>
          </div>
          ${focusedItem ? raw(`<button class="ghost-btn fridge-clear-focus" type="button" data-action="clear-fridge-focus">전체 보기</button>`) : ''}
        </div>
        ${raw(renderMatches(matches, activeItems, meta))}
      </section>
    `,
    flush: false,
    showNav: true,
    activeNav: meta.activeNav,
  };
}

function renderFridgeItems(items, focusedId, sortMode, meta = STORAGE_META.fridge) {
  if (!items.length) {
    return html`
      <div class="empty mini-empty">
        <span class="emo">${meta.emptyEmoji}</span>
        <div class="ttl">${meta.emptyTitle}</div>
        <div>${meta.emptyDesc}</div>
      </div>
    `;
  }

  return html`
    <div class="fridge-list">
      ${raw(sortFridgeItems(items, sortMode).map((item) => renderFridgeItem(item, focusedId)).join(''))}
    </div>
  `;
}

function renderFridgeItem(item, focusedId) {
  const expiry = getExpiryState(item);
  return html`
    <div class="fridge-item ${item.checked ? 'is-on' : ''} ${focusedId === item.id ? 'is-focused' : ''} ${expiry.tone ? `is-${expiry.tone}` : ''}">
      <input type="checkbox" data-action="toggle-fridge-item" data-id="${item.id}" ${item.checked ? 'checked' : ''} aria-label="${item.name} 추천 반영" />
      <button type="button" class="fridge-item-main" data-action="focus-fridge-item" data-id="${item.id}">
        <span class="fridge-item-name">${item.storage === 'freezer' ? raw('<span title="냉동" style="margin-right:4px">❄️</span>') : ''}${item.name}</span>
        <span class="fridge-item-meta">
          ${item.purchasedAt ? raw(`<span>입고 ${formatDateLabel(item.purchasedAt)}</span>`) : raw('<span>입고일 없음</span>')}
          ${item.expiresAt ? raw(`<span>기한 ${formatDateLabel(item.expiresAt)}</span>`) : raw('<span>기한 없음</span>')}
        </span>
      </button>
      <span class="fridge-expiry fridge-expiry--${expiry.tone || 'neutral'}">${expiry.label}</span>
      <button class="fridge-delete" type="button" data-action="delete-fridge-item" data-id="${item.id}" title="삭제">×</button>
    </div>
  `;
}

function renderMatches(matches, activeItems, meta = STORAGE_META.fridge) {
  if (!activeItems.length) {
    return html`
      <div class="callout">
        <span class="icon">🍳</span>
        <div>
          <strong>재료를 넣으면 바로 추천해드려요</strong><br>
          ${meta.promptPlaceholder}
        </div>
      </div>
    `;
  }

  if (!matches.length) {
    return html`
      <div class="empty mini-empty">
        <span class="emo">🔎</span>
        <div class="ttl">아직 맞는 레시피가 없어요</div>
        <div>다른 재료를 추가하거나 유튜브 레시피를 더 가져와보세요</div>
      </div>
    `;
  }

  return html`
    <div class="stack">
      ${raw(matches.map(({ recipe, matched, total, ratio }) => renderMatchCard(recipe, matched, total, ratio)).join(''))}
    </div>
  `;
}

function renderMatchCard(recipe, matched, total, ratio) {
  const thumb = ytThumbnail(recipe.videoId);
  const thumbStyle = thumb ? `background-image:url('${thumb}')` : '';
  const percent = Math.round(ratio * 100);
  return html`
    <div class="recipe-card fridge-match" data-action="open-recipe" data-id="${recipe.id}">
      <div class="thumb" style="${raw(thumbStyle)}"></div>
      <div class="meta">
        <div class="title">${recipe.title}</div>
        <div class="sub">${matched.length}/${total}개 재료 있음 · ${matched.map((item) => item.name).join(', ')}</div>
        ${matched.some((item) => item.via) ? raw(`<div class="match-alias">비슷한 재료 포함: ${matched.filter((item) => item.via).map((item) => `${item.via}→${item.name}`).join(', ')}</div>`) : ''}
        <div class="match-track"><span style="width:${percent}%"></span></div>
      </div>
    </div>
  `;
}

function rankRecipesByFridge(recipes, activeItems) {
  const fridgeTerms = activeItems
    .map((item) => makeIngredientTerms(item.name))
    .filter((item) => item.canonical);
  if (!fridgeTerms.length) return [];

  return recipes
    .map((recipe) => {
      const ingredients = (recipe.ingredients || [])
        .map((item) => String(item.name || '').trim())
        .filter(Boolean);
      const matched = ingredients
        .map((name) => matchIngredient(name, fridgeTerms))
        .filter(Boolean);
      const uniqueMatched = dedupeMatches(matched);
      const total = Math.max(ingredients.length, 1);
      return {
        recipe,
        matched: uniqueMatched,
        total,
        ratio: uniqueMatched.length / total,
      };
    })
    .filter((item) => item.matched.length > 0)
    .sort((a, b) => b.ratio - a.ratio || b.matched.length - a.matched.length)
    .slice(0, 10);
}

function matchIngredient(ingredientName, fridgeTerms) {
  const ingredientTerms = makeIngredientTerms(ingredientName);
  let best = null;
  for (const fridge of fridgeTerms) {
    const exact = ingredientTerms.terms.has(fridge.canonical) || fridge.terms.has(ingredientTerms.canonical);
    const fuzzy = !exact && hasFuzzyOverlap(ingredientTerms.terms, fridge.terms);
    if (exact || fuzzy) {
      const score = exact ? 2 : 1;
      if (!best || score > best.score) {
        best = {
          name: ingredientName,
          via: ingredientTerms.canonical === fridge.canonical ? '' : fridge.original,
          score,
        };
      }
    }
  }
  return best;
}

function dedupeMatches(matches) {
  const map = new Map();
  for (const match of matches) {
    const key = makeIngredientTerms(match.name).canonical;
    const existing = map.get(key);
    if (!existing || match.score > existing.score) map.set(key, match);
  }
  return Array.from(map.values());
}

export function bindFridge(rootEl, navigate, storage = 'fridge') {
  // 이전 페이지(냉장고↔실온보관 이동)에서 남은 리스너 제거
  rootEl.__fridgeCleanup?.();
  const controller = new AbortController();
  const { signal } = controller;
  rootEl.__fridgeCleanup = () => controller.abort();

  const meta = STORAGE_META[storage] || STORAGE_META.fridge;
  rootEl.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-action="add-fridge-item"]');
    if (!form) return;
    e.preventDefault();
    const input = form.elements.ingredient;
    const compartment = form.elements.compartment?.value;
    const effectiveStorage = storage === 'fridge' && compartment === 'freezer' ? 'freezer' : storage;
    const id = addFridgeItem({
      name: input.value,
      storage: effectiveStorage,
      purchasedAt: form.elements.purchasedAt?.value,
      expiresAt: form.elements.expiresAt?.value,
    });
    if (id) {
      input.value = '';
      if (form.elements.expiresAt) form.elements.expiresAt.value = '';
      persistFridgeItem(id);
    }
  }, { signal });

  rootEl.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;
    if (action === 'delete-fridge-item') {
      e.preventDefault();
      deleteFridgeItem(id);
      deleteFridgeItemFromSupabase(id).catch((err) => {
        console.warn('Supabase fridge delete failed', err);
      });
    } else if (action === 'focus-fridge-item') {
      const current = getState().filter[meta.focusKey];
      setFridgeFocusItem(current === id ? null : id, storage);
    } else if (action === 'clear-fridge-focus') {
      setFridgeFocusItem(null, storage);
    } else if (action === 'set-fridge-sort') {
      setFridgeSort(target.dataset.sort, storage);
    } else if (action === 'set-fridge-compartment') {
      setFridgeCompartment(target.dataset.compartment);
    } else if (action === 'open-recipe') {
      navigate(`/recipe/${id}`);
    }
  }, { signal });

  rootEl.addEventListener('change', (e) => {
    const target = e.target.closest('[data-action="toggle-fridge-item"]');
    if (target) {
      toggleFridgeItem(target.dataset.id);
      persistFridgeItem(target.dataset.id);
    }
  }, { signal });
}

function sortFridgeItems(items, sortMode) {
  return [...items].sort((a, b) => {
    if (sortMode === 'name') return a.name.localeCompare(b.name, 'ko');
    const aState = getExpiryState(a);
    const bState = getExpiryState(b);
    return aState.rank - bState.rank
      || String(a.expiresAt || '9999-12-31').localeCompare(String(b.expiresAt || '9999-12-31'))
      || a.name.localeCompare(b.name, 'ko');
  });
}

function getExpiryState(item) {
  if (!item.expiresAt) return { label: '기한 없음', tone: 'neutral', rank: 4 };
  const days = daysUntil(item.expiresAt);
  if (days < 0) return { label: `${Math.abs(days)}일 지남`, tone: 'danger', rank: 0 };
  if (days === 0) return { label: '오늘까지', tone: 'danger', rank: 1 };
  if (days <= 3) return { label: `${days}일 남음`, tone: 'warn', rank: 2 };
  return { label: `${days}일 남음`, tone: 'ok', rank: 3 };
}

function daysUntil(dateValue) {
  const today = new Date(todayString());
  const target = new Date(dateValue);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateLabel(value) {
  const [year, month, day] = String(value || '').split('-');
  return year && month && day ? `${Number(month)}/${Number(day)}` : '';
}

function persistFridgeItem(id) {
  const item = getState().fridgeItems.find((fridgeItem) => fridgeItem.id === id);
  if (!item) return;
  syncFridgeItemToSupabase(item).catch((err) => {
    console.warn('Supabase fridge sync failed', err);
  });
}
