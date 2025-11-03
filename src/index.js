// ================================================================
// FILE: src/index.js (정리된 전체 내용)
// ================================================================
import { handleAuth, updateProfileImage } from './auth.js';
import { handleChat,
         handleCharacterGeneration,
         handleAutoReply,
         handleSelectSpeaker }                  from './gemini.js';
import { handleCharacters }                from './characters.js';
import { handleConversationParticipants }  from './conversations.js';
import { handleUserCharacters,
         uploadCharacterImage,
         getExtendedCharacterList,
         serveUserCharacterImage }         from './user-characters.js';
import { handleMigration }                 from './migration.js';

import { handleTTS, handleTTSTranslation, handleTTSTest, handleTTSDebug }                       from './tts.js';
import { logError, verifyJwt, generateSalt, hashPassword, verifyPassword, getAuth, getUserFromRequest } from './utils.js';

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // 301 Redirect to primary domain if DOMAIN is set and host does not match
      // Skip redirect for localhost development
      if (env.DOMAIN && url.hostname !== env.DOMAIN && !url.hostname.includes('localhost')) {
        const newUrl = new URL(request.url);
        newUrl.hostname = env.DOMAIN;
        return Response.redirect(newUrl.toString(), 301);
      }

      const path = url.pathname;

      if (path.startsWith('/api/')) {
        return handleAPI(request, env, path);
      }

      if (path.startsWith('/auth/')) {
        if (path === '/auth/discord') {
          return handleAuth.discord(request, env);
        }
        if (path === '/auth/discord/callback') {
          return handleAuth.discordCallback(request, env);
        }
      }

      // --- [수정] --- API가 아닌 모든 요청은 handlePages로 전달
      return handlePages(request, env);
    } catch (error) {
      await logError(error, env, 'Main Router');
      return new Response(error.stack || error, { status: 500 });
    }
  }
};

// ... handleAPI 함수는 이전과 동일하게 유지 ...
async function handleAPI(request, env, path) {
  const method = request.method;

  // 1. Exact path matching first
  const routes = {
    '/api/auth/login': { POST: handleAuth.login },
    '/api/auth/register': { POST: handleAuth.register },
    '/api/auth/logout': { POST: handleAuth.logout },
    '/api/auth/status': { GET: checkAuthStatus },
    '/api/chat': { POST: handleChat },
    '/api/chat/generate': { POST: handleCharacterGeneration },
    '/api/chat/auto-reply': { POST: handleAutoReply },
    '/api/chat/auto-reply/select-speaker': { POST: handleSelectSpeaker },
    '/api/image-generation': { POST: handleImageGeneration },
    '/api/characters': { GET: handleCharacters.getAll },
    '/api/characters/info': { GET: getCharacterInfo },
    '/api/characters/extended': { GET: getExtendedCharacterList },
    '/api/user/characters': { GET: handleUserCharacters.getAll, POST: handleUserCharacters.create },
    '/api/upload/character-image': { POST: uploadCharacterImage },
    '/api/upload/direct': { POST: handleDirectUpload },
    '/api/user/info': { GET: getUserInfo },
    '/api/user/update': { POST: handleUserUpdate },
    '/api/user/profile-image': { POST: handleProfileImageUpdate, DELETE: handleProfileImageUpdate },
    '/api/user/sekai-preferences': { GET: getSekaiPreferences, POST: updateSekaiPreferences },
    '/api/conversations': { GET: handleConversations, POST: createConversation },
    '/api/migration/kanade-login': { POST: handleMigration.kanadeLogin },
    '/api/migration/kanade-conversations': { GET: handleMigration.getKanadeConversations },
    '/api/migration/start': { POST: handleMigration.startMigration },
    '/api/notice': { GET: getNotice },

    '/api/conversations/autorag-memory': { POST: toggleAutoragMemory },
    '/api/tts': { POST: handleTTS },
    '/api/tts/translate': { POST: handleTTSTranslation },
    '/api/tts/test': { POST: handleTTSTest },
    '/api/tts/debug': { GET: handleTTSDebug },
    '/api/autorag/preview': { POST: handleAutoragPreview },
    '/api/autorag/status': { GET: handleAutoragStatus },
  };

  if (routes[path] && routes[path][method]) {
    return routes[path][method](request, env);
  }

  if (path.startsWith('/r2/')) {
    const key = path.substring(4); // Remove /r2/
    const object = await env.R2.get(key);

    if (object === null) {
      return new Response('Object Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);

    return new Response(object.body, {
      headers,
    });
  }

  // 2. Regex path matching
  let match;

  if ((match = path.match(/^\/api\/conversations\/(\d+)$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'GET') return getConversationMessages(request, env, conversationId);
    if (method === 'DELETE') return deleteConversation(request, env, conversationId);
  }
  if ((match = path.match(/^\/api\/messages\/(\d+)$/))) {
    const messageId = parseInt(match[1]);
    if (method === 'DELETE') return deleteMessage(request, env, messageId);
  }
  if ((match = path.match(/^\/api\/conversations\/(\d+)\/favorite$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'POST') return toggleConversationFavorite(request, env, conversationId);
  }
  if ((match = path.match(/^\/api\/conversations\/(\d+)\/title$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'POST') return updateConversationTitle(request, env, conversationId);
  }
  if ((match = path.match(/^\/api\/conversations\/(\d+)\/work-mode$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'POST') return updateWorkMode(request, env, conversationId);
  }
  if ((match = path.match(/^\/api\/conversations\/(\d+)\/show-time$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'POST') return updateShowTime(request, env, conversationId);
  }
  if ((match = path.match(/^\/api\/conversations\/(\d+)\/situation-prompt$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'POST') return updateSituationPrompt(request, env, conversationId);
  }
  if ((match = path.match(/^\/api\/conversations\/(\d+)\/auto-reply-mode$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'POST') return updateAutoReplyMode(request, env, conversationId);
  }
  if ((match = path.match(/^\/api\/conversations\/(\d+)\/invite$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'POST') return handleConversationParticipants.inviteCharacter(request, env, conversationId);
  }
  if ((match = path.match(/^\/api\/conversations\/(\d+)\/participants$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'GET') return handleConversationParticipants.getParticipants(request, env, conversationId);
  }

  if ((match = path.match(/^\/api\/user\/characters\/(\d+)$/))) {
    const characterId = parseInt(match[1]);
    if (method === 'PUT') return handleUserCharacters.update(request, env, characterId);
    if (method === 'DELETE') return handleUserCharacters.delete(request, env, characterId);
  }
  if ((match = path.match(/^\/api\/user\/characters\/(\d+)\/request-public$/))) {
    const characterId = parseInt(match[1]);
    if (method === 'POST') return handleUserCharacters.requestPublic(request, env, characterId);
  }
  if (method === 'GET' && (match = path.match(/^\/api\/user-characters\/image\/(.+)$/))) {
      return serveUserCharacterImage(request, env, match[1]);
  }
  if ((match = path.match(/^\/api\/migration\/kanade-conversation-preview\/(\d+)$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'GET') return handleMigration.getKanadeConversationPreview(request, env, { id: conversationId });
  }
  if ((match = path.match(/^\/api\/characters\/(\d+)$/))) {
    const characterId = parseInt(match[1]);
    if (method === 'GET') return handleCharacters.getById(request, env, characterId);
  }
  if ((match = path.match(/^\/api\/images\/(.+)$/))) {
    const fileName = match[1];
    if (method === 'GET') return serveImage(request, env, fileName);
  }

  return new Response('Not Found', { status: 405 });
}


// --- [수정된 부분 시작] ---
async function handlePages(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 루트 경로는 /login으로 리다이렉트 (PWA 시작페이지)
    if (path === '/') {
        const newUrl = new URL('/login', url.origin);
        return Response.redirect(newUrl.toString(), 302);
    }

    // 로그인/회원가입 페이지에 대한 서버사이드 인증 상태 확인
    if (path === '/login' || path === '/register') {
        try {
            const auth = await getAuth(request, env);
            if (auth && auth.userId) {
                // 이미 로그인된 상태라면 메인 페이지로 서버사이드 리디렉트
                return Response.redirect(new URL('/main', url.origin).toString(), 302);
            }
        } catch (error) {
            // 인증 확인 실패 시에는 페이지를 정상적으로 로드
            await logError(error, env, 'Auth Check for Login/Register Pages');
        }
    }

    // "깔끔한 URL"을 실제 .html 파일로 매핑
    const pageMap = {
        '/home': '/main.html',
        '/chat': '/chat.html',
        '/login': '/login.html',
        '/register': '/register.html',
        '/settings': '/settings.html',
        '/characterinfo': '/characterinfo.html',
        '/autorag': '/autorag.html',
        // '/dating/chat'은 이제 실제 파일이 아니므로 여기서 처리할 필요 없음
    };

    const cleanPath = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;

    if (pageMap[cleanPath]) {
        const newUrl = new URL(pageMap[cleanPath], url.origin);

        // Cloudflare Workers가 assets 설정으로 자동으로 정적 파일을 서빙하도록 리다이렉트
        return Response.redirect(newUrl.toString(), 302);
    }

    // PWA 파일 처리
    if (path === '/manifest.json' || path === '/sw.js') {
        // Cloudflare Workers의 자동 에셋 서빙에 위임
        return env.ASSETS.fetch(request);
    }

    // 매핑되지 않은 일반 정적 파일들은 Cloudflare Workers의 자동 에셋 서빙에 위임
    return env.ASSETS.fetch(request);
}
// --- [수정된 부분 끝] ---

// ... (이하 모든 기존 헬퍼 함수들은 그대로 유지) ...
// ... (getLandingPage, checkAuthStatus 등) ...
// ... (이하 모든 기존 함수 코드들) ...
//시간 정보 토글 함수
async function updateShowTime(request, env, conversationId) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 대화방 소유권 확인
    const conversation = await env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) {
      return new Response('Not Found', { status: 404 });
    }

    const { showTime } = await request.json();

    await env.DB.prepare(
      'UPDATE conversations SET show_time_info = ? WHERE id = ?'
    ).bind(showTime ? 1 : 0, conversationId).run();

    return new Response(JSON.stringify({
      success: true,
      show_time_info: showTime ? 1 : 0
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Update Show Time');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 🔧 새로 추가: 상황 프롬프트 업데이트 함수
async function updateSituationPrompt(request, env, conversationId) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 대화방 소유권 확인
    const conversation = await env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) {
      return new Response('Not Found', { status: 404 });
    }

    const { situationPrompt } = await request.json();
    const trimmedPrompt = situationPrompt ? situationPrompt.trim().substring(0, 10000) : ''; // 최대 10000자

    await env.DB.prepare(
      'UPDATE conversations SET situation_prompt = ? WHERE id = ?'
    ).bind(trimmedPrompt, conversationId).run();

    return new Response(JSON.stringify({
      success: true,
      situation_prompt: trimmedPrompt
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Update Situation Prompt');
    return new Response('Internal Server Error', { status: 500 });
  }
}

async function updateAutoReplyMode(request, env, conversationId) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const conversation = await env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) {
      return new Response('Not Found', { status: 404 });
    }

    const { autoReplyMode } = await request.json();

    await env.DB.prepare(
      'UPDATE conversations SET auto_reply_mode_enabled = ? WHERE id = ?'
    ).bind(autoReplyMode ? 1 : 0, conversationId).run();

    return new Response(JSON.stringify({
      success: true,
      auto_reply_mode_enabled: autoReplyMode ? 1 : 0
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Update Auto Reply Mode');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 🔧 새로 추가: 메시지 삭제 함수
async function deleteMessage(request, env, messageId) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 메시지 소유권 확인
    const message = await env.DB.prepare(`
      SELECT m.*, c.user_id
      FROM messages m
      LEFT JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ?
    `).bind(messageId).first();

    if (!message) {
      return new Response('메시지를 찾을 수 없습니다.', { status: 404 });
    }

    if (message.user_id !== user.id) {
      return new Response('Forbidden', { status: 403 });
    }

    // 이미지 파일이 있는 경우 R2에서도 삭제
    if (message.message_type === 'image' && message.file_id) {
      try {
        // 파일 정보 조회
        const fileInfo = await env.DB.prepare('SELECT r2_key FROM files WHERE id = ?')
          .bind(message.file_id).first();

        if (fileInfo && fileInfo.r2_key) {
          // R2에서 파일 삭제
            await env.R2.delete(fileInfo.r2_key);

          // 파일 레코드 삭제
          await env.DB.prepare('DELETE FROM files WHERE id = ?')
            .bind(message.file_id).run();
        }
      } catch (r2Error) {
        console.error('R2 파일 삭제 실패:', r2Error);
        // R2 삭제 실패해도 메시지는 삭제 진행
      }
    }

    // 메시지 삭제
    await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(messageId).run();

    // 대화 캐시 무효화
    const cacheKey = `chat_history:${message.conversation_id}`;
    await env.KV.delete(cacheKey);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Delete Message');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 캐릭터 상세 정보 조회 함수
async function getCharacterInfo(request, env) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, name, nickname, profile_image, system_prompt, first_name_jp FROM characters ORDER BY id ASC'
    ).all();

    return new Response(JSON.stringify(results || []), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    await logError(error, env, 'Get Character Info');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 사용자 인증 확인 함수
async function checkAuthStatus(request, env) {
  try {
    const auth = await getAuth(request, env);
    const isAuthenticated = auth && auth.userId;

    return new Response(JSON.stringify({
      authenticated: !!isAuthenticated,
      userId: isAuthenticated ? auth.userId : null
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  } catch (error) {
    await logError(error, env, 'Check Auth Status');
    return new Response(JSON.stringify({ authenticated: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 사용자 정보 조회
// API 키 형식 검증 함수
function validateGeminiApiKeyFormat(apiKey) {
  if (!apiKey) return { isValid: true, reason: null }; // API 키가 없으면 검증 스킵

  // 올바른 형식: "AIzaSY"로 시작, 총 39자, 알파벳 대소문자, 숫자, 하이픈(-), 언더스코어(_) 허용
  const apiKeyPattern = /^AIzaSy[A-Za-z0-9-_]{33}$/;

  if (!apiKey.startsWith('AIzaSy')) {
    return { isValid: false, reason: 'API 키는 "AIzaSy"로 시작해야 합니다.' };
  }

  if (apiKey.length !== 39) {
    return { isValid: false, reason: `API 키는 39자여야 합니다. (현재 ${apiKey.length}자)` };
  }

  if (!apiKeyPattern.test(apiKey)) {
    return { isValid: false, reason: 'API 키는 알파벳 대소문자, 숫자, 하이픈(-), 언더스코어(_)로만 구성되어야 합니다.' };
  }

  return { isValid: true, reason: null };
}

async function getUserInfo(request, env) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // API 키 형식 검증
    const apiKeyValidation = validateGeminiApiKeyFormat(user.gemini_api_key);

    const userInfo = {
      username: user.username,
      nickname: user.nickname,
      self_introduction: user.self_introduction,
      max_auto_call_sequence: user.max_auto_call_sequence || 3,
      has_api_key: !!user.gemini_api_key,
      api_key_valid: apiKeyValidation.isValid,
      api_key_error: apiKeyValidation.reason,
      discord_id: user.discord_id,
      discord_username: user.discord_username,
      discord_avatar: user.discord_avatar,
      profile_image: user.profile_image,
      profile_image_visible: user.profile_image_visible
    };

    return new Response(JSON.stringify(userInfo), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Get User Info');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 사용자 설정 업데이트
async function handleUserUpdate(request, env) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { type, ...data } = await request.json();

    switch (type) {
      case 'password':
        const { current_password, new_password } = data;
        const isValidPassword = await verifyPassword(current_password, user.password_hash, user.salt);

        if (!isValidPassword) {
          return new Response('Invalid current password', { status: 400 });
        }

        const salt = generateSalt();
        const passwordHash = await hashPassword(new_password, salt);

        await env.DB.prepare(
          'UPDATE users SET password_hash = ?, salt = ? WHERE id = ?'
        ).bind(passwordHash, salt, user.id).run();
        break;

      case 'nickname':
        const { new_nickname } = data;
        await env.DB.prepare(
          'UPDATE users SET nickname = ? WHERE id = ?'
        ).bind(new_nickname, user.id).run();
        break;

      case 'api_key':
        const { api_key } = data;

        // API 키 형식 검증
        const apiKeyValidation = validateGeminiApiKeyFormat(api_key);
        if (!apiKeyValidation.isValid) {
          return new Response(apiKeyValidation.reason, { status: 400 });
        }

        await env.DB.prepare(
          'UPDATE users SET gemini_api_key = ? WHERE id = ?'
        ).bind(api_key, user.id).run();
        break;

      case 'delete_api_key':
        await env.DB.prepare(
          'UPDATE users SET gemini_api_key = NULL WHERE id = ?'
        ).bind(user.id).run();
        break;

      case 'self_introduction':
        const { self_introduction } = data;
        await env.DB.prepare(
          'UPDATE users SET self_introduction = ? WHERE id = ?'
        ).bind(self_introduction, user.id).run();
        break;

      case 'max_auto_call_sequence':
        const { max_auto_call_sequence } = data;
        await env.DB.prepare(
          'UPDATE users SET max_auto_call_sequence = ? WHERE id = ?'
        ).bind(max_auto_call_sequence, user.id).run();
        break;

      case 'unlink_discord':
        await env.DB.prepare(
          'UPDATE users SET discord_id = NULL, discord_username = NULL, discord_avatar = NULL WHERE id = ?'
        ).bind(user.id).run();
        break;

      case 'tts_language_preference':
        const { tts_language_preference } = data;
        if (!['kr', 'jp'].includes(tts_language_preference)) {
          return new Response('잘못된 TTS 언어 설정입니다', { status: 400 });
        }
        await env.DB.prepare(
          'UPDATE users SET tts_language_preference = ? WHERE id = ?'
        ).bind(tts_language_preference, user.id).run();
        break;

      default:
        return new Response('지원하지 않는 업데이트 유형입니다', { status: 400 });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Handle User Update');
    return new Response('Internal Server Error', { status: 500 });
  }
}

async function handleProfileImageUpdate(request, env) {
    const user = await getUserFromRequest(request, env);
    if (!user) {
        return new Response('Unauthorized', { status: 401 });
    }
    // The new updateProfileImage function from auth.js will handle both POST and DELETE
    return updateProfileImage(user.id, request, env);
}

async function getSekaiPreferences(request, env) {
    try {
        const user = await getUserFromRequest(request, env);
        if (!user) {
            return new Response('Unauthorized', { status: 401 });
        }

        // 1. Get all sekai from the new sekai table
        const { results: allSekai } = await env.DB.prepare(
            'SELECT name, description, image_path FROM sekai'
        ).all();

        // 2. Get user preferences
        const { results: userPrefs } = await env.DB.prepare(
            'SELECT sekai, visible FROM user_sekai_preferences WHERE user_id = ?'
        ).bind(user.id).all();

        const userPrefsMap = new Map(userPrefs.map(p => [p.sekai, p.visible]));

        // 3. Combine and apply default logic
        const sekaiWithPrefs = allSekai.map(s => {
            const userPreference = userPrefsMap.get(s.name);
            let visible;

            if (userPreference !== undefined) {
                visible = userPreference;
            } else {
                // Default logic
                visible = (s.name === '프로젝트 세카이' || s.name === 'Google') ? 1 : 0;
            }

            return {
                sekai: s.name,
                description: s.description,
                image_path: s.image_path,
                visible: visible
            };
        });

        return new Response(JSON.stringify(sekaiWithPrefs), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        await logError(error, env, 'Get Sekai Preferences');
        return new Response('Internal Server Error', { status: 500 });
    }
}

async function updateSekaiPreferences(request, env) {
    try {
        const user = await getUserFromRequest(request, env);
        if (!user) {
            return new Response('Unauthorized', { status: 401 });
        }

        const preferences = await request.json(); // Expects an array of {sekai: string, visible: boolean}

        const statements = preferences.map(p =>
            env.DB.prepare('INSERT OR REPLACE INTO user_sekai_preferences (user_id, sekai, visible) VALUES (?, ?, ?)')
                .bind(user.id, p.sekai, p.visible ? 1 : 0)
        );

        await env.DB.batch(statements);

        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        await logError(error, env, 'Update Sekai Preferences');
        return new Response('Internal Server Error', { status: 500 });
    }
}

// 대화 목록 조회 (즐겨찾기 포함)
async function handleConversations(request, env) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { results } = await env.DB.prepare(`
      SELECT c.id, c.title, c.created_at, c.is_favorite,
             GROUP_CONCAT(
               CASE
                 WHEN cp.character_type = 'user' THEN '/api/user-characters/image/' || uc.profile_image_r2
                 ELSE ch.profile_image
               END
             ) as participant_images
      FROM conversations c
      LEFT JOIN conversation_participants cp ON c.id = cp.conversation_id
      LEFT JOIN characters ch ON cp.character_id = ch.id AND cp.character_type = 'official'
      LEFT JOIN user_characters uc ON cp.character_id = uc.id AND cp.character_type = 'user'
      WHERE c.user_id = ?
      GROUP BY c.id
      ORDER BY c.is_favorite DESC, c.created_at DESC
    `).bind(user.id).all();

    // 참여자 이미지 처리
    const conversations = results.map(conv => ({
      ...conv,
      participant_images: conv.participant_images ? conv.participant_images.split(',') : []
    }));

    return new Response(JSON.stringify(conversations || []), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Handle Conversations');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 즐겨찾기 토글 함수
async function toggleConversationFavorite(request, env, conversationId) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 대화방 소유권 확인
    const conversation = await env.DB.prepare(
      'SELECT is_favorite FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) {
      return new Response('Not Found', { status: 404 });
    }

    // 즐겨찾기 상태 토글
    const newFavoriteStatus = conversation.is_favorite ? 0 : 1;

    await env.DB.prepare(
      'UPDATE conversations SET is_favorite = ? WHERE id = ?'
    ).bind(newFavoriteStatus, conversationId).run();

    return new Response(JSON.stringify({
      success: true,
      is_favorite: newFavoriteStatus
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Toggle Conversation Favorite');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 대화 제목 수정 함수
async function updateConversationTitle(request, env, conversationId) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 대화방 소유권 확인
    const conversation = await env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) {
      return new Response('Not Found', { status: 404 });
    }

    const { title } = await request.json();

    if (!title || title.trim().length === 0) {
      return new Response('제목이 필요합니다.', { status: 400 });
    }

    const trimmedTitle = title.trim().substring(0, 100); // 최대 100자

    await env.DB.prepare(
      'UPDATE conversations SET title = ? WHERE id = ?'
    ).bind(trimmedTitle, conversationId).run();

    return new Response(JSON.stringify({
      success: true,
      title: trimmedTitle
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Update Conversation Title');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 작업 모드 업데이트 함수
async function updateWorkMode(request, env, conversationId) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 대화방 소유권 확인
    const conversation = await env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) {
      return new Response('Not Found', { status: 404 });
    }

    const { workMode } = await request.json();

    await env.DB.prepare(
      'UPDATE conversations SET work_mode = ? WHERE id = ?'
    ).bind(workMode ? 1 : 0, conversationId).run();

    return new Response(JSON.stringify({
      success: true,
      work_mode: workMode ? 1 : 0
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Update Work Mode');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 새 대화 생성
async function createConversation(request, env) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { title } = await request.json();
    const conversationTitle = title || `대화 ${Date.now()}`;

    const result = await env.DB.prepare(
      'INSERT INTO conversations (user_id, title) VALUES (?, ?) RETURNING id'
    ).bind(user.id, conversationTitle).first();

    return new Response(JSON.stringify({
      id: result.id,
      title: conversationTitle
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Create Conversation');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 대화 메시지 조회 함수 (작업 모드, 시간정보, 상황프롬프트 정보 포함)
async function getConversationMessages(request, env, conversationId) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 대화방 접근 권한 확인 및 설정 정보 조회
    const conversation = await env.DB.prepare(
      'SELECT work_mode, show_time_info, situation_prompt, auto_reply_mode_enabled, use_autorag_memory FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) {
      return new Response('Not Found', { status: 404 });
    }

    const { results } = await env.DB.prepare(
      `SELECT m.id, m.role, m.content, m.message_type, m.auto_call_sequence,
              COALESCE(c.name, uc.name) as character_name,
              CASE
                WHEN m.character_type = 'user' THEN '/api/user-characters/image/' || uc.profile_image_r2
                ELSE c.profile_image
              END as character_image,
              f.filename
       FROM messages m
       LEFT JOIN characters c ON m.character_id = c.id
       LEFT JOIN user_characters uc ON m.user_character_id = uc.id
       LEFT JOIN files f ON m.file_id = f.id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC`
    ).bind(conversationId).all();

    return new Response(JSON.stringify({
            messages: results || [],
      work_mode: conversation.work_mode,
      show_time_info: conversation.show_time_info !== undefined ? conversation.show_time_info : 1,
      situation_prompt: conversation.situation_prompt || '',
      auto_reply_mode_enabled: conversation.auto_reply_mode_enabled || 0,
      use_autorag_memory: conversation.use_autorag_memory || 0
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Get Conversation Messages');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 대화 삭제
async function deleteConversation(request, env, conversationId) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 즐겨찾기 대화는 삭제 불가
    const conversation = await env.DB.prepare(
      'SELECT is_favorite FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) {
      return new Response('Not Found', { status: 404 });
    }

    if (conversation.is_favorite) {
      return new Response('즐겨찾기 대화는 삭제할 수 없습니다.', { status: 400 });
    }

    // 트랜잭션으로 관련 데이터 모두 삭제
    await env.DB.prepare('DELETE FROM conversation_participants WHERE conversation_id = ?')
      .bind(conversationId).run();
    await env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?')
      .bind(conversationId).run();
    await env.DB.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?')
      .bind(conversationId, user.id).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Delete Conversation');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 공지사항 조회
async function getNotice(request, env) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT content FROM notices ORDER BY id DESC'
    ).all();

    return new Response(JSON.stringify(results || []), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Get Notice');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 쿨다운 관리를 위한 메모리 저장소
const imageCooldowns = new Map();

// 이미지 생성 쿨다운 확인
function isImageGenerationOnCooldown(userId) {
  const lastGeneration = imageCooldowns.get(userId);
  if (!lastGeneration) return false;

  const now = Date.now();
  const cooldownPeriod = 20 * 1000; // 20초
  return (now - lastGeneration) < cooldownPeriod;
}

// 이미지 생성 쿨다운 설정
function setImageGenerationCooldown(userId) {
  imageCooldowns.set(userId, Date.now());
}

// 남은 쿨다운 시간 계산 (초 단위)
function getRemainingCooldown(userId) {
  const lastGeneration = imageCooldowns.get(userId);
  if (!lastGeneration) return 0;

  const now = Date.now();
  const cooldownPeriod = 20 * 1000; // 20초
  const elapsed = now - lastGeneration;
  const remaining = Math.max(0, cooldownPeriod - elapsed);
  return Math.ceil(remaining / 1000);
}

// 이미지 생성 처리 함수
async function handleImageGeneration(request, env) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { prompt, conversationId, characterId, characterType } = await request.json();

    if (!prompt || !conversationId || !characterId) {
      return new Response('필수 매개변수가 누락되었습니다.', { status: 400 });
    }

    // 쿨다운 확인
    if (isImageGenerationOnCooldown(user.id)) {
      const remainingSeconds = getRemainingCooldown(user.id);
      return new Response(JSON.stringify({
        error: 'cooldown',
        message: `이미지 생성은 20초마다 한 번만 가능합니다. ${remainingSeconds}초 후에 다시 시도해주세요.`,
        remainingSeconds: remainingSeconds
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 캐릭터가 이미지 생성을 지원하는지 확인
    const supportsImageGen = await supportsImageGeneration(characterId, characterType, env);
    if (!supportsImageGen) {
      return new Response(JSON.stringify({
        error: 'unsupported_character',
        message: '이 캐릭터는 이미지 생성을 지원하지 않습니다.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      // Workers AI로 이미지 생성
      const imageBuffer = await generateImageWithAI(prompt, env);
      if (!imageBuffer) {
        throw new Error('이미지 생성에 실패했습니다.');
      }

      // R2에 이미지 저장
      const imageInfo = await saveGeneratedImageToR2(imageBuffer, env);
      if (!imageInfo) {
        throw new Error('이미지 저장에 실패했습니다.');
      }

      // 쿨다운 설정
      setImageGenerationCooldown(user.id);

      return new Response(JSON.stringify({
        success: true,
        imageUrl: `/api/images/generated/${imageInfo.fileName}`,
        fileName: imageInfo.fileName,
        prompt: prompt
      }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (imageError) {
      await logError(imageError, env, 'Image Generation Process');
      return new Response(JSON.stringify({
        error: 'generation_failed',
        message: '이미지 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    await logError(error, env, 'Handle Image Generation');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 이미지 생성 지원 확인 함수
async function supportsImageGeneration(characterId, characterType, env) {
  try {
    if (characterType === 'official') {
      const allowedIds = env.IMAGE_GENERATION_CHARACTERS?.split(',').map(id => parseInt(id.trim())) || [3, 8];
      return allowedIds.includes(characterId);
    }

    if (characterType === 'user') {
      if (characterId < 10000) return false;
      const exists = await env.DB.prepare(
        'SELECT id FROM user_characters WHERE id = ? AND deleted_at IS NULL'
      ).bind(characterId).first();
      return !!exists;
    }

    return false;
  } catch (error) {
    await logError(error, env, 'Check Image Generation Support');
    return false;
  }
}

// Workers AI로 이미지 생성
async function generateImageWithAI(prompt, env) {
  try {
    const use25Flash = env['25FLASH_IMAGE'] === 'true';

    const response = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt: prompt,
      steps: use25Flash ? 3 : 4,
      width: use25Flash ? 400 : 512,
      height: use25Flash ? 400 : 512
    });
    return response;
  } catch (error) {
    await logError(error, env, 'Generate Image with AI');
    return null;
  }
}

// 생성된 이미지를 R2에 저장
async function saveGeneratedImageToR2(imageBuffer, env) {
  try {
    const fileName = `generated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
    const key = `generated_images/${fileName}`;
    await env.R2.put(key, imageBuffer, {
      httpMetadata: { contentType: 'image/png' }
    });
    return { fileName, key };
  } catch (error) {
    await logError(error, env, 'Save Generated Image to R2');
    return null;
  }
}

// 이미지 직접 업로드 함수
async function handleDirectUpload(request, env) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user || !user.gemini_api_key) {
      return new Response('Forbidden', { status: 403 });
    }

    // 사용자 존재 여부 확인 (Foreign Key 제약조건 오류 방지)
    const userExists = await env.DB.prepare('SELECT id FROM users WHERE id = ?')
      .bind(user.id).first();

    if (!userExists) {
      await logError(new Error(`User ID ${user.id} from JWT token does not exist in database`), env, 'Handle Direct Upload - User Validation');
      return new Response('Invalid user session. Please login again.', { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const conversationId = formData.get('conversationId');

    if (!file) {
      return new Response('파일이 필요합니다.', { status: 400 });
    }

    if (!validateUploadFile(file)) {
      return new Response('지원하지 않는 파일 형식이거나 크기가 5MB를 초과합니다.', { status: 400 });
    }

    // 대화방 존재 여부 및 소유권 확인 (Foreign Key 제약조건 오류 방지)
    if (conversationId) {
      const conversationExists = await env.DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
        .bind(conversationId, user.id).first();

      if (!conversationExists) {
        return new Response('Invalid conversation or access denied', { status: 403 });
      }
    }

    const uniqueFileName = generateUniqueFileName(file.name);
    const r2Key = `image_uploads/${uniqueFileName}`;

    try {
      await env.R2.put(r2Key, file.stream(), {
        httpMetadata: { contentType: file.type },
      });

      const fileResult = await env.DB.prepare(
        'INSERT INTO files (user_id, filename, original_name, file_size, mime_type, r2_key) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
      ).bind(user.id, uniqueFileName, file.name, file.size, file.type, r2Key).first();

      const fileId = fileResult.id;

      await env.DB.prepare(
        'INSERT INTO messages (conversation_id, role, content, message_type, file_id, user_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(conversationId, 'user', file.name, 'image', fileId, user.id).run();

      // 대화 캐시 무효화
      const cacheKey = `chat_history:${conversationId}`;
      await env.KV.delete(cacheKey);

      return new Response(JSON.stringify({
        success: true,
        fileId,
        imageUrl: `/api/images/${uniqueFileName}`,
        fileName: uniqueFileName
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (uploadError) {
      await env.R2.delete(r2Key).catch(() => {});
      throw uploadError;
    }
  } catch (error) {
    await logError(error, env, 'Handle Direct Upload');
    return new Response('업로드 실패', { status: 500 });
  }
}

// 파일 검증 함수
function validateUploadFile(file) {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (!allowedTypes.includes(file.type)) return false;
  if (!file.size || file.size > maxSize || file.size <= 0) return false;
  if (!file.name || file.name.length > 255) return false;
  const ext = file.name.split('.').pop()?.toLowerCase();
  const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
  if (!ext || !allowedExts.includes(ext)) return false;
  return true;
}

// 고유 파일명 생성
function generateUniqueFileName(originalName) {
  const ext = originalName.split('.').pop();
  const uuid = crypto.randomUUID();
  const timestamp = Date.now();
  return `${uuid}_${timestamp}.${ext}`;
}

// 이미지 서빙
async function serveImage(request, env, fileName) {
  try {
    let r2Key = `image_uploads/${fileName}`;
    let object = await env.R2.get(r2Key);

    if (!object && fileName.startsWith('generated/')) {
      r2Key = `generated_images/${fileName.replace('generated/', '')}`;
      object = await env.R2.get(r2Key);
    }

    if (!object) {
      return new Response('이미지를 찾을 수 없습니다.', { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata.contentType || 'image/png');
    headers.set('Cache-Control', 'public, max-age=31536000'); // 1년 캐싱

    return new Response(object.body, { headers });
  } catch (error) {
    await logError(error, env, 'Serve Image');
    return new Response('이미지 로드 실패', { status: 500 });
  }
}


async function extractAutoragResults(results, env) {
  if (!results) {
    return [];
  }

  let extractedResults = [];

  // Case 1: Results is a simple array of strings (as seen in gemini.js)
  if (Array.isArray(results) && results.every(item => typeof item === 'string')) {
    extractedResults = results.map((result, index) => ({
      source: `검색 결과 ${index + 1}`,
      text: result,
      filename: null // No filename info available for simple strings
    }));
  }
  // Case 2: Results is an object with a property containing the array of results
  // Common keys are 'results', 'data', 'documents', 'passages'
  else {
    const potentialResultKeys = ['results', 'data', 'documents', 'passages'];
    let found = false;

    for (const key of potentialResultKeys) {
      if (results[key] && Array.isArray(results[key])) {
        extractedResults = results[key].map((result, index) => {
          if (typeof result === 'string') {
            return { source: `검색 결과 ${index + 1}`, text: result, filename: null };
          }
          if (typeof result === 'object' && result !== null) {
            // Extract filename from various possible metadata locations
            let filename = result.filename ||
                         result.metadata?.filename ||
                         result.metadata?.file ||
                         result.metadata?.source_file ||
                         result.source_metadata?.filename ||
                         result.document_metadata?.filename;

            // If we have a filename, use it as the source, otherwise fall back to existing logic
            let source = filename ||
                        result.source ||
                        result.metadata?.source ||
                        `검색 결과 ${index + 1}`;

            return {
              source: source,
              text: result.text || result.content || result.passage || JSON.stringify(result),
              filename: filename // Include filename as a separate field for frontend use
            };
          }
          return { source: `검색 결과 ${index + 1}`, text: String(result), filename: null };
        });
        found = true;
        break;
      }
    }

    if (!found) {
      // Case 3: Results is a single object with text/content
      if (typeof results === 'object' && (results.text || results.content)) {
        let filename = results.filename ||
                      results.metadata?.filename ||
                      results.metadata?.file ||
                      results.metadata?.source_file ||
                      results.source_metadata?.filename ||
                      results.document_metadata?.filename;

        extractedResults = [{
          source: filename || results.source || '검색 결과',
          text: results.text || results.content,
          filename: filename
        }];
      }
      // Case 4: Results is a single string
      else if (typeof results === 'string') {
        extractedResults = [{
          source: '검색 결과',
          text: results,
          filename: null
        }];
      }
      // Fallback: If the structure is completely unknown, try to convert it to a string
      else {
        extractedResults = [{
          source: '알 수 없는 형식의 결과',
          text: JSON.stringify(results, null, 2),
          filename: null
        }];
      }
    }
  }

  // Now try to enhance the source information by matching with knowledge_base entries
  if (env && env.DB) {
    try {
      const { results: knowledgeEntries } = await env.DB.prepare(
        'SELECT title, content FROM knowledge_base ORDER BY title ASC'
      ).all();

      if (knowledgeEntries && knowledgeEntries.length > 0) {
        extractedResults = extractedResults.map((result, index) => {
          // If we already have a filename, prioritize it over knowledge base matching
          if (result.filename) {
            return result; // Keep the filename as source
          }

          // Try to find a matching knowledge base entry by content similarity
          const matchedEntry = findBestKnowledgeMatch(result.text, knowledgeEntries);

          if (matchedEntry) {
            return {
              ...result,
              source: matchedEntry.title
            };
          }

          // If no match found and source is generic, keep it but make it more descriptive
          if (result.source.startsWith('검색 결과')) {
            return {
              ...result,
              source: `문서 ${index + 1}`
            };
          }

          return result;
        });
      }
    } catch (error) {
      console.warn('Failed to enhance AutoRAG results with knowledge base titles:', error);
      // Continue with original results if knowledge base lookup fails
    }
  }

  return extractedResults;
}

// Helper function to find the best matching knowledge base entry
function findBestKnowledgeMatch(resultText, knowledgeEntries) {
  if (!resultText || !knowledgeEntries || knowledgeEntries.length === 0) {
    return null;
  }

  // Normalize text for comparison
  const normalizedResultText = resultText.toLowerCase().trim();

  // First, try to find exact substring matches
  for (const entry of knowledgeEntries) {
    const normalizedContent = entry.content.toLowerCase();

    // Check if result text is a substring of the knowledge content
    if (normalizedContent.includes(normalizedResultText)) {
      return entry;
    }

    // Check if knowledge content is a substring of the result text
    if (normalizedResultText.includes(normalizedContent)) {
      return entry;
    }
  }

  // If no exact match, try to find the entry with the most word overlap
  let bestMatch = null;
  let bestScore = 0;

  const resultWords = normalizedResultText.split(/\s+/).filter(word => word.length > 2);

  for (const entry of knowledgeEntries) {
    const contentWords = entry.content.toLowerCase().split(/\s+/).filter(word => word.length > 2);

    // Calculate word overlap score
    let score = 0;
    for (const word of resultWords) {
      if (contentWords.some(cWord => cWord.includes(word) || word.includes(cWord))) {
        score++;
      }
    }

    // Normalize score by result text length
    const normalizedScore = score / Math.max(resultWords.length, 1);

    if (normalizedScore > bestScore && normalizedScore > 0.3) { // Minimum threshold
      bestScore = normalizedScore;
      bestMatch = entry;
    }
  }

  return bestMatch;
}
async function handleAutoragPreview(request, env) {
  try {
    const { query, mode, server } = await request.json();
    const autoragProject = server === 'jp' ? 'sekai-jp' : 'sekai';

    if (!query) {
      return new Response('Query is required', { status: 400 });
    }

    let searchQuery = query;
    let extractedKeywords = null;

    if (mode === 'ai') {
      const keywordPrompt = `다음 텍스트의 핵심 키워드를 쉼표로 구분하여 다른 설명 없이 나열해줘:

${query}`;

      const apiKey = env.GEMINI_API_KEY;

      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not configured for unauthenticated AI search.");
      }

      try {
        const keywordResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: keywordPrompt }] }],
                generationConfig: { temperature: 0.0, maxOutputTokens: 100 }
            })
        });

        if (keywordResponse.ok) {
            const keywordData = await keywordResponse.json();
            const keywords = keywordData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (keywords) {
              searchQuery = keywords;
              extractedKeywords = keywords;
            }
        } else {
            await logError(new Error(`Keyword extraction failed: ${keywordResponse.status}`), env, 'AutoRAG Preview Keyword Extraction');
        }
      } catch (keywordError) {
        // If Gemini API fails (e.g., network issues in local dev), log the error but continue with original query
        await logError(keywordError, env, 'AutoRAG Preview Keyword Extraction - Network');
        console.warn('Keyword extraction failed, using original query:', keywordError.message);
        // searchQuery remains as the original query
      }
    }

    let results;
    let formattedResults = [];

    try {
      results = await env.AI.autorag(autoragProject).search({
        query: searchQuery,
      });

      // Log the actual response structure for debugging
      console.log('AutoRAG raw response:', JSON.stringify(results, null, 2));
      console.log('AutoRAG response type:', typeof results, 'isArray:', Array.isArray(results));

      // More robustly transform the response to match frontend expectations
      formattedResults = await extractAutoragResults(results, env);
    } catch (autoragError) {
      // Handle specific AutoRAG errors
      console.error('AutoRAG service error:', autoragError.message);
      await logError(autoragError, env, 'AutoRAG Service Call');

      // Check if this is an authentication error (common in local development)
      if (autoragError.message && autoragError.message.includes('Not logged in')) {
        // For authentication errors, return empty results to show "no results" message
        formattedResults = [];
      } else {
        // For other errors, return a helpful message
        formattedResults = [{
          source: 'System',
          text: `AutoRAG 검색 서비스에 일시적인 문제가 발생했습니다. (검색어: "${searchQuery}") 오류: ${autoragError.message}`
        }];
      }
    }

    return new Response(JSON.stringify({
      results: formattedResults,
      keywords: extractedKeywords,
      mode: mode
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    await logError(error, env, 'handleAutoragPreview');
    console.error('AutoRAG Preview Error:', error);

    // Return a more specific error response
    return new Response(JSON.stringify({
      error: error.message,
      results: [],
      keywords: extractedKeywords || null,
      mode: mode || 'normal'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Get AutoRAG vectorize bucket status
async function handleAutoragStatus(request, env) {
  try {
    const status = {
      vectorize: {
        lastModified: null,
        error: null
      },
      vectorize_jp: {
        lastModified: null,
        error: null
      }
    };

    // Get last modified date from vectorize bucket (Korean server)
    try {
      const koreanObjects = await env.AutoRAG1.list({ limit: 1000 });
      if (koreanObjects.objects && koreanObjects.objects.length > 0) {
        // Find the most recent upload
        const mostRecent = koreanObjects.objects.reduce((latest, obj) => {
          return new Date(obj.uploaded) > new Date(latest.uploaded) ? obj : latest;
        });
        status.vectorize.lastModified = mostRecent.uploaded;
      }
    } catch (error) {
      status.vectorize.error = error.message;
    }

    // Get last modified date from vectorize-jp bucket (Japanese server)
    try {
      const japaneseObjects = await env.AutoRAG2.list({ limit: 1000 });
      if (japaneseObjects.objects && japaneseObjects.objects.length > 0) {
        // Find the most recent upload
        const mostRecent = japaneseObjects.objects.reduce((latest, obj) => {
          return new Date(obj.uploaded) > new Date(latest.uploaded) ? obj : latest;
        });
        status.vectorize_jp.lastModified = mostRecent.uploaded;
      }
    } catch (error) {
      status.vectorize_jp.error = error.message;
    }

    return new Response(JSON.stringify(status), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    await logError(error, env, 'handleAutoragStatus');
    console.error('AutoRAG Status Error:', error);

    return new Response(JSON.stringify({
      error: error.message,
      vectorize: { lastModified: null, error: error.message },
      vectorize_jp: { lastModified: null, error: error.message }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}



// AutoRAG Memory toggle function
async function toggleAutoragMemory(request, env) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { conversationId, useAutoragMemory } = await request.json();

    if (!conversationId) {
      return new Response('대화 ID가 필요합니다.', { status: 400 });
    }

    // 대화방 소유권 확인
    const conversation = await env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) {
      return new Response('대화를 찾을 수 없습니다.', { status: 404 });
    }

    // AutoRAG 메모리 설정 업데이트
    await env.DB.prepare(
      'UPDATE conversations SET use_autorag_memory = ? WHERE id = ?'
    ).bind(useAutoragMemory ? 1 : 0, conversationId).run();

    return new Response(JSON.stringify({
      success: true,
      use_autorag_memory: useAutoragMemory ? 1 : 0
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Toggle AutoRAG Memory');
    return new Response('AutoRAG 메모리 설정 변경에 실패했습니다.', { status: 500 });
  }
}