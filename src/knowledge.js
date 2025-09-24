import { logError } from './utils.js';

// 모든 지식 목록 가져오기
export async function getAllKnowledge(request, env) {
    try {
        const { results } = await env.DB.prepare('SELECT id, title, content, keywords FROM knowledge_base ORDER BY title ASC').all();
        return new Response(JSON.stringify(results || []), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        await logError(error, env, 'GetAllKnowledge');
        return new Response('지식 목록을 가져오는 데 실패했습니다.', { status: 500 });
    }
}

// 메시지에서 키워드 확인
export async function checkKeywords(request, env, conversationId) {
    try {
        const { message } = await request.json();
        if (!message) {
            return new Response('메시지가 필요합니다.', { status: 400 });
        }

        // 현재 대화에 적용된 지식 ID 가져오기
        const conversation = await env.DB.prepare('SELECT knowledge_ids FROM conversations WHERE id = ?').bind(conversationId).first();
        const appliedKnowledgeIds = conversation ? JSON.parse(conversation.knowledge_ids || '[]') : [];

        // 모든 지식 가져오기
        const { results: allKnowledge } = await env.DB.prepare('SELECT id, title, keywords FROM knowledge_base').all();

        const matches = [];
        if (allKnowledge) {
            for (const knowledge of allKnowledge) {
                // 이미 적용된 지식은 건너뛰기
                if (appliedKnowledgeIds.includes(knowledge.id)) {
                    continue;
                }

                const keywords = knowledge.keywords.split(',').map(k => k.trim()).filter(Boolean);
                const foundKeyword = keywords.some(keyword => message.includes(keyword));

                if (foundKeyword) {
                    matches.push({
                        id: knowledge.id,
                        title: knowledge.title,
                    });
                }
            }
        }

        return new Response(JSON.stringify(matches), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        await logError(error, env, 'CheckKeywords');
        return new Response('키워드 확인 중 오류가 발생했습니다.', { status: 500 });
    }
}

// 대화에 지식 적용/해제
export async function updateConversationKnowledge(request, env, conversationId) {
    try {
        const { knowledgeId, action } = await request.json(); // action: 'add' or 'remove'

        const conversation = await env.DB.prepare('SELECT knowledge_ids FROM conversations WHERE id = ?').bind(conversationId).first();
        if (!conversation) {
            return new Response('대화를 찾을 수 없습니다.', { status: 404 });
        }

        let knowledgeIds = JSON.parse(conversation.knowledge_ids || '[]');

        if (action === 'add') {
            if (!knowledgeIds.includes(knowledgeId)) {
                knowledgeIds.push(knowledgeId);
            }
        } else if (action === 'remove') {
            knowledgeIds = knowledgeIds.filter(id => id !== knowledgeId);
        } else {
            return new Response('잘못된 요청입니다.', { status: 400 });
        }

        await env.DB.prepare('UPDATE conversations SET knowledge_ids = ? WHERE id = ?')
            .bind(JSON.stringify(knowledgeIds), conversationId).run();
            
        // 캐시 무효화
        const cacheKey = `chat_history:${conversationId}`;
        await env.KV.delete(cacheKey);

        return new Response(JSON.stringify({ success: true, knowledge_ids: knowledgeIds }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        await logError(error, env, 'UpdateConversationKnowledge');
        return new Response('지식 적용 중 오류가 발생했습니다.', { status: 500 });
    }
}
