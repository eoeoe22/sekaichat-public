import { handleAuth } from './auth.js';
import {
  handleChat,
  handleCharacterGeneration,
  handleAutoReply,
  handleSelectSpeaker
} from './gemini.js';
import { handleCharacters } from './characters.js';
import { handleConversationParticipants } from './conversations.js';
import {
  handleUserCharacters,
  uploadCharacterImage,
  getExtendedCharacterList,
  serveUserCharacterImage
} from './user-characters.js';
import { handleMigration } from './migration.js';
import { handleTTS, handleTTSTranslation, handleTTSTest, handleTTSDebug } from './tts.js';
import { logError } from './utils.js';

// Handler Imports
import { handlePages } from './handlers/pages.js';
import {
  getUserInfo,
  handleUserUpdate,
  checkAuthStatus,
  handleProfileImageUpdate
} from './handlers/user.js';
import {
  handleConversations,
  createConversation,
  getConversationMessages,
  toggleConversationFavorite,
  updateConversationTitle,
  updateWorkMode,
  updateShowTime,
  updateSituationPrompt,
  updateAutoReplyMode,
  deleteMessage,
  deleteConversation,
  toggleAutoragMemory
} from './handlers/conversation-handlers.js';
import { getSekaiPreferences, updateSekaiPreferences } from './handlers/sekai.js';
import {
  handleImageGeneration,
  handleDirectUpload,
  serveImage
} from './handlers/images.js';
import {
  handleAutoragPreview,
  handleAutoragStatus,
  handleVocaloidSearch,
  handleAutoragFullContent
} from './handlers/autorag.js';
import { handleR2Request } from './handlers/r2.js';
import { getNotice } from './handlers/notices.js';
import { handleScheduled } from './scheduled-crawler.js';

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (env.DOMAIN && url.hostname !== env.DOMAIN && !url.hostname.includes('localhost')) {
        const newUrl = new URL(request.url);
        newUrl.hostname = env.DOMAIN;
        return Response.redirect(newUrl.toString(), 301);
      }

      const path = url.pathname;

      if (path.startsWith('/api/')) {
        return handleAPI(request, env, path, ctx);
      }

      if (path.startsWith('/auth/')) {
        if (path === '/auth/discord') {
          return handleAuth.discord(request, env);
        }
        if (path === '/auth/discord/callback') {
          return handleAuth.discordCallback(request, env);
        }
      }

      if (path.startsWith('/r2/')) {
        return handleR2Request(request, env, path);
      }

      return handlePages(request, env);
    } catch (error) {
      await logError(error, env, 'Main Router');
      return new Response(error.stack || error, { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    return handleScheduled(event, env, ctx);
  }
};

async function handleAPI(request, env, path, ctx) {
  const method = request.method;

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
    '/api/characters/info': { GET: handleCharacters.getInfo },
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
    '/api/autorag/full-content': { POST: handleAutoragFullContent },
    '/api/vocaloid/search': { POST: handleVocaloidSearch },
    '/api/cron/trigger': {
      POST: async (request, env, ctx) => {
        // Run the scheduled task manually
        const event = {
          scheduledTime: Date.now(),
          cron: "MANUAL_TRIGGER",
          type: "scheduled"
        };
        ctx.waitUntil(handleScheduled(event, env, ctx));
        return new Response(JSON.stringify({ status: 'triggered', message: 'Crawler started in background' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    },
  };

  if (routes[path] && routes[path][method]) {
    return routes[path][method](request, env, ctx);
  }

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