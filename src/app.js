import { currentRoute, onRouteChange, go } from './router.js';
import { subscribe } from './store.js';
import { renderHome, bindHome } from './views/home.js';
import { renderAnalyze, bindAnalyze } from './views/analyze.js';
import { renderPreview, bindPreview } from './views/preview.js';
import { renderDetail, bindDetail } from './views/detail.js';
import { renderEditRecipe, bindEditRecipe } from './views/editRecipe.js';
import { renderMembers, bindMembers } from './views/members.js';
import { renderSettings, bindSettings } from './views/settings.js';
import { renderAccount, bindAccount } from './views/account.js';

const app = document.querySelector('#app');
let activeRoute = currentRoute();

function navigate(path) {
  go(path);
}

function nav(active) {
  return `
    <div class="app-bottom">
      <nav class="nav-row">
        <a href="#/home" class="${active === 'home' ? 'is-active' : ''}"><span class="ic">⌂</span><span>홈</span></a>
        <a href="#/analyze" class="fab"><span class="ic">＋</span></a>
        <a href="#/members" class="${active === 'members' ? 'is-active' : ''}"><span class="ic">👤</span><span>구성원</span></a>
      </nav>
    </div>
  `;
}

function resolveView(route) {
  if (route.path === 'analyze') return [renderAnalyze(), (root) => bindAnalyze(root, navigate)];
  if (route.path === 'preview') {
    const draftId = route.params[0];
    return [renderPreview(draftId), (root) => bindPreview(root, navigate, draftId)];
  }
  if (route.path === 'recipe') {
    const recipeId = route.params[0];
    return [renderDetail(recipeId), (root) => bindDetail(root, navigate, recipeId)];
  }
  if (route.path === 'edit') {
    const recipeId = route.params[0];
    return [renderEditRecipe(recipeId), (root) => bindEditRecipe(root, navigate, recipeId)];
  }
  if (route.path === 'members') return [renderMembers(), (root) => bindMembers(root)];
  if (route.path === 'settings') return [renderSettings(), (root) => bindSettings(root)];
  if (route.path === 'account') return [renderAccount(), (root) => bindAccount(root, navigate)];
  return [renderHome(), (root) => bindHome(root, navigate)];
}

async function render(route = currentRoute()) {
  activeRoute = route;
  const [viewOrPromise, bind] = resolveView(route);
  const view = await viewOrPromise;
  app.innerHTML = `
    <header class="app-header">${view.header}</header>
    <main class="app-body ${view.flush ? 'is-flush' : ''}">${view.body}</main>
    ${view.showNav ? nav(view.activeNav) : ''}
  `;
  bind(app);
}

onRouteChange(render);
subscribe(() => render(activeRoute));
render();
