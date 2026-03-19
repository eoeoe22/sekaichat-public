import { logError, getUserFromRequest } from './utils.js';

export const handleConversationParticipants = {
  // 캐릭터 초대 (공식 + 사용자 캐릭터 지원)
  async inviteCharacter(request, env, conversationId) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) {
        return new Response('Unauthorized', { status: 401 });
      }

      const { characterId, characterType } = await request.json();

      if (characterId == null || !characterType) {
        return new Response('캐릭터 정보가 누락되었습니다.', { status: 400 });
      }

      let finalCharacterType = '';
      if (characterType === 'official') {
          finalCharacterType = 'official';
      } else if (characterType === 'user' || characterType === 'my_character' || characterType === 'user_created') {
          finalCharacterType = 'user';
      } else {
          return new Response(`Invalid characterType: ${characterType}`, { status: 400 });
      }

      // First, verify the character itself exists to provide a clear error message.
      if (finalCharacterType === 'official') {
          const charExists = await env.DB.prepare('SELECT id FROM characters WHERE id = ?').bind(characterId).first();
          if (!charExists) return new Response('초대할 수 없는 캐릭터입니다 (공식).', { status: 400 });
      } else { // user
          const charExists = await env.DB.prepare('SELECT id FROM user_characters WHERE id = ? AND deleted_at IS NULL').bind(characterId).first();
          if (!charExists) return new Response('초대할 수 없는 캐릭터입니다 (사용자).', { status: 400 });
      }

      const result = await env.DB.prepare(`
        INSERT INTO conversation_participants (conversation_id, character_id, character_type)
        SELECT c.id, ?, ?
        FROM conversations c
        WHERE c.id = ? AND c.user_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM conversation_participants cp
          WHERE cp.conversation_id = c.id AND cp.character_id = ? AND cp.character_type = ?
        )
      `).bind(
          characterId,
          finalCharacterType,
          conversationId,
          user.id,
          characterId,
          finalCharacterType
      ).run();

      if (result.meta.changes === 0) {
          const conversation = await env.DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(conversationId, user.id).first();
          if (!conversation) {
              return new Response('대화방을 찾을 수 없거나 권한이 없습니다.', { status: 404 });
          }
          return new Response('이미 초대된 캐릭터입니다.', { status: 400 });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      await logError(error, env, 'Invite Character');
      return new Response(`캐릭터 초대에 실패했습니다: ${error.message}`, { status: 500 });
    }
  },

  // 대화 참여자 목록 조회 (공식 + 사용자 캐릭터)
  async getParticipants(request, env, conversationId) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) {
        return new Response('Unauthorized', { status: 401 });
      }

      // 대화방 접근 권한 확인
      const conversation = await env.DB.prepare(
        'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
      ).bind(conversationId, user.id).first();

      if (!conversation) {
        return new Response('대화방을 찾을 수 없습니다.', { status: 404 });
      }

      // 참여자 목록 조회 (공식 캐릭터 + 사용자 캐릭터)
      const { results } = await env.DB.prepare(`
        SELECT
          cp.character_id as id,
          cp.character_type,
          CASE
            WHEN cp.character_type = 'official' THEN c.name
            ELSE uc.name
          END as name,
          CASE
            WHEN cp.character_type = 'official' THEN c.nickname
            ELSE NULL
          END as nickname,
          CASE
            WHEN cp.character_type = 'official' THEN c.profile_image
            ELSE '/api/user-characters/image/' || uc.profile_image_r2
          END as profile_image
        FROM conversation_participants cp
        LEFT JOIN characters c ON cp.character_id = c.id
        LEFT JOIN user_characters uc ON cp.character_id = uc.id AND uc.deleted_at IS NULL
        WHERE cp.conversation_id = ?
        ORDER BY cp.created_at ASC
      `).bind(conversationId).all();

      const allowedIdsString = env.IMAGE_GENERATION_CHARACTERS || '3,8';
      const allowedIds = new Set(allowedIdsString.split(',').map(id => parseInt(id.trim())));

      const participantsWithFlag = results.map(p => ({
          ...p,
          supports_image_generation: p.character_type === 'user' ? true : allowedIds.has(p.id)
      }));

      return new Response(JSON.stringify(participantsWithFlag), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      await logError(error, env, 'Get Participants');
      return new Response('참여자 목록 조회에 실패했습니다.', { status: 500 });
    }
  }
};

// 대화 제목 자동 업데이트 (사용자 첫 메시지 기준)
export async function updateConversationTitle(conversationId, message, env) {
  try {
    const conversation = await env.DB.prepare(
      'SELECT title FROM conversations WHERE id = ?'
    ).bind(conversationId).first();

    if (!conversation?.title || conversation.title.startsWith('대화 ')) {
      const title = message.length > 30 ? message.substring(0, 30) + '...' : message;
      await env.DB.prepare(
        'UPDATE conversations SET title = ? WHERE id = ?'
      ).bind(title, conversationId).run();
    }
  } catch (error) {
    await logError(error, env, 'Update Conversation Title');
  }
}

// 대화 참여자 이름 목록 조회
export async function getConversationParticipants(conversationId, env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT
        CASE
          WHEN cp.character_type = 'official' THEN c.name
          ELSE uc.name
        END as name
      FROM conversation_participants cp
      LEFT JOIN characters c ON cp.character_id = c.id AND cp.character_type = 'official'
      LEFT JOIN user_characters uc ON cp.character_id = uc.id AND cp.character_type = 'user' AND uc.deleted_at IS NULL
      WHERE cp.conversation_id = ?`
    ).bind(conversationId).all();

    return results.map(r => r.name).filter(Boolean);
  } catch (error) {
    await logError(error, env, 'Get Conversation Participants');
    return [];
  }
}
