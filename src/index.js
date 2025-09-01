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
import { handleKnowledgeBase, handleConversationKnowledge } from './knowledge-base.js';
import { handleDating }                    from './dating.js';
import { toggleAffectionSystem, adjustAffectionManual, getAffectionStatus, updateAffectionType } from './affection-system.js';
import { logError, verifyJwt, generateSalt, hashPassword, verifyPassword, getAuth, getUserFromRequest } from './utils.js';

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      
      // Domain redirection: redirect old domain to new domain
      if (url.hostname === 'sekai-chat.eoe253326.workers.dev') {
        const newUrl = new URL(request.url);
        newUrl.hostname = 'sekaich.at';
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
    '/api/knowledge-base': { GET: handleKnowledgeBase.getAll },
    '/api/dating/conversations': { GET: handleDating.getConversations, POST: handleDating.initializeConversation },
    '/api/dating/chat': { POST: handleDating.handleChat },
    '/api/dating/checkpoints': { POST: handleDating.createCheckpoint },
    '/api/dating/reset': { POST: handleDating.reset },
    '/api/dating/conversation/update': { POST: handleDating.updateConversation },
    '/api/dating/setup-schema': { POST: handleDating.setupSchema },
    '/api/dating/characters': { GET: handleDating.getDatingCharacters },
    '/api/affection/toggle': { POST: toggleAffectionSystem },
    '/api/affection/adjust': { POST: adjustAffectionManual },
    '/api/affection/type': { POST: updateAffectionType },
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
  if ((match = path.match(/^\/api\/conversations\/(\d+)\/knowledge\/search$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'POST') return handleKnowledgeBase.searchByKeywords(request, env, conversationId);
  }
  if ((match = path.match(/^\/api\/conversations\/(\d+)\/knowledge$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'POST') return handleConversationKnowledge.apply(request, env, conversationId);
    if (method === 'DELETE') return handleConversationKnowledge.remove(request, env, conversationId);
    if (method === 'GET') return handleConversationKnowledge.getApplied(request, env, conversationId);
  }
  if ((match = path.match(/^\/api\/conversations\/(\d+)\/affection$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'GET') return getAffectionStatus(request, env);
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
  if ((match = path.match(/^\/api\/dating\/conversation\/(\d+)$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'GET') return handleDating.getConversationDetails(request, env, conversationId);
  }
  if ((match = path.match(/^\/api\/dating\/conversation\/(\d+)\/messages$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'GET') return handleDating.getMessages(request, env, conversationId);
  }
  if ((match = path.match(/^\/api\/dating\/conversation\/(\d+)\/checkpoints$/))) {
    const conversationId = parseInt(match[1]);
    if (method === 'GET') return handleDating.getCheckpoints(request, env, conversationId);
  }
  if ((match = path.match(/^\/api\/dating\/checkpoints\/(\d+)\/load$/))) {
    const checkpointId = parseInt(match[1]);
    if (method === 'POST') return handleDating.loadCheckpoint(request, env, checkpointId);
  }
  if ((match = path.match(/^\/api\/dating\/checkpoints\/(\d+)$/))) {
    const checkpointId = parseInt(match[1]);
    if (method === 'DELETE') return handleDating.deleteCheckpoint(request, env, checkpointId);
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

    // 루트 경로는 동적 HTML 생성
    if (path === '/') {
        return getLandingPage();
    }

    // "깔끔한 URL"을 실제 .html 파일로 매핑
    const pageMap = {
        '/home': '/main.html',
        '/playground': '/playground.html',
        '/login': '/login.html',
        '/register': '/register.html',
        '/settings': '/settings.html',
        '/characterinfo': '/characterinfo.html',
        '/about': '/about.html',
        '/dating': '/dating.html',
        // '/dating/chat'은 이제 실제 파일이 아니므로 여기서 처리할 필요 없음
    };
    
    const cleanPath = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;

    if (pageMap[cleanPath]) {
        const newUrl = new URL(pageMap[cleanPath], url.origin);
        const newRequest = new Request(newUrl, request);
        // wrangler.toml의 assets 설정에 따라 env.ASSETS.fetch를 사용해야 합니다.
        // 하지만 이 바인딩이 없으므로, 정적 에셋 서빙은 Cloudflare의 내장 핸들러에 맡깁니다.
        // 이 함수는 이제 깔끔한 URL을 실제 파일 URL로 변환하는 역할만 합니다.
        // 이 코드 블록은 이제 사실상 필요 없지만, 명확성을 위해 남겨둡니다.
        // 실제로는 아래의 env.ASSETS.fetch(request)가 모든 것을 처리합니다.
    }

    try {
        // wrangler.toml의 `assets` 설정은 `env.ASSETS.fetch`를 통해 접근하는 것이 아니라,
        // 플랫폼이 요청을 가로채 자동으로 처리합니다.
        // 따라서 그냥 원본 요청을 플랫폼에 전달하기만 하면 됩니다.
        // 만약 파일이 존재하지 않으면, 플랫폼은 404를 반환합니다.
        // 이 방식이 `env.ASSETS`가 undefined인 문제를 해결합니다.
        return env.ASSETS.fetch(request);
    } catch (e) {
        // `env.ASSETS`가 없는 경우를 대비한 폴백
        if (e.message.includes("env.ASSETS is not an object")) {
            return new Response("Static assets are not configured correctly.", { status: 500 });
        }
        throw e;
    }
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
    await env.DB.prepare('DELETE FROM conversation_history_cache WHERE conversation_id = ?')
      .bind(message.conversation_id).run();
    
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
      'SELECT id, name, nickname, profile_image, system_prompt FROM characters ORDER BY id ASC'
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
async function getUserInfo(request, env) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }
    
    const userInfo = {
      username: user.username,
      nickname: user.nickname,
      self_introduction: user.self_introduction,
      max_auto_call_sequence: user.max_auto_call_sequence || 3,
      has_api_key: !!user.gemini_api_key,
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
      'SELECT work_mode, show_time_info, situation_prompt, auto_reply_mode_enabled FROM conversations WHERE id = ? AND user_id = ?'
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
      auto_reply_mode_enabled: conversation.auto_reply_mode_enabled || 0
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
    const result = await env.DB.prepare(
      'SELECT content FROM notices WHERE id = 1'
    ).first();
    
    return new Response(JSON.stringify({ 
      content: result?.content || '공지사항이 없습니다.' 
    }), {
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
    const response = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt: prompt,
      steps: 3,
      width: 400,
      height: 400
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
    
    const formData = await request.formData();
    const file = formData.get('file');
    const conversationId = formData.get('conversationId');
    
    if (!file) {
      return new Response('파일이 필요합니다.', { status: 400 });
    }
    
    if (!validateUploadFile(file)) {
      return new Response('지원하지 않는 파일 형식이거나 크기가 5MB를 초과합니다.', { status: 400 });
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


function getLandingPage() {
  const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>세카이 채팅</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-icons/1.10.5/font/bootstrap-icons.min.css" />
    <style>
        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            transition: background 0.3s ease, color 0.3s ease;
            color: #333;
        }
        .landing-card {
            background: white;
            padding: 3rem;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 500px;
            width: 90%;
            transition: background 0.3s ease, color 0.3s ease;
        }
        .logo {
            margin-bottom: 1rem;
        }
        .logo-img {
            width: 120px;
            height: 120px;
            border-radius: 20px;
            object-fit: cover;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        .title {
            font-size: 2.5rem;
            font-weight: bold;
            color: #333;
            margin-bottom: 1rem;
            transition: color 0.3s ease;
        }
        .description {
            color: #666;
            margin-bottom: 2rem;
            font-size: 1.1rem;
            line-height: 1.6;
            transition: color 0.3s ease;
        }
        .btn-custom {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border: none;
            padding: 15px 30px;
            font-size: 1.1rem;
            font-weight: 600;
            margin: 0 10px 10px 0;
            border-radius: 50px;
            transition: all 0.3s ease;
            color: white;
            text-decoration: none;
            display: inline-block;
        }
        .btn-custom:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0,0,0,0.2);
            color: white;
            text-decoration: none;
        }
        .btn-outline-secondary {
            border: 2px solid #333;
            color: #333;
            background: transparent;
            padding: 12px 24px;
            font-size: 1rem;
            font-weight: 500;
            border-radius: 50px;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-block;
        }
        .btn-outline-secondary:hover {
            background-color: #333;
            color: white;
            transform: translateY(-2px);
            box-shadow: 0 8px 16px rgba(0,0,0,0.3);
            text-decoration: none;
        }

        @media (max-width: 768px) {
            .landing-card {
                padding: 2rem;
            }
            .title {
                font-size: 2rem;
            }
        }

        /* 다크모드 지원 */
        @media (prefers-color-scheme: dark) {
            body {
                background: linear-gradient(135deg, #22272e 0%, #1c1f24 100%);
                color: #ddd;
            }
            .landing-card {
                background: #2c2f36;
                color: #ddd;
                box-shadow: 0 20px 40px rgba(0,0,0,0.7);
            }
            .title {
                color: #e0e0e0;
            }
            .description {
                color: #bbb;
            }
            .btn-custom {
                background: linear-gradient(135deg, #4a90e2 0%, #336abd 100%);
                color: #eee;
            }
            .btn-custom:hover {
                background: linear-gradient(135deg, #3565b0 0%, #274a7a 100%);
                color: #fff;
                box-shadow: 0 10px 25px rgba(0,0,0,0.8);
            }
            .btn-outline-secondary {
                border-color: #ddd;
                color: #ddd;
            }
            .btn-outline-secondary:hover {
                background-color: #ddd;
                color: #222;
            }
        }
    </style>
</head>
<body>
    <div class="landing-card">
        <div class="logo">
            <img src="/logo.jpg" alt="세카이 채팅 로고" class="logo-img">
        </div>
        <h1 class="title">세카이 채팅</h1>
        <p class="description">
            Google Gemini 기반 다중 캐릭터 챗봇
        </p>

        <div>
            <a href="/login" class="btn-custom">
                <i class="bi bi-box-arrow-in-right"></i> 로그인
            </a>
            <a href="/register" class="btn-custom">
                <i class="bi bi-person-plus"></i> 회원가입
            </a>
        </div>

        <div class="mt-4">
            <a href="/about" class="btn-outline-secondary">
                <i class="bi bi-info-circle"></i> 사이트 정보
            </a>
        </div>
    </div>
</body>
</html>
  `;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
