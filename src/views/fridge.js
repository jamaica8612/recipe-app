// 냉장고 — 재고 관리 + 장보기 목록 + 레시피 추천
import { html, raw, ytThumbnail } from '../util.js';
import {
  addFridgeItem,
  addShoppingItem,
  deleteFridgeItem,
  getState,
  moveShoppingToFridge,
  setFridgeFocusItem,
  setFridgeSort,
  setFridgeTab,
  toggleFridgeItem,
} from '../store.js';
import { deleteFridgeItemFromSupabase, syncFridgeItemToSupabase } from '../api/syncSupabase.js';
import { icon } from '../icons.js';
import { hasFuzzyOverlap, makeIngredientTerms } from '../ingredientMatch.js';

export function renderFridge() {
  const s = getState();
  const allItems = s.fridgeItems || [];
  const fridgeTab = s.filter.fridgeTab || 'stock';
  const fridgeSort = s.filter.fridgeSort || 'expiry';

  const stockItems = allItems.filter((item) => !item.isShopping);
  const shoppingItems = allItems.filter((item) => item.isShopping);

  const focusedItem = stockItems.find((item) => item.id === s.filter.fridgeFocusId);
  const activeItems = focusedItem ? [focusedItem] : stockItems.filter((item) => item.checked);
  const matches = rankRecipesByFridge(s.recipes || [], activeItems);
  const urgentCount = stockItems.filter(
    (item) => getExpiryState(item).tone === 'danger' || getExpiryState(item).tone === 'warn',
  ).length;

  return {
    header: html`
      <div class="title">${raw(icon('fridge', 18))}<span>냉장고</span></div>
      <div style="width:36px"></div>
    `,
    body: html`
      <div class="fridge-tabs">
        <button class="fridge-tab-btn ${fridgeTab === 'stock' ? 'is-active' : ''}"
          type="button" data-action="set-fridge-tab" data-tab="stock">
          🧊 재고
        </button>
        <button class="fridge-tab-btn ${fridgeTab === 'shopping' ? 'is-active' : ''}"
          type="button" data-action="set-fridge-tab" data-tab="shopping">
          🛒 장보기${shoppingItems.length ? raw(` <span class="fridge-tab-badge">${shoppingItems.length}</span>`) : ''}
        </button>
      </div>

      ${raw(fridgeTab === 'stock'
    ? renderStockTab(stockItems, focusedItem, fridgeSort, urgentCount, matches, activeItems, s.recipes || [])
    : renderShoppingTab(shoppingItems)
  )}
    `,
    flush: false,
    showNav: true,
    activeNav: 'fridge',
  };
}

function renderStockTab(stockItems, focusedItem, fridgeSort, urgentCount, matches, activeItems, allRecipes) {
  return html`
    <form class="fridge-form" data-action="add-fridge-item">
      <label class="field">
        <span class="field-label">재료</span>
        <input class="input" name="ingredient" autocomplete="off"
               placeholder="있는 재료 입력: 두부, 대파, 양파..." />
      </label>
      <label class="field">
        <span class="field-label">입고일</span>
        <input class="input" name="purchasedAt" type="date" value="${todayString()}" />
      </label>
      <label class="field">
        <span class="field-label">유통기한</span>
        <input class="input" name="expiresAt" type="date" />
      </label>
      <button class="primary-btn" type="submit">추가</button>
    </form>

    <section class="fridge-section">
      <div class="section-row">
        <div>
          <h2 class="section-title">있는 재료</h2>
          <p class="section-note">${urgentCount ? `임박/만료 ${urgentCount}개 먼저 확인하세요` : '재료를 누르면 그 재료로 만들 수 있는 레시피를 보여줘요'}</p>
        </div>
      </div>
      <div class="fridge-sort" aria-label="냉장고 정렬">
        <button type="button" data-action="set-fridge-sort" data-sort="expiry" class="${fridgeSort === 'expiry' ? 'is-on' : ''}">유통기한순</button>
        <button type="button" data-action="set-fridge-sort" data-sort="name" class="${fridgeSort === 'name' ? 'is-on' : ''}">이름순</button>
      </div>
      ${raw(renderFridgeItems(stockItems, focusedItem?.id, fridgeSort))}
    </section>

    <section class="fridge-section">
      <div class="section-row">
        <div>
          <h2 class="section-title">${focusedItem ? `${focusedItem.name}로 만들 수 있는 것` : '오늘 만들 수 있는 것'}</h2>
          <p class="section-note">${activeItems.length ? `${activeItems.length}개 재료 기준` : '재료를 추가하면 추천이 떠요'}</p>
        </div>
        ${focusedItem ? raw(`<button class="ghost-btn fridge-clear-focus" type="button" data-action="clear-fridge-focus">전체 보기</button>`) : ''}
      </div>
      ${raw(renderMatches(matches, activeItems, activeItems))}
    </section>
  `;
}

function renderShoppingTab(shoppingItems) {
  return html`
    <form class="fridge-form fridge-form--shopping" data-action="add-shopping-item">
      <label class="field" style="flex:1">
        <span class="field-label">살 재료</span>
        <input class="input" name="ingredient" autocomplete="off"
               placeholder="살 재료 이름 입력..." />
      </label>
      <button class="primary-btn" type="submit">추가</button>
    </form>

    <section class="fridge-section">
      <div class="section-row">
        <div>
          <h2 class="section-title">장보기 목록</h2>
          <p class="section-note">구매 완료하면 자동으로 냉장고 재고로 이동돼요</p>
        </div>
      </div>
      ${raw(renderShoppingList(shoppingItems))}
    </section>
  `;
}

function renderShoppingList(items) {
  if (!items.length) {
    return html`
      <div class="empty mini-empty">
        <span class="emo">🛒</span>
        <div class="ttl">장보기 목록이 비어있어요</div>
        <div>살 재료를 추가하거나, 레시피 추천에서 부족한 재료를 담아보세요</div>
      </div>
    `;
  }

  return html`
    <div class="shopping-list">
      ${raw(items.map((item) => renderShoppingItem(item)).join(''))}
    </div>
  `;
}

function renderShoppingItem(item) {
  return html`
    <div class="shopping-item ${item.checked ? 'is-done' : ''}">
      <input type="checkbox" class="shopping-check" data-action="buy-shopping-item"
             data-id="${item.id}" ${item.checked ? 'checked' : ''} aria-label="${item.name} 구매 완료" />
      <span class="shopping-item-name">${item.name}</span>
      <button class="fridge-delete" type="button" data-action="delete-fridge-item"
              data-id="${item.id}" title="삭제">×</button>
    </div>
  `;
}

function renderFridgeItems(items, focusedId, sortMode) {
  if (!items.length) {
    return html`
      <div class="empty mini-empty">
        <span class="emo">🧊</span>
        <div class="ttl">아직 등록한 재료가 없어요</div>
        <div>냉장고에 있는 재료를 하나씩 넣어보세요</div>
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
        <span class="fridge-item-name">${item.name}</span>
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

function renderMatches(matches, activeItems) {
  if (!activeItems.length) {
    return html`
      <div class="callout">
        <span class="icon">🍳</span>
        <div>
          <strong>재료를 넣으면 바로 추천해드려요</strong><br>
          예: 김치, 돼지고기, 두부처럼 냉장고에 있는 재료를 입력하세요.
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
      ${raw(matches.map(({ recipe, matched, total, ratio, missing }) => renderMatchCard(recipe, matched, total, ratio, missing)).join(''))}
    </div>
  `;
}

function renderMatchCard(recipe, matched, total, ratio, missing) {
  const thumb = ytThumbnail(recipe.videoId);
  const thumbStyle = thumb ? `background-image:url('${thumb}')` : '';
  const percent = Math.round(ratio * 100);
  const missingNames = (missing || []).slice(0, 4);
  return html`
    <div class="recipe-card fridge-match" data-action="open-recipe" data-id="${recipe.id}">
      <div class="thumb" style="${raw(thumbStyle)}"></div>
      <div class="meta">
        <div class="title">${recipe.title}</div>
        <div class="sub">${matched.length}/${total}개 재료 있음 · ${matched.map((item) => item.name).join(', ')}</div>
        ${matched.some((item) => item.via) ? raw(`<div class="match-alias">비슷한 재료 포함: ${matched.filter((item) => item.via).map((item) => `${item.via}→${item.name}`).join(', ')}</div>`) : ''}
        <div class="match-track"><span style="width:${percent}%"></span></div>
        ${missingNames.length ? raw(`
          <button class="match-shop-btn" type="button"
            data-action="add-missing-to-shopping"
            data-missing="${missingNames.join(',')}"
            data-recipe-id="${recipe.id}">
            🛒 ${missingNames.join(', ')} 장보기 추가
          </button>
        `) : ''}
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
      const matchedNames = new Set(uniqueMatched.map((m) => makeIngredientTerms(m.name).canonical));
      const missing = ingredients
        .filter((name) => !matchIngredient(name, fridgeTerms))
        .slice(0, 5);
      const total = Math.max(ingredients.length, 1);
      return {
        recipe,
        matched: uniqueMatched,
        missing,
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

export function bindFridge(rootEl, navigate) {
  rootEl.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-action]');
    if (!form) return;
    e.preventDefault();

    if (form.dataset.action === 'add-fridge-item') {
      const input = form.elements.ingredient;
      const id = addFridgeItem({
        name: input.value,
        purchasedAt: form.elements.purchasedAt?.value,
        expiresAt: form.elements.expiresAt?.value,
      });
      if (id) {
        input.value = '';
        if (form.elements.expiresAt) form.elements.expiresAt.value = '';
        persistFridgeItem(id);
      }
    }

    if (form.dataset.action === 'add-shopping-item') {
      const input = form.elements.ingredient;
      const id = addShoppingItem(input.value);
      if (id) {
        input.value = '';
        persistFridgeItem(id);
      }
    }
  });

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
      setFridgeFocusItem(getState().filter.fridgeFocusId === id ? null : id);
    } else if (action === 'clear-fridge-focus') {
      setFridgeFocusItem(null);
    } else if (action === 'set-fridge-sort') {
      setFridgeSort(target.dataset.sort);
    } else if (action === 'set-fridge-tab') {
      setFridgeTab(target.dataset.tab);
    } else if (action === 'open-recipe') {
      navigate(`/recipe/${id}`);
    } else if (action === 'add-missing-to-shopping') {
      e.stopPropagation();
      const missing = (target.dataset.missing || '').split(',').map((s) => s.trim()).filter(Boolean);
      let addedCount = 0;
      for (const name of missing) {
        const newId = addShoppingItem(name);
        if (newId) {
          persistFridgeItem(newId);
          addedCount++;
        }
      }
      if (addedCount > 0) {
        setFridgeTab('shopping');
      }
    }
  });

  rootEl.addEventListener('change', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    if (target.dataset.action === 'toggle-fridge-item') {
      toggleFridgeItem(target.dataset.id);
      persistFridgeItem(target.dataset.id);
    } else if (target.dataset.action === 'buy-shopping-item') {
      // 장보기 체크 → 냉장고 재고로 이동
      const itemId = target.dataset.id;
      moveShoppingToFridge(itemId);
      persistFridgeItem(itemId);
      // 잠깐 후 재고 탭으로 이동 (시각적 피드백)
      setTimeout(() => setFridgeTab('stock'), 600);
    }
  });
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
