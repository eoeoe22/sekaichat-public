import { generateSalt, hashPassword, verifyPassword, logError, verifyJwt } from './utils.js';

async function getKanadeUserFromToken(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    const token = authHeader.substring(7);

    try {
        const tokenData = JSON.parse(atob(token));
        if (tokenData.exp < Date.now()) {
            return null;
        }
        const user = await env.KANADE_DB.prepare('SELECT * FROM users WHERE id = ?').bind(tokenData.userId).first();
        return user;
    } catch (e) {
        return null;
    }
}

async function getSekaiUserFromRequest(request, env) {
    try {
        const cookies = request.headers.get('Cookie');
        if (!cookies) return null;
        
        const tokenMatch = cookies.match(/token=([^;]+)/);
        if (!tokenMatch) return null;
        
        const token = tokenMatch[1];
        const tokenData = await verifyJwt(token, env);
        if (!tokenData) return null;
        
        const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
          .bind(tokenData.userId).first();
        
        return user;
    } catch (error) {
        await logError(error, env, 'Migration: GetSekaiUserFromRequest');
        return null;
    }
}

export const handleMigration = {
    async kanadeLogin(request, env) {
        try {
            const { username, password } = await request.json();

            const user = await env.KANADE_DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();

            if (!user || !(await verifyPassword(password, user.password_hash, user.salt))) {
                return new Response('카나데 계정 정보가 올바르지 않습니다.', { status: 401 });
            }

            const token = btoa(JSON.stringify({
                userId: user.id,
                exp: Date.now() + (60 * 60 * 1000), // 1시간
            }));

            return new Response(JSON.stringify({ success: true, token }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            await logError(error, env, 'Kanade Login');
            return new Response('로그인 중 오류가 발생했습니다.', { status: 500 });
        }
    },

    async getKanadeConversations(request, env) {
        try {
            const kanadeUser = await getKanadeUserFromToken(request, env);
            if (!kanadeUser) {
                return new Response('카나데 계정 인증에 실패했습니다.', { status: 401 });
            }

            const { results } = await env.KANADE_DB.prepare(
                'SELECT id, title FROM conversations WHERE user_id = ? ORDER BY created_at DESC'
            ).bind(kanadeUser.id).all();

            return new Response(JSON.stringify(results || []), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            await logError(error, env, 'Get Kanade Conversations');
            return new Response('대화내역 조회 중 오류가 발생했습니다.', { status: 500 });
        }
    },

    async getKanadeConversationPreview(request, env, params) {
        try {
            const kanadeUser = await getKanadeUserFromToken(request, env);
            if (!kanadeUser) {
                return new Response('카나데 계정 인증에 실패했습니다.', { status: 401 });
            }

            const conversationId = params.id;
            if (!conversationId) {
                return new Response('대화 ID가 필요합니다.', { status: 400 });
            }

            // Check if the conversation belongs to the user
            const conversation = await env.KANADE_DB.prepare(
                'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
            ).bind(conversationId, kanadeUser.id).first();

            if (!conversation) {
                return new Response('해당 대화를 찾을 수 없거나 접근 권한이 없습니다.', { status: 404 });
            }

            const { results: messages } = await env.KANADE_DB.prepare(
                'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
            ).bind(conversationId).all();

            return new Response(JSON.stringify(messages || []), {
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            await logError(error, env, 'Get Kanade Conversation Preview');
            return new Response('대화 미리보기를 불러오는 중 오류가 발생했습니다.', { status: 500 });
        }
    },

    async startMigration(request, env) {
        try {
            const sekaiUser = await getSekaiUserFromRequest(request, env);
            if (!sekaiUser) {
                return new Response('세카이챗 로그인이 필요합니다.', { status: 401 });
            }

            const kanadeUser = await getKanadeUserFromToken(request, env);
            if (!kanadeUser) {
                return new Response('카나데 계정 인증에 실패했습니다.', { status: 401 });
            }

            const { conversationIds } = await request.json();
            if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
                return new Response('이전할 대화 ID 목록이 필요합니다.', { status: 400 });
            }

            let migratedCount = 0;
            for (const convId of conversationIds) {
                const conversation = await env.KANADE_DB.prepare(
                    'SELECT * FROM conversations WHERE id = ? AND user_id = ?'
                ).bind(convId, kanadeUser.id).first();

                if (!conversation) continue;

                const newConvResult = await env.DB.prepare(
                    'INSERT INTO conversations (user_id, title, created_at) VALUES (?, ?, ?)'
                ).bind(sekaiUser.id, `(이전됨) ${conversation.title}`, conversation.created_at).run();
                
                const newConvId = newConvResult.meta.last_row_id;

                const { results: messages } = await env.KANADE_DB.prepare(
                    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
                ).bind(convId).all();

                for (const msg of messages) {
                    let characterId = null;
                    let characterType = 'official'; // Default to 'official' for user messages as well

                    if (msg.role === 'assistant') {
                        characterId = 1; // Kanade character ID in sekai_chat
                        characterType = 'official';
                    }
                    
                    await env.DB.prepare(
                        'INSERT INTO messages (conversation_id, role, content, character_id, character_type, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
                    ).bind(newConvId, msg.role, msg.content, characterId, characterType, msg.created_at, sekaiUser.id).run();
                }
                
                // Add Kanade as a participant
                await env.DB.prepare(
                    'INSERT INTO conversation_participants (conversation_id, character_id, character_type) VALUES (?, ?, ?)'
                ).bind(newConvId, 1, 'official').run();


                migratedCount++;
            }

            return new Response(JSON.stringify({
                success: true,
                total: conversationIds.length,
                migrated: migratedCount
            }), {
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            await logError(error, env, 'Start Migration');
            return new Response(JSON.stringify({ error: '이전 중 심각한 오류가 발생했습니다.' }), { status: 500 });
        }
    }
};
