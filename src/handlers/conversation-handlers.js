import { logError, getUserFromRequest } from '../utils.js';

export async function handleConversations(request, env) {
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

export async function createConversation(request, env) {
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

export async function getConversationMessages(request, env, conversationId) {
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

export async function toggleConversationFavorite(request, env, conversationId) {
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

export async function updateConversationTitle(request, env, conversationId) {
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

export async function updateWorkMode(request, env, conversationId) {
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

export async function updateShowTime(request, env, conversationId) {
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

export async function updateSituationPrompt(request, env, conversationId) {
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

        const { situationPrompt } = await request.json();
        const trimmedPrompt = situationPrompt ? situationPrompt.trim().substring(0, 10000) : '';

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

export async function updateAutoReplyMode(request, env, conversationId) {
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

export async function deleteMessage(request, env, messageId) {
    try {
        const user = await getUserFromRequest(request, env);
        if (!user) {
            return new Response('Unauthorized', { status: 401 });
        }

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

        if (message.message_type === 'image' && message.file_id) {
            try {
                const fileInfo = await env.DB.prepare('SELECT r2_key FROM files WHERE id = ?')
                    .bind(message.file_id).first();

                if (fileInfo && fileInfo.r2_key) {
                    await env.R2.delete(fileInfo.r2_key);
                    await env.DB.prepare('DELETE FROM files WHERE id = ?')
                        .bind(message.file_id).run();
                }
            } catch (r2Error) {
                console.error('R2 파일 삭제 실패:', r2Error);
            }
        }

        await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(messageId).run();

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

export async function deleteConversation(request, env, conversationId) {
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

export async function toggleAutoragMemory(request, env) {
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
