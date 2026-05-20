// 목업 데이터 — Supabase 연결 전까지 로컬 메모리에서 동작
// 추후 데이터 소스만 supabase 클라이언트로 교체하면 됨

export const MEMBERS = [
  { id: 'm1', name: '아빠', emoji: '👨', color: 'terra' },
  { id: 'm2', name: '딸',   emoji: '👧', color: 'olive' },
  { id: 'm3', name: '엄마', emoji: '👩', color: 'mustard' },
];

export const CATEGORIES = [
  { id: 'all',      name: '전체',   icon: '🍽️' },
  { id: 'korean',   name: '한식',   icon: '🍚' },
  { id: 'western',  name: '양식',   icon: '🍝' },
  { id: 'japanese', name: '일식',   icon: '🍣' },
  { id: 'chinese',  name: '중식',   icon: '🥟' },
  { id: 'dessert',  name: '디저트', icon: '🍰' },
  { id: 'etc',      name: '기타',   icon: '📦' },
];

export const RECIPES = [
  {
    id: 'r1',
    title: '김치찌개',
    sub: '백종원식',
    categoryId: 'korean',
    cookTimeMin: 30,
    servings: 4,
    memberIds: ['m1'],
    isFavorite: true,
    videoId: 'fake-1',
    ingredients: [
      { name: '신김치',             amount: 300, unit: 'g' },
      { name: '돼지고기 앞다리살',  amount: 200, unit: 'g' },
      { name: '두부',               amount: 1,   unit: '모' },
      { name: '대파',               amount: 1,   unit: '대' },
    ],
    steps: [
      { order: 1, text: '김치를 한입 크기로 썰어 팬에 기름을 두르고 충분히 볶는다.',  timestampSec: 42 },
      { order: 2, text: '물을 자작하게 붓고, 돼지고기를 결대로 썰어 함께 넣는다.',     timestampSec: 135 },
      { order: 3, text: '두부와 대파를 마지막에 올려 10분간 더 끓인다.',                timestampSec: 330 },
    ],
    tips: ['신김치일수록 깊은 맛이 난다', '간은 김치 자체에서'],
  },
  {
    id: 'r2',
    title: '까르보나라',
    sub: '본토식 (계란만)',
    categoryId: 'western',
    cookTimeMin: 20,
    servings: 2,
    memberIds: ['m2', 'm3'],
    isFavorite: false,
    videoId: 'fake-2',
    ingredients: [
      { name: '스파게티면',     amount: 200, unit: 'g' },
      { name: '판체타',         amount: 100, unit: 'g' },
      { name: '계란 노른자',    amount: 4,   unit: '개' },
      { name: '페코리노 치즈',  amount: 80,  unit: 'g' },
    ],
    steps: [
      { order: 1, text: '판체타를 깍둑 썰어 약불에 천천히 굽는다.',                timestampSec: 30 },
      { order: 2, text: '노른자에 치즈를 섞고 후추를 듬뿍 갈아 넣는다.',           timestampSec: 90 },
      { order: 3, text: '면수 한 국자와 함께 불 끄고 빠르게 비빈다.',              timestampSec: 180 },
    ],
    tips: ['크림은 절대 넣지 않는다', '불 끄고 비비는 게 핵심'],
  },
  {
    id: 'r3',
    title: '마파두부',
    sub: '쓰촨식',
    categoryId: 'chinese',
    cookTimeMin: 25,
    servings: 3,
    memberIds: ['m1', 'm2'],
    isFavorite: true,
    videoId: 'fake-3',
    ingredients: [
      { name: '연두부',          amount: 1,   unit: '모' },
      { name: '다진 돼지고기',   amount: 150, unit: 'g' },
      { name: '두반장',          amount: 2,   unit: '큰술' },
    ],
    steps: [
      { order: 1, text: '두반장을 약불에 볶아 향을 낸다.',                          timestampSec: 20 },
      { order: 2, text: '다진 고기를 넣어 색이 변할 때까지 볶는다.',                timestampSec: 90 },
      { order: 3, text: '물과 두부를 넣고 살짝 끓인 뒤 전분으로 농도를 맞춘다.',    timestampSec: 240 },
    ],
    tips: ['두부는 살살 다뤄야 부서지지 않는다'],
  },
  {
    id: 'r4',
    title: '연어 데리야끼',
    sub: '간장 베이스',
    categoryId: 'japanese',
    cookTimeMin: 15,
    servings: 2,
    memberIds: ['m3'],
    isFavorite: false,
    videoId: 'fake-4',
    ingredients: [
      { name: '연어 필레', amount: 2, unit: '조각' },
      { name: '간장',      amount: 3, unit: '큰술' },
      { name: '미림',      amount: 2, unit: '큰술' },
    ],
    steps: [
      { order: 1, text: '연어 표면 물기를 키친타올로 제거한다.',                    timestampSec: 10 },
      { order: 2, text: '약불에 껍질부터 굽다가 뒤집어 양념을 끼얹는다.',           timestampSec: 120 },
    ],
    tips: [],
  },
];

// 헬퍼
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
