// 매우 단순한 hash 라우터
// 라우트 예: #/home, #/analyze, #/recipe/r1, #/members

const listeners = new Set();

function parse() {
  const hash = location.hash.slice(1) || '/home';
  const [path, ...rest] = hash.split('/').filter(Boolean);
  // path = 'home' | 'analyze' | 'recipe' | 'members'
  return { path: path || 'home', params: rest };
}

window.addEventListener('hashchange', () => {
  const route = parse();
  for (const fn of listeners) fn(route);
});

export function currentRoute() { return parse(); }

export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function go(path) {
  if (location.hash === '#' + path || location.hash.slice(1) === path) {
    const route = parse();
    for (const fn of listeners) fn(route);
    return;
  }
  location.hash = path;
}

export function back() {
  history.back();
}
