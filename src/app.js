import { currentRoute, onRouteChange, go } from './router.js';
import { subscribe, getState } from './store.js';
import { getSupabaseClient } from './supabaseClient.js';
import { loadSupabaseDataIntoLocalState } from './api/syncSupabase.js';
import { renderHome, bindHome } from './views/home.js?v=20260521-restore-v1';
import { renderAnalyze, bindAnalyze } from './views/analyze.js';
import { renderPreview, bindPreview } from './views/preview.js?v=20260521-channel-v1';
import { renderDetail, bindDetail } from './views/detail.js?v=20260521-detail-v4';
import { renderCook, bindCook } from './views/cook.js?v=20260521-cook-v4';
import { renderEditRecipe, bindEditRecipe } from './views/editRecipe.js?v=20260521-no-situation-v1';
import { renderMembers, bindMembers } from './views/members.js';
import { renderSettings, bindSettings } from './views/settings.js?v=20260527-gmail-v1';
import { renderAccount, bindAccount } from './views/account.js';
import { renderSearch, bindSearch } from './views/search.js?v=20260521-search-v3';
import { renderFridge, bindFridge } from './views/fridge.js?v=20260527-freezer-v1';
import { icon } from './icons.js';

const app = document.querySelector('#app');
let activeRoute = currentRoute();

const navItems = [
  { id: 'home', href: '#/home', iconName: 'home', label: '홈' },
  { id: 'search', href: '#/search', iconName: 'search', label: '검색' },
  { id: 'analyze', href: '#/analyze', iconName: 'plus', label: '분석' },
  { id: 'fridge', href: '#/fridge', iconName: 'fridge', label: '냉장고' },
  { id: 'pantry', href: '#/pantry', iconName: 'pantry', label: '실온보관' },
];

function navigate(path) {
  go(path);
}

function nav(active) {
  const links = navItems.map((item) => `
    <a href="${item.href}" class="${active === item.id ? 'is-active' : ''} ${item.id === 'analyze' ? 'fab' : ''}">
      <span class="ic">${icon(item.iconName, item.id === 'analyze' ? 22 : 20)}</span>
      <span>${item.label}</span>
    </a>
  `).join('');

  return `
    <aside class="app-side">
      <div class="side-brand">
        <span class="side-brand-mark">${icon('book', 22)}</span>
        <span>가족 레시피</span>
      </div>
      <nav class="side-nav">${links}</nav>
    </aside>
    <div class="app-bottom">
      <nav class="nav-row nav-5">${links}</nav>
    </div>
  `;
}

function resolveView(route) {
  if (route.path === 'analyze') return [renderAnalyze(), (root) => bindAnalyze(root, navigate)];
  if (route.path === 'search') return [renderSearch(), (root) => bindSearch(root, navigate)];
  if (route.path === 'fridge') return [renderFridge('fridge'), (root) => bindFridge(root, navigate, 'fridge')];
  if (route.path === 'pantry') return [renderFridge('pantry'), (root) => bindFridge(root, navigate, 'pantry')];
  if (route.path === 'preview') {
    const draftId = route.params[0];
    return [renderPreview(draftId), (root) => bindPreview(root, navigate, draftId)];
  }
  if (route.path === 'recipe') {
    const recipeId = route.params[0];
    return [renderDetail(recipeId), (root) => bindDetail(root, navigate, recipeId)];
  }
  if (route.path === 'cook') {
    const recipeId = route.params[0];
    return [renderCook(recipeId), (root) => bindCook(root, navigate, recipeId)];
  }
  if (route.path === 'edit') {
    const recipeId = route.params[0];
    return [renderEditRecipe(recipeId), (root) => bindEditRecipe(root, navigate, recipeId)];
  }
  if (route.path === 'members') return [renderMembers(), (root) => bindMembers(root)];
  if (route.path === 'settings') return [renderSettings(), (root) => bindSettings(root, navigate)];
  if (route.path === 'account') return [renderAccount(), (root) => bindAccount(root, navigate)];
  return [renderHome(), (root) => bindHome(root, navigate)];
}

async function render(route = currentRoute()) {
  activeRoute = route;
  const [viewOrPromise, bind] = resolveView(route);
  const view = await viewOrPromise;
  app.className = `app-shell ${view.showNav ? 'has-nav' : 'no-nav'}`;
  app.innerHTML = `
    ${view.showNav ? nav(view.activeNav) : ''}
    <div class="app-content">
      ${view.hideHeader ? '' : `<header class="app-header">${view.header}</header>`}
      <main class="app-body ${view.flush ? 'is-flush' : ''}">${view.body}</main>
    </div>
  `;
  bind(app);
}

onRouteChange(render);
subscribe(() => render(activeRoute));
render();

// 로그인 상태면 자동으로 Supabase에서 데이터 불러오기
getSupabaseClient().auth.onAuthStateChange(async (event, session) => {
  if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
    const state = getState();
    if ((state.recipes || []).length === 0) {
      try {
        await loadSupabaseDataIntoLocalState();
      } catch (err) {
        console.warn('Supabase 자동 불러오기 실패:', err);
      }
    }
  }
});
