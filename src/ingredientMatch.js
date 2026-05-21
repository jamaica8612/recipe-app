export const INGREDIENT_ALIASES = [
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

export function makeIngredientTerms(name) {
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

export function normalizeIngredientName(name) {
  return normalizeSearchText(name)
    .replace(/[0-9./]+/g, '')
    .replace(/[a-z]+/g, '')
    .replace(/필레|슬라이스|다진|간|생|냉동|냉장|통|국산|수입/g, '')
    .trim();
}

export function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim();
}

export function hasFuzzyOverlap(aTerms, bTerms) {
  for (const a of aTerms) {
    if (a.length < 2) continue;
    for (const b of bTerms) {
      if (b.length < 2) continue;
      if (a.includes(b) || b.includes(a)) return true;
    }
  }
  return false;
}

function tokenizeIngredientName(name) {
  return String(name || '')
    .replace(/[()[\],·]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
