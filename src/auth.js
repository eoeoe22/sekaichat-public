import { generateSalt, hashPassword, verifyPassword, logError, logDebug, createJwt, getAuth } from './utils.js';

export const handleAuth = {
  async discord(request, env) {
    const url = new URL('https://discord.com/api/oauth2/authorize');
    url.searchParams.append('client_id', env.DISCORD_CLIENT_ID);
    url.searchParams.append('redirect_uri', env.DISCORD_REDIRECT_URI);
    url.searchParams.append('response_type', 'code');
    url.searchParams.append('scope', 'identify email');
    return Response.redirect(url.toString(), 302);
  },

  async discordCallback(request, env) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');

    if (!code) {
      return new Response('Code not found', { status: 400 });
    }

    try {
      const accessToken = await getDiscordAccessToken(code, env);
      const discordUser = await getDiscordUser(accessToken, env);

      let user = await env.DB.prepare('SELECT * FROM users WHERE discord_id = ?').bind(discordUser.id).first();

      if (!user) {
        const auth = await getAuth(request, env);
        if (auth && auth.userId) {
          await env.DB.prepare('UPDATE users SET discord_id = ?, discord_username = ?, discord_avatar = ? WHERE id = ?')
            .bind(discordUser.id, discordUser.username, discordUser.avatar, auth.userId).run();
          user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(auth.userId).first();
        } else {
          const salt = generateSalt();
          const randomPassword = Math.random().toString(36).slice(-8);
          const passwordHash = await hashPassword(randomPassword, salt);
          const username = discordUser.email;
          const nickname = discordUser.username;

          const existingUser = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
          if (existingUser) {
            return new Response('Username already exists', { status: 409 });
          }

          const result = await env.DB.prepare(
            'INSERT INTO users (username, password_hash, salt, nickname, discord_id, discord_username, discord_avatar) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(username, passwordHash, salt, nickname, discordUser.id, discordUser.username, discordUser.avatar).run();
          
          user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(result.meta.last_row_id).first();
        }
      } else {
        // 이미 연동된 사용자의 경우, 사용자명과 아바타 정보 업데이트
        await env.DB.prepare('UPDATE users SET discord_username = ?, discord_avatar = ? WHERE id = ?')
          .bind(discordUser.username, discordUser.avatar, user.id).run();
      }

      const token = await createJwt({ 
        userId: user.id, 
        exp: Date.now() + (24 * 60 * 60 * 1000),
        iat: Date.now()
      }, env);

      const responseUrl = new URL(request.url);
      const referer = request.headers.get('referer');
      const redirectPath = referer && new URL(referer).pathname === '/settings' ? '/settings' : '/main.html';
      
      const response = new Response(null, {
        status: 302,
        headers: {
          'Location': redirectPath
        }
      });

      const cookieOptions = [
        `token=${token}`,
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=86400',
        'Path=/'
      ];
      
      if (!responseUrl.hostname.includes('localhost') && 
          !responseUrl.hostname.includes('127.0.0.1') && 
          !responseUrl.hostname.includes('.local')) {
        cookieOptions.push(`Domain=${responseUrl.hostname}`);
      }
      
      const isSecure = responseUrl.protocol === 'https:';
      if (isSecure) {
        cookieOptions.push('Secure');
      }
      
      response.headers.set('Set-Cookie', cookieOptions.join('; '));
      return response;

    } catch (error) {
      await logError(error, env, 'Discord OAuth Callback');
      return new Response('Internal Server Error', { status: 500 });
    }
  },

  async login(request, env) {
    try {
      const formData = await request.formData();
      const username = formData.get('username');
      const password = formData.get('password');
      const turnstileToken = formData.get('cf-turnstile-response');
      
      logDebug('로그인 시도', 'Auth Login', { username });
      
      // Turnstile 검증
      const turnstileValid = await verifyTurnstile(turnstileToken, env);
      if (!turnstileValid) {
        logDebug('Turnstile 검증 실패', 'Auth Login');
        return new Response('으....이....', { status: 400 });
      }
      
      // 사용자 조회
      const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?')
        .bind(username).first();
      
      if (!user || !(await verifyPassword(password, user.password_hash, user.salt))) {
        logDebug('사용자 인증 실패', 'Auth Login');
        return new Response('으....이....', { status: 401 });
      }
      
      // JWT 토큰 생성
      const token = await createJwt({ 
        userId: user.id, 
        exp: Date.now() + (24 * 60 * 60 * 1000),
        iat: Date.now()
      }, env);
      
      logDebug('토큰 생성 완료', 'Auth Login', { userId: user.id });
      
      const url = new URL(request.url);
      const isSecure = url.protocol === 'https:';
      
      const response = new Response(JSON.stringify({ success: true }), {
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
      
      // 쿠키 설정
      const cookieOptions = [
        `token=${token}`,
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=86400',
        'Path=/'
      ];
      
      if (!url.hostname.includes('localhost') && 
          !url.hostname.includes('127.0.0.1') && 
          !url.hostname.includes('.local')) {
        cookieOptions.push(`Domain=${url.hostname}`);
      }
      
      if (isSecure) {
        cookieOptions.push('Secure');
      }
      
      response.headers.set('Set-Cookie', cookieOptions.join('; '));
      return response;
    } catch (error) {
      await logError(error, env, 'Auth Login');
      return new Response('으....이....', { status: 500 });
    }
  },
  
  async register(request, env) {
    try {
      const formData = await request.formData();
      const username = formData.get('username');
      const password = formData.get('password');
      const nickname = formData.get('nickname');
      const geminiApiKey = formData.get('gemini_api_key') || null;
      const turnstileToken = formData.get('cf-turnstile-response');
      
      // Turnstile 검증
      const turnstileValid = await verifyTurnstile(turnstileToken, env);
      if (!turnstileValid) {
        return new Response('으....이....', { status: 400 });
      }
      
      // 중복 사용자 확인
      const existingUser = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
        .bind(username).first();
      
      if (existingUser) {
        return new Response('으....이....', { status: 409 });
      }
      
      // 비밀번호 해싱
      const salt = generateSalt();
      const passwordHash = await hashPassword(password, salt);
      
      // 사용자 생성
      await env.DB.prepare(
        'INSERT INTO users (username, nickname, password_hash, salt, gemini_api_key) VALUES (?, ?, ?, ?, ?)'
      ).bind(username, nickname, passwordHash, salt, geminiApiKey).run();
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Auth Register');
      return new Response('으....이....', { status: 500 });
    }
  },
  
  async logout(request, env) {
    const url = new URL(request.url);
    const isSecure = url.protocol === 'https:';
    
    const response = new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
    const cookieOptions = [
      'token=',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=0',
      'Path=/'
    ];
    
    if (!url.hostname.includes('localhost') && 
        !url.hostname.includes('127.0.0.1') && 
        !url.hostname.includes('.local')) {
      cookieOptions.push(`Domain=${url.hostname}`);
    }
    
    if (isSecure) {
      cookieOptions.push('Secure');
    }
    
    response.headers.set('Set-Cookie', cookieOptions.join('; '));
    return response;
  }
};

export async function updateProfileImage(userId, request, env) {
    try {
        const user = await env.DB.prepare('SELECT profile_image FROM users WHERE id = ?').bind(userId).first();
        if (!user) {
            return new Response('User not found', { status: 404 });
        }

        // DELETE request
        if (request.method === 'DELETE') {
            if (user.profile_image) {
                await env.R2.delete(user.profile_image);
            }
            await env.DB.prepare('UPDATE users SET profile_image = NULL, profile_image_visible = 0 WHERE id = ?')
                .bind(userId)
                .run();
            return new Response('Profile image deleted', { status: 200 });
        }

        // POST request
        const formData = await request.formData();
        const file = formData.get('profileImage');
        const visible = formData.get('visible') === 'true';

        let imageKey = user.profile_image;

        if (file) {
            // Validate file type and size
            const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
            if (!allowedTypes.includes(file.type)) {
                return new Response('Invalid file type', { status: 400 });
            }
            if (file.size > 2 * 1024 * 1024) { // 2MB
                return new Response('File size exceeds 2MB', { status: 400 });
            }

            // Delete old image if it exists
            if (user.profile_image) {
                await env.R2.delete(user.profile_image);
            }

            // Upload new image
            const ext = file.name.split('.').pop();
            imageKey = `profile_images/${userId}-${Date.now()}.${ext}`;
            await env.R2.put(imageKey, await file.arrayBuffer(), {
                httpMetadata: { contentType: file.type },
            });
        }

        // Update database
        await env.DB.prepare('UPDATE users SET profile_image = ?, profile_image_visible = ? WHERE id = ?')
            .bind(imageKey, visible, userId)
            .run();

        return new Response(JSON.stringify({ success: true, imageKey, visible }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Profile image update error:', error);
        await logError(error, env, 'UpdateProfileImage');
        return new Response('Internal server error', { status: 500 });
    }
}

async function verifyTurnstile(token, env) {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token
      })
    });
    
    const result = await response.json();
    return result.success;
  } catch {
    return false;
  }
}

async function getDiscordAccessToken(code, env) {
  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: env.DISCORD_REDIRECT_URI,
    }),
  });

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Failed to retrieve access token');
  }
  return data.access_token;
}

async function getDiscordUser(accessToken, env) {
  const response = await fetch('https://discord.com/api/users/@me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  return data;
}
