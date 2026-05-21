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

const INGREDIENT_ALIASES = [
  ['김치', '신김치', '묵은지', '배추김치'],
  ['돼지고기', '돼지', '돈육', '앞다리살', '뒷다리살', '목살', '삼겹살', '다진돼지고기'],
  ['소고기', '쇠고기', '우육', '불고기', '다진소고기'],
  ['닭고기', '닭', '닭다리살', '닭가슴살', '닭안심'],
  ['대파', '파', '쪽파', '실파'],
  ['양파', '적양파'],
  ['마늘', '다진마늘', '통마늘'],
  ['생강', '다진생강'],
  ['고추', '청양고추', '풋고추', '홍고추'],
  ['두부', '연두부', '순두부', '부침두부', '찌개두부'],
  ['계란', '달걀', '노른자', '흰자'],
  ['버섯', '표고버섯', '새송이버섯', '양송이버섯', '느타리버섯', '팽이버섯'],
  ['면', '스파게티면', '파스타면', '소면', '중면', '우동면', '라면사리'],
  ['치즈', '파마산', '파르미지아노', '페코리노', '모짜렐라', '체다'],
  ['베이컨', '판체타', '햄'],
  ['연어', '연어필레', '생연어'],
  ['간장', '진간장', '양조간장', '국간장'],
  ['설탕', '흑설탕', '황설탕', '올리고당', '물엿', '꿀'],
  ['맛술', '미림', '청주', '요리술'],
  ['고추장', '초고추장'],
  ['된장', '미소'],
  ['고춧가루', '고추가루'],
  ['식초', '현미식초', '사과식초'],
  ['기름', '식용유', '올리브유', '카놀라유', '포도씨유'],
  ['참기름', '들기름'],
  ['밥', '쌀밥', '현미밥', '즉석밥'],
  ['감자', '알감자'],
  ['당근', '홍당무'],
  ['양배추', '배추'],
];

const TERM_TO_GROUP = new Map();
for (const group of INGREDIENT_ALIASES) {
  const normalized = group.map((item) => normalizeIngredientName(item)).filter(Boolean);
  for (const term of normalized) TERM_TO_GROUP.set(term, normalized);
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
    const key = normalizeIngredientName(match.name);
    const existing = map.get(key);
    if (!existing || match.score > existing.score) map.set(key, match);
  }
  return Array.from(map.values());
}

function makeIngredientTerms(name) {
  const original = String(name || '').trim();
  const canonical = normalizeIngredientName(original);
  const terms = new Set(canonical ? [canonical] : []);
  for (const token of tokenizeIngredientName(original)) {
    const normalized = normalizeIngredientName(token);
    if (normalized) terms.add(normalized);
  }
  for (const term of [...terms]) {
    const group = TERM_TO_GROUP.get(term);
    if (group) group.forEach((alias) => terms.add(alias));
  }
  return { original, canonical, terms };
}

function tokenizeIngredientName(name) {
  return String(name || '')
    .replace(/[()[\],·]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function hasFuzzyOverlap(aTerms, bTerms) {
  for (const a of aTerms) {
    if (a.length < 2) continue;
    for (const b of bTerms) {
      if (b.length < 2) continue;
      if (a.includes(b) || b.includes(a)) return true;
    }
  }
  return false;
}

function normalizeIngredientName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[0-9./]+/g, '')
    .replace(/[a-z]+/g, '')
    .replace(/필레|슬라이스|다진|간|생|냉동|냉장|통|국산|수입/g, '')
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
