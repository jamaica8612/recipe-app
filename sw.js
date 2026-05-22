// 매우 단순한 서비스 워커 — 정적 자산을 캐시 우선 전략(stale-while-revalidate)으로 제공.
// 네트워크 요청(Supabase 등)은 그대로 통과.

const CACHE = 'recipe-app-v10';
const STATIC_ASSETS = [
  './app.html',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
  './src/app.js',
  './src/router.js',
  './src/store.js',
  './src/util.js',
  './src/data.js',
  './src/config.js',
  './src/supabaseClient.js',
  './src/icons.js',
  './src/ingredientMatch.js',
  './src/api/analyzeVideo.js',
  './src/api/askRecipe.js',
  './src/api/suggestRecipes.js',
  './src/api/syncSupabase.js',
  './src/views/home.js',
  './src/views/analyze.js',
  './src/views/preview.js',
  './src/views/detail.js',
  './src/views/cook.js',
  './src/views/editRecipe.js',
  './src/views/search.js',
  './src/views/fridge.js',
  './src/views/members.js',
  './src/views/settings.js',
  './src/views/account.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 외부 도메인(Supabase, YouTube 썸네일 등)은 그냥 네트워크
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(request).then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
      }
      return response;
    }).catch(() =>
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return response;
        });
      })
    )
  );
});
