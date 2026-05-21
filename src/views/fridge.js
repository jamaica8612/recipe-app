// 냉장고 — 가진 재료를 기준으로 만들 수 있는 레시피 추천
import { html, raw, ytThumbnail } from '../util.js';
import { addFridgeItem, deleteFridgeItem, getState, toggleFridgeItem } from '../store.js';
import { deleteFridgeItemFromSupabase, syncFridgeItemToSupabase } from '../api/syncSupabase.js';
import { icon } from '../icons.js';

export function renderFridge() {
  const s = getState();
  const items = s.fridgeItems || [];
  const activeItems = items.filter((item) => item.checked);
  const matches = rankRecipesByFridge(s.recipes || [], activeItems);

  return {
    header: html`
      <div class="title">${raw(icon('fridge', 18))}<span>냉장고</span></div>
      <div style="width:36px"></div>
    `,
    body: html`
      <form class="fridge-form" data-action="add-fridge-item">
        <label class="field">
          <input class="input" name="ingredient" autocomplete="off"
                 placeholder="있는 재료 입력: 두부, 대파, 양파..." />
        </label>
        <button class="primary-btn" type="submit">추가</button>
      </form>

      <section class="fridge-section">
        <div class="section-row">
          <div>
            <h2 class="section-title">있는 재료</h2>
            <p class="section-note">체크된 재료만 추천에 반영돼요</p>
          </div>
        </div>
        ${raw(renderFridgeItems(items))}
      </section>

      <section class="fridge-section">
        <div class="section-row">
          <div>
            <h2 class="section-title">오늘 만들 수 있는 것</h2>
            <p class="section-note">${activeItems.length ? `${activeItems.length}개 재료 기준` : '재료를 추가하면 추천이 떠요'}</p>
          </div>
        </div>
        ${raw(renderMatches(matches, activeItems))}
      </section>
    `,
    flush: false,
    showNav: true,
    activeNav: 'fridge',
  };
}

function renderFridgeItems(items) {
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
      ${raw(items.map((item) => html`
        <label class="fridge-chip ${item.checked ? 'is-on' : ''}">
          <input type="checkbox" data-action="toggle-fridge-item" data-id="${item.id}" ${item.checked ? 'checked' : ''} />
          <span>${item.name}</span>
          <button type="button" data-action="delete-fridge-item" data-id="${item.id}" title="삭제">×</button>
        </label>
      `).join(''))}
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
        <div class="sub">${matched.length}/${total}개 재료 있음 · ${matched.join(', ')}</div>
        <div class="match-track"><span style="width:${percent}%"></span></div>
      </div>
    </div>
  `;
}

function rankRecipesByFridge(recipes, activeItems) {
  const fridgeNames = activeItems.map((item) => normalizeIngredientName(item.name));
  if (!fridgeNames.length) return [];

  return recipes
    .map((recipe) => {
      const ingredients = (recipe.ingredients || [])
        .map((item) => String(item.name || '').trim())
        .filter(Boolean);
      const matched = ingredients.filter((name) => {
        const ingredientName = normalizeIngredientName(name);
        return fridgeNames.some((fridgeName) =>
          ingredientName.includes(fridgeName) || fridgeName.includes(ingredientName),
        );
      });
      const uniqueMatched = [...new Set(matched)];
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

function normalizeIngredientName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[0-9./]+/g, '')
    .replace(/[a-z]+/g, '')
    .trim();
}

export function bindFridge(rootEl, navigate) {
  rootEl.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-action="add-fridge-item"]');
    if (!form) return;
    e.preventDefault();
    const input = form.elements.ingredient;
    const id = addFridgeItem(input.value);
    if (id) {
      input.value = '';
      persistFridgeItem(id);
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
    } else if (action === 'open-recipe') {
      navigate(`/recipe/${id}`);
    }
  });

  rootEl.addEventListener('change', (e) => {
    const target = e.target.closest('[data-action="toggle-fridge-item"]');
    if (target) {
      toggleFridgeItem(target.dataset.id);
      persistFridgeItem(target.dataset.id);
    }
  });
}

function persistFridgeItem(id) {
  const item = getState().fridgeItems.find((fridgeItem) => fridgeItem.id === id);
  if (!item) return;
  syncFridgeItemToSupabase(item).catch((err) => {
    console.warn('Supabase fridge sync failed', err);
  });
}
