// 목업 데이터 — Supabase 연결 전까지 로컬 메모리에서 동작
// 추후 데이터 소스만 supabase 클라이언트로 교체하면 됨

export const MEMBERS = [];

export const CATEGORIES = [
  { id: 'all',      name: '전체',   icon: '🍽️' },
  { id: 'korean',   name: '한식',   icon: '🍚' },
  { id: 'western',  name: '양식',   icon: '🍝' },
  { id: 'japanese', name: '일식',   icon: '🍣' },
  { id: 'chinese',  name: '중식',   icon: '🥟' },
  { id: 'dessert',  name: '디저트', icon: '🍰' },
  { id: 'etc',      name: '기타',   icon: '📦' },
];

// 상황 태그 — 카테고리와 별개의 2차 분류 (다대다)
export const SITUATION_TAGS = [
  { id: 'party',     name: '홈파티',     icon: '🎉' },
  { id: 'solo',      name: '혼밥',       icon: '🍴' },
  { id: 'lunchbox',  name: '도시락',     icon: '🍱' },
  { id: 'diet',      name: '다이어트',   icon: '🥗' },
  { id: 'quick',     name: '초스피드',   icon: '⚡' },
  { id: 'airfryer',  name: '에어프라이어',icon: '🔥' },
  { id: 'guest',     name: '손님상',     icon: '🎁' },
  { id: 'late',      name: '야식',       icon: '🌙' },
];

export const RECIPES = [];

// 헬퍼
export function findSituationTag(id) {
  return SITUATION_TAGS.find((t) => t.id === id);
}
export function findRecipe(id) {
  return RECIPES.find((r) => r.id === id);
}
export function findMember(id) {
  return MEMBERS.find((m) => m.id === id);
}
export function findCategory(id) {
  return CATEGORIES.find((c) => c.id === id);
}
export function formatDuration(min) {
  return `${min}분`;
}
export function formatTimestamp(sec) {
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}
