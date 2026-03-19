import { logError, getUserFromRequest, jsonResponse, errorResponse } from '../utils.js';

// 인증 + 대화방 소유권 확인 헬퍼
async function requireConversationOwner(request, env, conversationId, selectColumns = 'id') {
    const user = await getUserFromRequest(request, env);
    if (!user) return { error: errorResponse('Unauthorized', 401) };

    const conversation = await env.DB.prepare(
        `SELECT ${selectColumns} FROM conversations WHERE id = ? AND user_id = ?`
    ).bind(conversationId, user.id).first();

    if (!conversation) return { error: errorResponse('Not Found', 404) };

    return { user, conversation };
}

export async function handleConversations(request, env) {
    try {
        const user = await getUserFromRequest(request, env);
        if (!user) return errorResponse('Unauthorized', 401);

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

        const conversations = results.map(conv => ({
            ...conv,
            participant_images: conv.participant_images ? conv.participant_images.split(',') : []
        }));

        return jsonResponse(conversations || []);
    } catch (error) {
        await logError(error, env, 'Handle Conversations');
        return errorResponse('Internal Server Error');
    }
}

export async function createConversation(request, env) {
    try {
        const user = await getUserFromRequest(request, env);
        if (!user) return errorResponse('Unauthorized', 401);

        const { title } = await request.json();
        const conversationTitle = title || `대화 ${Date.now()}`;

        const result = await env.DB.prepare(
            'INSERT INTO conversations (user_id, title) VALUES (?, ?) RETURNING id'
        ).bind(user.id, conversationTitle).first();

        return jsonResponse({ id: result.id, title: conversationTitle });
    } catch (error) {
        await logError(error, env, 'Create Conversation');
        return errorResponse('Internal Server Error');
    }
}

export async function getConversationMessages(request, env, conversationId) {
    try {
        const { error, conversation } = await requireConversationOwner(
            request, env, conversationId,
            'work_mode, show_time_info, situation_prompt, auto_reply_mode_enabled, use_autorag_memory'
        );
        if (error) return error;

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

        return jsonResponse({
            messages: results || [],
            work_mode: conversation.work_mode,
            show_time_info: conversation.show_time_info !== undefined ? conversation.show_time_info : 1,
            situation_prompt: conversation.situation_prompt || '',
            auto_reply_mode_enabled: conversation.auto_reply_mode_enabled || 0,
            use_autorag_memory: conversation.use_autorag_memory || 0
        });
    } catch (error) {
        await logError(error, env, 'Get Conversation Messages');
        return errorResponse('Internal Server Error');
    }
}

export async function toggleConversationFavorite(request, env, conversationId) {
    try {
        const { error, conversation } = await requireConversationOwner(request, env, conversationId, 'is_favorite');
        if (error) return error;

        const newFavoriteStatus = conversation.is_favorite ? 0 : 1;

        await env.DB.prepare(
            'UPDATE conversations SET is_favorite = ? WHERE id = ?'
        ).bind(newFavoriteStatus, conversationId).run();

        return jsonResponse({ success: true, is_favorite: newFavoriteStatus });
    } catch (error) {
        await logError(error, env, 'Toggle Conversation Favorite');
        return errorResponse('Internal Server Error');
    }
}

export async function updateConversationTitle(request, env, conversationId) {
    try {
        const { error } = await requireConversationOwner(request, env, conversationId);
        if (error) return error;

        const { title } = await request.json();

        if (!title || title.trim().length === 0) {
            return errorResponse('제목이 필요합니다.', 400);
        }

        const trimmedTitle = title.trim().substring(0, 100);

        await env.DB.prepare(
            'UPDATE conversations SET title = ? WHERE id = ?'
        ).bind(trimmedTitle, conversationId).run();

        return jsonResponse({ success: true, title: trimmedTitle });
    } catch (error) {
        await logError(error, env, 'Update Conversation Title');
        return errorResponse('Internal Server Error');
    }
}

export async function updateWorkMode(request, env, conversationId) {
    try {
        const { error } = await requireConversationOwner(request, env, conversationId);
        if (error) return error;

        const { workMode } = await request.json();

        await env.DB.prepare(
            'UPDATE conversations SET work_mode = ? WHERE id = ?'
        ).bind(workMode ? 1 : 0, conversationId).run();

        return jsonResponse({ success: true, work_mode: workMode ? 1 : 0 });
    } catch (error) {
        await logError(error, env, 'Update Work Mode');
        return errorResponse('Internal Server Error');
    }
}

export async function updateShowTime(request, env, conversationId) {
    try {
        const { error } = await requireConversationOwner(request, env, conversationId);
        if (error) return error;

        const { showTime } = await request.json();

        await env.DB.prepare(
            'UPDATE conversations SET show_time_info = ? WHERE id = ?'
        ).bind(showTime ? 1 : 0, conversationId).run();

        return jsonResponse({ success: true, show_time_info: showTime ? 1 : 0 });
    } catch (error) {
        await logError(error, env, 'Update Show Time');
        return errorResponse('Internal Server Error');
    }
}

export async function updateSituationPrompt(request, env, conversationId) {
    try {
        const { error } = await requireConversationOwner(request, env, conversationId);
        if (error) return error;

        const { situationPrompt } = await request.json();
        const trimmedPrompt = situationPrompt ? situationPrompt.trim().substring(0, 10000) : '';

        await env.DB.prepare(
            'UPDATE conversations SET situation_prompt = ? WHERE id = ?'
        ).bind(trimmedPrompt, conversationId).run();

        return jsonResponse({ success: true, situation_prompt: trimmedPrompt });
    } catch (error) {
        await logError(error, env, 'Update Situation Prompt');
        return errorResponse('Internal Server Error');
    }
}

export async function updateAutoReplyMode(request, env, conversationId) {
    try {
        const { error } = await requireConversationOwner(request, env, conversationId);
        if (error) return error;

        const { autoReplyMode } = await request.json();

        await env.DB.prepare(
            'UPDATE conversations SET auto_reply_mode_enabled = ? WHERE id = ?'
        ).bind(autoReplyMode ? 1 : 0, conversationId).run();

        return jsonResponse({ success: true, auto_reply_mode_enabled: autoReplyMode ? 1 : 0 });
    } catch (error) {
        await logError(error, env, 'Update Auto Reply Mode');
        return errorResponse('Internal Server Error');
    }
}

export async function deleteMessage(request, env, messageId) {
    try {
        const user = await getUserFromRequest(request, env);
        if (!user) return errorResponse('Unauthorized', 401);

        const message = await env.DB.prepare(`
      SELECT m.*, c.user_id
      FROM messages m
      LEFT JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ?
    `).bind(messageId).first();

        if (!message) return errorResponse('메시지를 찾을 수 없습니다.', 404);
        if (message.user_id !== user.id) return errorResponse('Forbidden', 403);

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

        return jsonResponse({ success: true });
    } catch (error) {
        await logError(error, env, 'Delete Message');
        return errorResponse('Internal Server Error');
    }
}

export async function deleteConversation(request, env, conversationId) {
    try {
        const { error, conversation } = await requireConversationOwner(request, env, conversationId, 'is_favorite');
        if (error) return error;

        if (conversation.is_favorite) {
            return errorResponse('즐겨찾기 대화는 삭제할 수 없습니다.', 400);
        }

        await env.DB.prepare('DELETE FROM conversation_participants WHERE conversation_id = ?')
            .bind(conversationId).run();
        await env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?')
            .bind(conversationId).run();
        await env.DB.prepare('DELETE FROM conversations WHERE id = ?')
            .bind(conversationId).run();

        return jsonResponse({ success: true });
    } catch (error) {
        await logError(error, env, 'Delete Conversation');
        return errorResponse('Internal Server Error');
    }
}

export async function toggleAutoragMemory(request, env) {
    try {
        const user = await getUserFromRequest(request, env);
        if (!user) return errorResponse('Unauthorized', 401);

        const { conversationId, useAutoragMemory } = await request.json();

        if (!conversationId) return errorResponse('대화 ID가 필요합니다.', 400);

        const conversation = await env.DB.prepare(
            'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
        ).bind(conversationId, user.id).first();

        if (!conversation) return errorResponse('대화를 찾을 수 없습니다.', 404);

        await env.DB.prepare(
            'UPDATE conversations SET use_autorag_memory = ? WHERE id = ?'
        ).bind(useAutoragMemory ? 1 : 0, conversationId).run();

        return jsonResponse({ success: true, use_autorag_memory: useAutoragMemory ? 1 : 0 });
    } catch (error) {
        await logError(error, env, 'Toggle AutoRAG Memory');
        return errorResponse('AutoRAG 메모리 설정 변경에 실패했습니다.');
    }
}
