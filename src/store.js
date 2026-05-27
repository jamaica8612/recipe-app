// 매우 단순한 전역 상태 — localStorage로 영속화 + 변경 시 콜백 호출
// Supabase 연동 시 fetch/insert/update 로직만 이 안에서 바꾸면 됨

import { RECIPES, MEMBERS, CATEGORIES } from './data.js';
import { hasFuzzyOverlap, makeIngredientTerms, normalizeSearchText } from './ingredientMatch.js';

const KEY = 'recipe-app:v2';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveToStorage(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 용량 초과 등은 일단 무시 */
  }
}

function defaultState() {
  return {
    recipes:    [...RECIPES],
    members:    [...MEMBERS],
    categories: [...CATEGORIES],
    fridgeItems: [],
    analysisDrafts: [],
    filter: { categoryId: 'all', memberId: null, favoriteOnly: false, query: '', viewMode: 'category', fridgeFocusId: null, fridgeSort: 'expiry', fridgeCompartment: 'all', pantryFocusId: null, pantrySort: 'expiry' },
  };
}

function normalizeState(value) {
  const base = defaultState();
  if (!value || typeof value !== 'object') return base;

  return {
    ...base,
    ...value,
    recipes: Array.isArray(value.recipes) ? value.recipes : base.recipes,
    members: Array.isArray(value.members) ? value.members : base.members,
    categories: normalizeCategories(value.categories, base.categories),
    fridgeItems: normalizeFridgeItems(value.fridgeItems),
    analysisDrafts: Array.isArray(value.analysisDrafts) ? value.analysisDrafts : [],
    filter: {
      ...base.filter,
      ...(value.filter && typeof value.filter === 'object' ? value.filter : {}),
    },
  };
}

function normalizeCategories(categories, fallback) {
  if (!Array.isArray(categories) || categories.length === 0) return fallback;
  const hasAll = categories.some((category) => category.id === 'all');
  return hasAll ? categories : [fallback[0], ...categories];
}

function normalizeFridgeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      id: item?.id || `fi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: String(item?.name || '').trim(),
      checked: Boolean(item?.checked),
      storage: normalizeStorageValue(item?.storage),
      purchasedAt: normalizeDateValue(item?.purchasedAt || item?.purchased_at),
      expiresAt: normalizeDateValue(item?.expiresAt || item?.expires_at),
    }))
    .filter((item) => item.name);
}

function normalizeDateValue(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function normalizeStorageValue(value) {
  if (value === 'pantry' || value === 'freezer') return value;
  return 'fridge';
}

const initial = loadFromStorage() || defaultState();

let state = initial;
const listeners = new Set();

export function getState() { return state; }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function set(updater) {
  state = typeof updater === 'function' ? updater(state) : { ...state, ...updater };
  saveToStorage(state);
  for (const fn of listeners) fn(state);
}

// === actions ===
export function setCategoryFilter(categoryId) {
  set((s) => ({ ...s, filter: { ...s.filter, categoryId } }));
}
export function toggleMemberFilter(memberId) {
  set((s) => ({
    ...s,
    filter: { ...s.filter, memberId: s.filter.memberId === memberId ? null : memberId },
  }));
}
export function toggleFavoriteFilter() {
  set((s) => ({ ...s, filter: { ...s.filter, favoriteOnly: !s.filter.favoriteOnly } }));
}
export function setSearchQuery(query) {
  set((s) => ({ ...s, filter: { ...s.filter, query: String(query || '') } }));
}
export function setViewMode(viewMode) {
  // viewMode: 'category' | 'member' | 'chef'
  const allowed = ['category', 'member', 'chef'];
  const next = allowed.includes(viewMode) ? viewMode : 'category';
  set((s) => ({ ...s, filter: { ...s.filter, viewMode: next } }));
}
export function setFridgeFocusItem(id, storage = 'fridge') {
  const key = storage === 'pantry' ? 'pantryFocusId' : 'fridgeFocusId';
  set((s) => ({ ...s, filter: { ...s.filter, [key]: id || null } }));
}
export function setFridgeSort(sort, storage = 'fridge') {
  const next = sort === 'name' ? 'name' : 'expiry';
  const key = storage === 'pantry' ? 'pantrySort' : 'fridgeSort';
  set((s) => ({ ...s, filter: { ...s.filter, [key]: next } }));
}
export function setFridgeCompartment(compartment) {
  const allowed = ['all', 'fridge', 'freezer'];
  const next = allowed.includes(compartment) ? compartment : 'all';
  set((s) => ({ ...s, filter: { ...s.filter, fridgeCompartment: next } }));
}
export function toggleFavorite(recipeId) {
  set((s) => ({
    ...s,
    recipes: s.recipes.map((r) =>
      r.id === recipeId ? { ...r, isFavorite: !r.isFavorite } : r,
    ),
  }));
}
export function addRecipe(recipe) {
  const id = 'r' + (Date.now() % 1e8).toString(36);
  const newOne = { ...recipe, id, isFavorite: false };
  set((s) => ({ ...s, recipes: [newOne, ...s.recipes] }));
  return id;
}

export function createAnalysisDraft({ url, videoId, response }) {
  const id = 'd' + (Date.now() % 1e8).toString(36);
  const draft = {
    id,
    url,
    videoId,
    response,
    createdAt: new Date().toISOString(),
  };
  set((s) => ({ ...s, analysisDrafts: [draft, ...(s.analysisDrafts || [])].slice(0, 20) }));
  return id;
}

export function getAnalysisDraft(id) {
  return (state.analysisDrafts || []).find((draft) => draft.id === id) || null;
}

export function saveDraftAsRecipe(draftId, recipe) {
  const id = addRecipe(recipe);
  set((s) => ({
    ...s,
    analysisDrafts: (s.analysisDrafts || []).filter((draft) => draft.id !== draftId),
  }));
  return id;
}
export function updateRecipe(id, patch) {
  set((s) => ({
    ...s,
    recipes: s.recipes.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }));
}
export function deleteRecipe(id) {
  set((s) => ({ ...s, recipes: s.recipes.filter((r) => r.id !== id) }));
}

export function addCategory(category) {
  const id = 'c' + (Date.now() % 1e8).toString(36);
  set((s) => ({ ...s, categories: [...s.categories, { ...category, id }] }));
  return id;
}

export function updateCategory(id, patch) {
  set((s) => ({
    ...s,
    categories: s.categories.map((category) =>
      category.id === id ? { ...category, ...patch, id } : category,
    ),
  }));
}

export function deleteCategory(id) {
  set((s) => ({
    ...s,
    categories: s.categories.filter((category) => category.id !== id),
    recipes: s.recipes.map((recipe) => ({
      ...recipe,
      categoryId: recipe.categoryId === id ? 'etc' : recipe.categoryId,
    })),
    filter: {
      ...s.filter,
      categoryId: s.filter.categoryId === id ? 'all' : s.filter.categoryId,
    },
  }));
}

export function addMember(member) {
  const id = 'm' + (Date.now() % 1e8).toString(36);
  set((s) => ({ ...s, members: [...s.members, { ...member, id }] }));
  return id;
}
export function updateMember(id, patch) {
  set((s) => ({
    ...s,
    members: s.members.map((member) =>
      member.id === id ? { ...member, ...patch, id } : member,
    ),
  }));
}
export function deleteMember(id) {
  set((s) => ({
    ...s,
    members: s.members.filter((m) => m.id !== id),
    recipes: s.recipes.map((r) => ({
      ...r,
      memberIds: r.memberIds.filter((mid) => mid !== id),
    })),
  }));
}

export function addFridgeItem(input) {
  const payload = typeof input === 'object' && input !== null ? input : { name: input };
  const clean = String(payload.name || '').trim();
  if (!clean) return null;

  const storage = normalizeStorageValue(payload.storage);
  const exists = state.fridgeItems.some(
    (item) => (item.storage || 'fridge') === storage && item.name.toLowerCase() === clean.toLowerCase(),
  );
  if (exists) return null;

  const id = 'fi' + (Date.now() % 1e8).toString(36);
  set((s) => ({
    ...s,
    fridgeItems: [...(s.fridgeItems || []), {
      id,
      name: clean,
      checked: true,
      storage,
      purchasedAt: normalizeDateValue(payload.purchasedAt),
      expiresAt: normalizeDateValue(payload.expiresAt),
    }],
  }));
  return id;
}

export function updateFridgeItem(id, patch) {
  set((s) => ({
    ...s,
    fridgeItems: (s.fridgeItems || []).map((item) =>
      item.id === id
        ? {
            ...item,
            ...patch,
            name: patch.name == null ? item.name : String(patch.name || '').trim(),
            purchasedAt: patch.purchasedAt == null ? item.purchasedAt : normalizeDateValue(patch.purchasedAt),
            expiresAt: patch.expiresAt == null ? item.expiresAt : normalizeDateValue(patch.expiresAt),
          }
        : item,
    ).filter((item) => item.name),
  }));
}

export function toggleFridgeItem(id) {
  set((s) => ({
    ...s,
    fridgeItems: (s.fridgeItems || []).map((item) =>
      item.id === id ? { ...item, checked: !item.checked } : item,
    ),
  }));
}

export function deleteFridgeItem(id) {
  set((s) => ({
    ...s,
    fridgeItems: (s.fridgeItems || []).filter((item) => item.id !== id),
    filter: {
      ...s.filter,
      fridgeFocusId: s.filter.fridgeFocusId === id ? null : s.filter.fridgeFocusId,
    },
  }));
}

export function replaceLibrary({ members, recipes, categories, fridgeItems }) {
  set((s) => ({
    ...s,
    members: members || [],
    recipes: recipes || [],
    categories: categories || s.categories,
    fridgeItems: Array.isArray(fridgeItems) ? fridgeItems : (s.fridgeItems || []),
    filter: { categoryId: 'all', memberId: null, favoriteOnly: false, query: '', viewMode: 'category' },
  }));
}

export function setFlash(message) {
  set((s) => ({ ...s, flash: message || '' }));
}

export function consumeFlash() {
  const message = state.flash || '';
  if (message) {
    state = { ...state, flash: '' };
    saveToStorage(state);
  }
  return message;
}

// 필터링된 레시피 리스트
export function getFilteredRecipes() {
  const { recipes, filter } = state;
  const query = String(filter.query || '').trim().toLowerCase();
  return recipes.filter((r) => {
    if (filter.categoryId !== 'all' && r.categoryId !== filter.categoryId) return false;
    if (filter.memberId && !r.memberIds.includes(filter.memberId)) return false;
    if (filter.favoriteOnly && !r.isFavorite) return false;
    if (query && !recipeMatchesQuery(r, query)) return false;
    return true;
  });
}

function recipeMatchesQuery(recipe, query) {
  const normalizedQuery = normalizeSearchText(query);
  const queryTerms = makeIngredientTerms(query);
  const fields = [
    recipe.title,
    recipe.sub,
    recipe.channelName,
    recipe.chefName,
    ...(recipe.ingredients || []).map((item) => item.name),
    ...(recipe.steps || []).map((step) => step.text),
    ...(recipe.tips || []),
  ];
  const textMatch = fields.some((value) => normalizeSearchText(value).includes(normalizedQuery));
  if (textMatch) return true;

  return (recipe.ingredients || []).some((item) =>
    hasFuzzyOverlap(makeIngredientTerms(item.name).terms, queryTerms.terms),
  );
}
