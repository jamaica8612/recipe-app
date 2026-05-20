import { CATEGORIES } from '../data.js';
import { markAnalysisAccepted } from './analyzeVideo.js';
import { getState, replaceLibrary } from '../store.js';
import { getSupabaseClient } from '../supabaseClient.js';

const CATEGORY_NAME_BY_ID = {
  korean: '한식',
  western: '양식',
  japanese: '일식',
  chinese: '중식',
  dessert: '디저트',
  etc: '기타',
};

const CATEGORY_ID_BY_NAME = Object.fromEntries(
  Object.entries(CATEGORY_NAME_BY_ID).map(([id, name]) => [name, id]),
);

export async function backupLocalDataToSupabase() {
  const supabase = getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error('로그인이 필요합니다.');
  }

  const state = getState();
  const userId = userData.user.id;
  await syncCustomCategories(supabase, userId, state.categories);
  const categoryMap = await loadCategoryMap(supabase);
  const memberMap = await upsertMembers(supabase, userId, state.members);
  const recipeCount = await upsertRecipes(supabase, userId, state.recipes, categoryMap, memberMap);
  await pruneRemoteSnapshot(supabase, userId, state);

  return {
    members: memberMap.size,
    recipes: recipeCount,
  };
}

export async function saveRecipeToSupabase(recipe) {
  const result = await syncRecipeToSupabase(recipe);
  if (!result.skipped) {
    await markAnalysisAccepted(recipe.videoId);
  }
  return result;
}

export async function syncRecipeToSupabase(recipe) {
  const supabase = getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { skipped: true, reason: 'not_signed_in' };
  }

  const state = getState();
  await syncCustomCategories(supabase, userData.user.id, state.categories);
  const categoryMap = await loadCategoryMap(supabase);
  const memberMap = await upsertMembers(supabase, userData.user.id, state.members);
  await upsertRecipes(supabase, userData.user.id, [recipe], categoryMap, memberMap);

  return {
    skipped: false,
    recipes: 1,
  };
}

export async function deleteRecipeFromSupabase(localRecipeId) {
  const supabase = getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { skipped: true, reason: 'not_signed_in' };
  }

  const { error } = await supabase
    .from('recipes')
    .delete()
    .eq('user_id', userData.user.id)
    .eq('source_local_id', localRecipeId);
  if (error) throw error;

  return { skipped: false };
}

export async function syncMemberToSupabase(member) {
  const supabase = getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { skipped: true, reason: 'not_signed_in' };
  }

  const result = await supabase
    .from('members')
    .upsert({
      user_id: userData.user.id,
      source_local_id: member.id,
      name: member.name,
      emoji: member.emoji || '👤',
      color: member.color || 'terra',
    }, { onConflict: 'user_id,source_local_id' })
    .select('id')
    .single();
  if (result.error) throw result.error;

  return { skipped: false, remoteId: result.data.id };
}

export async function deleteMemberFromSupabase(localMemberId) {
  const supabase = getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { skipped: true, reason: 'not_signed_in' };
  }

  const { error } = await supabase
    .from('members')
    .delete()
    .eq('user_id', userData.user.id)
    .eq('source_local_id', localMemberId);
  if (error) throw error;

  return { skipped: false };
}

export async function syncCategoryToSupabase(category) {
  if (isDefaultCategory(category.id)) {
    return { skipped: true, reason: 'default_category' };
  }

  const supabase = getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { skipped: true, reason: 'not_signed_in' };
  }

  const remote = await upsertCustomCategory(supabase, userData.user.id, category);
  return { skipped: false, remoteId: remote.id };
}

export async function deleteCategoryFromSupabase(category) {
  if (!category || isDefaultCategory(category.id)) {
    return { skipped: true, reason: 'default_category' };
  }

  const supabase = getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { skipped: true, reason: 'not_signed_in' };
  }

  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('user_id', userData.user.id)
    .eq('name', category.name);
  if (error) throw error;

  return { skipped: false };
}

export async function loadSupabaseDataIntoLocalState() {
  const supabase = getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error('로그인이 필요합니다.');
  }

  const [categoryResult, memberResult, recipeResult] = await Promise.all([
    supabase.from('categories').select('id,name,icon,is_default'),
    supabase
      .from('members')
      .select('id,source_local_id,name,emoji,color,created_at')
      .eq('user_id', userData.user.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('recipes')
      .select(`
        id,
        source_local_id,
        video_id,
        title,
        category_id,
        servings,
        cook_time_min,
        custom_notes,
        is_favorite,
        created_at,
        recipe_ingredients(name,amount,unit,sort_order),
        recipe_steps(step_order,text,timestamp_sec),
        recipe_members(member_id)
      `)
      .eq('user_id', userData.user.id)
      .order('created_at', { ascending: false }),
  ]);

  if (categoryResult.error) throw categoryResult.error;
  if (memberResult.error) throw memberResult.error;
  if (recipeResult.error) throw recipeResult.error;

  const categoryByRemoteId = new Map();
  const loadedCategories = [...CATEGORIES];
  for (const category of categoryResult.data || []) {
    categoryByRemoteId.set(category.id, category);
    if (!category.is_default) {
      loadedCategories.push({
        id: `cat-${category.id}`,
        name: category.name,
        icon: category.icon || '🏷',
      });
    }
  }

  const memberIdByRemoteId = new Map();
  const members = (memberResult.data || []).map((member) => {
    const localId = member.source_local_id || `remote-member-${member.id}`;
    memberIdByRemoteId.set(member.id, localId);
    return {
      id: localId,
      name: member.name,
      emoji: member.emoji || '👤',
      color: member.color || 'terra',
    };
  });

  const recipes = (recipeResult.data || []).map((recipe) => {
    const category = categoryByRemoteId.get(recipe.category_id);
    const memberIds = (recipe.recipe_members || [])
      .map((row) => memberIdByRemoteId.get(row.member_id))
      .filter(Boolean);

    return {
      id: recipe.source_local_id || `remote-recipe-${recipe.id}`,
      title: recipe.title,
      sub: recipe.video_id ? 'YouTube 분석 저장본' : 'Supabase 저장본',
      categoryId: remoteCategoryToLocalId(category),
      cookTimeMin: Number(recipe.cook_time_min) || 0,
      servings: Number(recipe.servings) || 1,
      memberIds,
      isFavorite: Boolean(recipe.is_favorite),
      videoId: recipe.video_id || `fake-${recipe.id}`,
      ingredients: sortBy(recipe.recipe_ingredients || [], 'sort_order').map((item) => ({
        name: item.name,
        amount: item.amount || '',
        unit: item.unit || '',
      })),
      steps: sortBy(recipe.recipe_steps || [], 'step_order').map((step, index) => ({
        order: Number(step.step_order) || index + 1,
        text: step.text,
        timestampSec: Number(step.timestamp_sec) || 0,
      })),
      tips: String(recipe.custom_notes || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      remoteId: recipe.id,
    };
  });

  replaceLibrary({
    members,
    recipes,
    categories: loadedCategories,
  });

  return {
    members: members.length,
    recipes: recipes.length,
  };
}

async function loadCategoryMap(supabase) {
  const { data, error } = await supabase
    .from('categories')
    .select('id,name,is_default');
  if (error) throw error;

  const map = new Map();
  for (const row of data || []) {
    map.set(row.name, row.id);
  }
  return map;
}

async function syncCustomCategories(supabase, userId, categories) {
  for (const category of categories || []) {
    if (!isDefaultCategory(category.id)) {
      await upsertCustomCategory(supabase, userId, category);
    }
  }
}

async function upsertCustomCategory(supabase, userId, category) {
  const payload = {
    user_id: userId,
    name: category.name,
    icon: category.icon || '🏷',
    is_default: false,
  };
  const existing = await supabase
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .eq('name', category.name)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data) {
    const update = await supabase
      .from('categories')
      .update({ icon: payload.icon })
      .eq('id', existing.data.id)
      .select('id')
      .single();
    if (update.error) throw update.error;
    return update.data;
  }

  const insert = await supabase
    .from('categories')
    .insert(payload)
    .select('id')
    .single();
  if (insert.error) throw insert.error;
  return insert.data;
}

async function upsertMembers(supabase, userId, members) {
  const memberMap = new Map();

  for (const member of members) {
    const payload = {
      user_id: userId,
      source_local_id: member.id,
      name: member.name,
      emoji: member.emoji || '👤',
      color: member.color || 'terra',
    };
    const result = await supabase
      .from('members')
      .upsert(payload, { onConflict: 'user_id,source_local_id' })
      .select('id')
      .single();
    if (result.error) throw result.error;
    memberMap.set(member.id, result.data.id);
  }

  return memberMap;
}

async function pruneRemoteSnapshot(supabase, userId, state) {
  await pruneRemoteRows({
    supabase,
    table: 'recipes',
    userId,
    keepIds: new Set((state.recipes || []).map((recipe) => recipe.id)),
  });
  await pruneRemoteRows({
    supabase,
    table: 'members',
    userId,
    keepIds: new Set((state.members || []).map((member) => member.id)),
  });
  await pruneRemoteCategories(supabase, userId, state.categories || []);
}

async function pruneRemoteRows({ supabase, table, userId, keepIds }) {
  const existing = await supabase
    .from(table)
    .select('source_local_id')
    .eq('user_id', userId)
    .not('source_local_id', 'is', null);
  if (existing.error) throw existing.error;

  const staleIds = (existing.data || [])
    .map((row) => row.source_local_id)
    .filter((id) => id && !keepIds.has(id));

  for (const id of staleIds) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('user_id', userId)
      .eq('source_local_id', id);
    if (error) throw error;
  }
}

async function pruneRemoteCategories(supabase, userId, categories) {
  const keepNames = new Set(
    categories
      .filter((category) => !isDefaultCategory(category.id))
      .map((category) => category.name),
  );
  const existing = await supabase
    .from('categories')
    .select('name')
    .eq('user_id', userId)
    .eq('is_default', false);
  if (existing.error) throw existing.error;

  const staleNames = (existing.data || [])
    .map((row) => row.name)
    .filter((name) => name && !keepNames.has(name));

  for (const name of staleNames) {
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('user_id', userId)
      .eq('name', name);
    if (error) throw error;
  }
}

async function upsertRecipes(supabase, userId, recipes, categoryMap, memberMap) {
  let count = 0;
  for (const recipe of recipes) {
    const videoId = await getLinkableVideoId(supabase, recipe.videoId);

    const categoryName = getLocalCategoryName(recipe.categoryId);
    const recipeResult = await supabase.from('recipes').upsert({
      user_id: userId,
      source_local_id: recipe.id,
      video_id: videoId,
      title: recipe.title,
      category_id: categoryMap.get(categoryName) || categoryMap.get('기타') || null,
      servings: Number(recipe.servings) || 1,
      cook_time_min: Number(recipe.cookTimeMin) || 0,
      custom_notes: recipe.tips?.join('\n') || null,
      is_favorite: Boolean(recipe.isFavorite),
    }, { onConflict: 'user_id,source_local_id' }).select('id').single();
    if (recipeResult.error) throw recipeResult.error;

    const recipeId = recipeResult.data.id;
    await clearRecipeChildren(supabase, recipeId);
    await insertIngredients(supabase, recipeId, recipe.ingredients || []);
    await insertSteps(supabase, recipeId, recipe.steps || []);
    await insertRecipeMembers(supabase, recipeId, recipe.memberIds || [], memberMap);
    count += 1;
  }
  return count;
}

async function getLinkableVideoId(supabase, videoId) {
  if (!videoId || videoId.startsWith('fake-')) return null;

  const { data, error } = await supabase
    .from('video_analyses')
    .select('youtube_video_id')
    .eq('youtube_video_id', videoId)
    .maybeSingle();
  if (error || !data) return null;

  return data.youtube_video_id;
}

async function clearRecipeChildren(supabase, recipeId) {
  const memberResult = await supabase.from('recipe_members').delete().eq('recipe_id', recipeId);
  if (memberResult.error) throw memberResult.error;
  const ingredientResult = await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId);
  if (ingredientResult.error) throw ingredientResult.error;
  const stepResult = await supabase.from('recipe_steps').delete().eq('recipe_id', recipeId);
  if (stepResult.error) throw stepResult.error;
}

async function insertIngredients(supabase, recipeId, ingredients) {
  const rows = ingredients
    .filter((item) => item.name)
    .map((item, index) => ({
      recipe_id: recipeId,
      name: item.name,
      amount: item.amount == null ? '' : String(item.amount),
      unit: item.unit || '',
      sort_order: index + 1,
    }));
  if (!rows.length) return;
  const { error } = await supabase.from('recipe_ingredients').insert(rows);
  if (error) throw error;
}

async function insertSteps(supabase, recipeId, steps) {
  const rows = steps
    .filter((step) => step.text)
    .map((step, index) => ({
      recipe_id: recipeId,
      step_order: Number(step.order) || index + 1,
      text: step.text,
      timestamp_sec: Number(step.timestampSec) || 0,
    }));
  if (!rows.length) return;
  const { error } = await supabase.from('recipe_steps').insert(rows);
  if (error) throw error;
}

async function insertRecipeMembers(supabase, recipeId, memberIds, memberMap) {
  const rows = memberIds
    .map((localId) => memberMap.get(localId))
    .filter(Boolean)
    .map((memberId) => ({ recipe_id: recipeId, member_id: memberId }));
  if (!rows.length) return;
  const { error } = await supabase.from('recipe_members').insert(rows);
  if (error) throw error;
}

function categoryNameToLocalId(name) {
  return CATEGORY_ID_BY_NAME[name] || 'etc';
}

function getLocalCategoryName(categoryId) {
  return CATEGORY_NAME_BY_ID[categoryId]
    || getState().categories.find((category) => category.id === categoryId)?.name
    || '기타';
}

function remoteCategoryToLocalId(category) {
  if (!category) return 'etc';
  if (category.is_default) return categoryNameToLocalId(category.name);
  return `cat-${category.id}`;
}

function isDefaultCategory(id) {
  return id === 'all' || Object.hasOwn(CATEGORY_NAME_BY_ID, id);
}

function sortBy(rows, key) {
  return [...rows].sort((a, b) => (Number(a[key]) || 0) - (Number(b[key]) || 0));
}
