import { logError, getAuth } from '../utils.js';

export async function handlePages(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const update_token = env.update_token || '1';

  if (path === '/') {
    const newUrl = new URL('/login', url.origin);
    return Response.redirect(newUrl.toString(), 302);
  }

  if (path === '/login' || path === '/register') {
    try {
      const auth = await getAuth(request, env);
      if (auth && auth.userId) {
        return Response.redirect(new URL('/main', url.origin).toString(), 302);
      }
    } catch (error) {
      await logError(error, env, 'Auth Check for Login/Register Pages');
    }
  }

  const pageMap = {
    '/home': '/main.html',
    '/chat': '/chat.html',
    '/login': '/login.html',
    '/register': '/register.html',
    '/settings': '/settings.html',
    '/characterinfo': '/characterinfo.html',
    '/autorag': '/autorag.html',
    '/autorag-vocaloid': '/autorag-vocaloid.html',
  };

  const cleanPath = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
  const filePath = pageMap[cleanPath];

  if (filePath) {
    const asset = await env.ASSETS.fetch(new URL(filePath, url.origin));
    let content = await asset.text();
    content = content.replace(/(href|src)="(.*?)\.(css|js)"/g, `$1="$2_${update_token}.$3"`);

    return new Response(content, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'max-age=60'
      },
    });
  }

  if (path === '/manifest.json' || path === '/sw.js') {
    return env.ASSETS.fetch(request);
  }

  const staticMatch = path.match(/^(.*?)_(\d+)\.(css|js)$/);
  if (staticMatch) {
    const originalPath = `${staticMatch[1]}.${staticMatch[3]}`;
    return env.ASSETS.fetch(new URL(originalPath, url.origin));
  }

  return env.ASSETS.fetch(request);
}
