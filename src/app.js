import { currentRoute, onRouteChange, go } from './router.js';
import { subscribe } from './store.js';
import { renderHome, bindHome } from './views/home.js?v=20260521-restore-v1';
import { renderAnalyze, bindAnalyze } from './views/analyze.js';
import { renderPreview, bindPreview } from './views/preview.js?v=20260521-channel-v1';
import { renderDetail, bindDetail } from './views/detail.js?v=20260521-detail-v4';
import { renderCook, bindCook } from './views/cook.js?v=20260521-cook-v4';
import { renderEditRecipe, bindEditRecipe } from './views/editRecipe.js?v=20260521-no-situation-v1';
import { renderMembers, bindMembers } from './views/members.js';
import { renderSettings, bindSettings } from './views/settings.js?v=20260521-icons-v1';
import { renderAccount, bindAccount } from './views/account.js';
import { renderSearch, bindSearch } from './views/search.js?v=20260521-search-v3';
import { renderFridge, bindFridge } from './views/fridge.js?v=20260521-fridge-v5';
import { icon } from './icons.js';

const app = document.querySelector('#app');
let activeRoute = currentRoute();

function navigate(path) {
  go(path);
}

function nav(active) {
  return `
    <div class="app-bottom">
      <nav class="nav-row nav-5">
        <a href="#/home"     class="${active === 'home'     ? 'is-active' : ''}"><span class="ic">${icon('home')}</span><span>홈</span></a>
        <a href="#/search"   class="${active === 'search'   ? 'is-active' : ''}"><span class="ic">${icon('search')}</span><span>검색</span></a>
        <a href="#/analyze"  class="fab"><span class="ic">${icon('plus', 22)}</span></a>
        <a href="#/fridge"   class="${active === 'fridge'   ? 'is-active' : ''}"><span class="ic">${icon('fridge')}</span><span>냉장고</span></a>
        <a href="#/settings" class="${active === 'settings' ? 'is-active' : ''}"><span class="ic">${icon('settings')}</span><span>설정</span></a>
      </nav>
    </div>
  `;
}

function resolveView(route) {
  if (route.path === 'analyze') return [renderAnalyze(), (root) => bindAnalyze(root, navigate)];
  if (route.path === 'search')  return [renderSearch(),  (root) => bindSearch(root, navigate)];
  if (route.path === 'fridge')  return [renderFridge(),  (root) => bindFridge(root, navigate)];
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
  if (route.path === 'members')  return [renderMembers(),  (root) => bindMembers(root)];
  if (route.path === 'settings') return [renderSettings(), (root) => bindSettings(root, navigate)];
  if (route.path === 'account')  return [renderAccount(),  (root) => bindAccount(root, navigate)];
  return [renderHome(), (root) => bindHome(root, navigate)];
}

async function render(route = currentRoute()) {
  activeRoute = route;
  const [viewOrPromise, bind] = resolveView(route);
  const view = await viewOrPromise;
  app.innerHTML = `
    ${view.hideHeader ? '' : `<header class="app-header">${view.header}</header>`}
    <main class="app-body ${view.flush ? 'is-flush' : ''}">${view.body}</main>
    ${view.showNav ? nav(view.activeNav) : ''}
  `;
  bind(app);
}

onRouteChange(render);
subscribe(() => render(activeRoute));
render();
