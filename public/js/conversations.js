import { logError, logDebug } from './utils.js';

// 🔧 누락된 getUserFromRequest 함수 추가
async function getUserFromRequest(request, env) {
  try {
    const cookies = request.headers.get('Cookie');
    if (!cookies) return null;
    
    const tokenMatch = cookies.match(/token=([^;]+)/);
    if (!tokenMatch) return null;
    
    const tokenData = JSON.parse(atob(tokenMatch[1]));
    if (tokenData.exp < Date.now()) return null;
    
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(tokenData.userId).first();
    
    return user;
  } catch (error) {
    return null;
  }
}

// 🔧 누락된 handleConversations export 추가
export const handleConversations = {
  // 전체 대화 목록 조회
  async getAll(request, env) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) {
        return new Response('으....이....', { status: 401 });
      }
      
      const { results } = await env.DB.prepare(
        `SELECT 
            c.id, 
            c.title, 
            c.is_favorite, 
            c.work_mode, 
            c.created_at,
            GROUP_CONCAT(
                CASE 
                    WHEN cp.character_type = 'official' THEN ch.profile_image
                    WHEN cp.character_type = 'user' THEN '/api/user-characters/image/' || uc.profile_image_r2
                    ELSE NULL
                END
            ) as participant_images
         FROM conversations c
         LEFT JOIN conversation_participants cp ON c.id = cp.conversation_id
         LEFT JOIN characters ch ON cp.character_id = ch.id
         LEFT JOIN user_characters uc ON cp.character_id = uc.id AND uc.deleted_at IS NULL
         WHERE c.user_id = ?
         GROUP BY c.id, c.title, c.is_favorite, c.work_mode, c.created_at
         ORDER BY c.is_favorite DESC, c.created_at DESC`
      ).bind(user.id).all();
      
      const conversations = results.map(conv => ({
        ...conv,
        participant_images: conv.participant_images ? conv.participant_images.split(',').filter(Boolean) : []
      }));
      
      return new Response(JSON.stringify(conversations || []), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Get All Conversations');
      return new Response('으....이....', { status: 500 });
    }
  },

  // 새 대화 생성
  async create(request, env) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) {
        return new Response('으....이....', { status: 401 });
      }
      
      const result = await env.DB.prepare(
        'INSERT INTO conversations (user_id, title) VALUES (?, ?)'
      ).bind(user.id, `대화 ${new Date().toLocaleString()}`).run();
      
      return new Response(JSON.stringify({ 
        id: result.meta.last_row_id,
        success: true 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Create Conversation');
      return new Response('으....이....', { status: 500 });
    }
  },

  // 특정 대화 조회 (메시지 포함)
  async getById(request, env, conversationId) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) {
        return new Response('으....이....', { status: 401 });
      }
      
      // 대화방 소유권 확인
      const conversation = await env.DB.prepare(
        'SELECT work_mode FROM conversations WHERE id = ? AND user_id = ?'
      ).bind(conversationId, user.id).first();
      
      if (!conversation) {
        return new Response('으....이....', { status: 404 });
      }
      
      // 메시지 조회
      const { results } = await env.DB.prepare(
        `SELECT 
            m.id, m.role, m.content, m.message_type, m.auto_call_sequence, m.created_at,
            f.filename,
            CASE 
                WHEN m.character_type = 'official' THEN c.name
                WHEN m.character_type = 'user' THEN uc.name
                ELSE NULL
            END as character_name,
            CASE 
                WHEN m.character_type = 'official' THEN c.profile_image
                WHEN m.character_type = 'user' THEN '/api/user-characters/image/' || uc.profile_image_r2
                ELSE NULL
            END as character_image
         FROM messages m
         LEFT JOIN characters c ON m.character_id = c.id
         LEFT JOIN user_characters uc ON m.character_id = uc.id AND uc.deleted_at IS NULL
         LEFT JOIN files f ON m.file_id = f.id
         WHERE m.conversation_id = ?
         ORDER BY m.created_at ASC`
      ).bind(conversationId).all();
      
      return new Response(JSON.stringify({
        messages: results || [],
        work_mode: conversation.work_mode || 0
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Get Conversation By ID');
      return new Response('으....이....', { status: 500 });
    }
  },

  // 대화 삭제
  async delete(request, env, conversationId) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) {
        return new Response('으....이....', { status: 401 });
      }
      
      // 즐겨찾기된 대화는 삭제 불가
      const conversation = await env.DB.prepare(
        'SELECT is_favorite FROM conversations WHERE id = ? AND user_id = ?'
      ).bind(conversationId, user.id).first();
      
      if (!conversation) {
        return new Response('으....이....', { status: 404 });
      }
      
      if (conversation.is_favorite) {
        return new Response('즐겨찾기된 대화는 삭제할 수 없습니다.', { status: 400 });
      }
      
      // 대화 및 관련 데이터 삭제
      await env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(conversationId).run();
      await env.DB.prepare('DELETE FROM conversation_participants WHERE conversation_id = ?').bind(conversationId).run();
      await env.DB.prepare('DELETE FROM conversations WHERE id = ?').bind(conversationId).run();
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Delete Conversation');
      return new Response('으....이....', { status: 500 });
    }
  }
};

// src/conversations.js 수정
export const handleConversationParticipants = {
  // 캐릭터 초대 (공식 + 사용자 캐릭터 지원)
  async inviteCharacter(request, env, conversationId) {
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
        return new Response('대화방을 찾을 수 없습니다.', { status: 404 });
      }
      
      const { characterId, characterType } = await request.json();

      // 입력값 검증
      if (!characterId || !characterType) {
        return new Response('캐릭터 정보가 누락되었습니다.', { status: 400 });
      }
      
      // 캐릭터 존재 여부 확인
      let characterExists = false;
      let finalCharacterType = '';

      if (characterType === 'official') {
          const officialChar = await env.DB.prepare(
              'SELECT id FROM characters WHERE id = ?'
          ).bind(characterId).first();
          if (officialChar) {
              characterExists = true;
              finalCharacterType = 'official';
          }
      } else if (characterType === 'user' || characterType === 'my_character' || characterType === 'user_created') {
          const userChar = await env.DB.prepare(
              'SELECT id FROM user_characters WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
          ).bind(characterId, user.id).first();
          if (userChar) {
              characterExists = true;
              finalCharacterType = 'user';
          }
      }
      
      if (!characterExists) {
        return new Response('초대할 수 없는 캐릭터입니다.', { status: 400 });
      }
      
      // 이미 초대된 캐릭터인지 확인
      const existingParticipant = await env.DB.prepare(
        'SELECT id FROM conversation_participants WHERE conversation_id = ? AND character_id = ? AND character_type = ?'
      ).bind(conversationId, characterId, finalCharacterType).first();
      
      if (existingParticipant) {
        return new Response('이미 초대된 캐릭터입니다.', { status: 400 });
      }
      
      // 캐릭터 초대
      await env.DB.prepare(
        'INSERT INTO conversation_participants (conversation_id, character_id, character_type) VALUES (?, ?, ?)'
      ).bind(conversationId, characterId, finalCharacterType).run();
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      await logError(error, env, 'Invite Character');
      return new Response('캐릭터 초대에 실패했습니다.', { status: 500 });
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
      
      return new Response(JSON.stringify(results), {
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      await logError(error, env, 'Get Participants');
      return new Response('참여자 목록 조회에 실패했습니다.', { status: 500 });
    }
  }
};
// 대화 제목 업데이트 (사용자 첫 메시지 기준)
export async function updateConversationTitle(conversationId, message, env) {
  try {
    const conversation = await env.DB.prepare(
      'SELECT title FROM conversations WHERE id = ?'
    ).bind(conversationId).first();
    
    // 제목이 없거나 기본 제목인 경우에만 업데이트
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
