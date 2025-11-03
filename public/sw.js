// 서비스 워커 버전
const CACHE_VERSION = 'sekai-chat-v1';
const CACHE_NAME = `sekai-chat-cache-${CACHE_VERSION}`;

// 캐시할 리소스들
const STATIC_CACHE_URLS = [
  '/login',
  '/login.html',
  '/main.html',
  '/css/style.css',
  '/js/login.js',
  '/manifest.json'
];

// 설치 이벤트
self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static resources');
        return cache.addAll(STATIC_CACHE_URLS);
      })
      .catch((error) => {
        console.error('[SW] Cache install failed:', error);
      })
  );
  // 새로운 서비스 워커가 즉시 활성화되도록 함
  self.skipWaiting();
});

// 활성화 이벤트
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // 이전 버전의 캐시 삭제
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // 모든 클라이언트에서 새로운 서비스 워커를 즉시 사용
  self.clients.claim();
});

// 페치 이벤트 (네트워크 요청 가로채기)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // API 요청은 브라우저가 직접 처리하도록 하여 쿠키 문제를 해결합니다.
  if (request.url.includes('/api/')) {
    // 아무것도 하지 않고 브라우저의 기본 fetch 핸들러에 맡깁니다.
    return;
  }

  // 정적 리소스에 대한 캐시 우선 전략
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          console.log('[SW] Serving from cache:', request.url);
          return cachedResponse;
        }
        
        // 캐시에 없으면 네트워크에서 가져오기
        return fetch(request)
          .then((networkResponse) => {
            // 응답이 유효한 경우 캐시에 저장
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(request, responseClone);
                });
            }
            return networkResponse;
          })
          .catch(() => {
            console.log('[SW] Network failed for:', request.url);
            // 오프라인 상태에서의 폴백 처리
            if (request.destination === 'document') {
              return caches.match('/login.html');
            }
            return new Response('오프라인 상태입니다.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          });
      })
  );
});

// 푸시 알림 처리 (향후 확장용)
self.addEventListener('push', (event) => {
  console.log('[SW] Push event received');
  // 푸시 알림 기능은 필요시 구현
});

// 백그라운드 동기화 처리 (향후 확장용)
self.addEventListener('sync', (event) => {
  console.log('[SW] Sync event received');
  // 백그라운드 동기화 기능은 필요시 구현
});