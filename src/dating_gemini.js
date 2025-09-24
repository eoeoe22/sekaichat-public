// FILE: src/dating_gemini.js (New File)

import { logError, callGemini } from './utils.js';

function getLocationDisplayName(location) {
    const names = {
        school: '학교', cafe: '카페', park: '공원',
        library: '도서관', shopping: '쇼핑몰', home: '집', online: '온라인'
    };
    return names[location] || location;
}

export const datingGemini = {
    async generateCharacterResponse(env, conversation, character, affection, userMessage, messageTime, location, isOfflineMeeting) {
        try {
            const { results: recentMessages } = await env.DB.prepare(`
                SELECT role, content FROM dating_messages 
                WHERE dating_conversation_id = ? ORDER BY created_at DESC LIMIT 10
            `).bind(conversation.id).all();

            let conversationHistory = recentMessages.reverse().map(msg => 
                `${msg.role === 'user' ? '사용자' : character.name}: ${msg.content}`
            ).join('\n');
            conversationHistory += `\n사용자: ${userMessage}`;

            const contextInfo = `
현재 상황: ${isOfflineMeeting ? `${getLocationDisplayName(location)}에서 오프라인 만남` : '온라인 채팅'}
시간대: ${messageTime}
우정 호감도: ${affection?.friendship_level || 50}
애정 호감도: ${affection?.romantic_level || 50}
캐릭터의 기억 (당신에 대한 생각): ${affection?.character_memory || '아직 사용자에 대한 특별한 기억이 없음'}
`;

            const systemPrompt = `${character.internal_prompt}

[미연시 모드 지침]
- 당신은 미연시 캐릭터로서 사용자와 대화합니다.
- 호감도 시스템이 있으며, 대화에 따라 우정과 애정 호감도가 변화합니다.
- 현재 호감도 수준에 맞는 반응을 보여주세요. (호감도 30 미만: 차가움, 30-49: 경계, 50: 보통, 51-69: 친절, 70 이상: 호감)
- 당신이 좋아하는 것: ${character.likes || '특별히 없음'}
- 당신이 싫어하는 것: ${character.dislikes || '특별히 없음'}
- (중요) 오프라인 만남을 제안하고 싶을 때, 응답 시작 부분에 '(장소에서) ' 형식으로 상황을 묘사하세요. 예: '(카페에서) 응, 좋은 생각이야. 여기서 이야기하자.' 시스템이 이 부분을 자동으로 인식하여 상태를 변경합니다.

${contextInfo}

[최근 대화 기록]
${conversationHistory}

이제 ${character.name}으로서, 위의 모든 상황과 감정을 고려하여 자연스럽게 응답하세요. 응답은 당신의 대사만 포함해야 합니다.`;
            
            const body = {
                contents: [{ parts: [{ text: systemPrompt }] }],
                generationConfig: { temperature: 0.8, maxOutputTokens: 500 }
            };

            const data = await callGemini('gemini-2.5-flash', env.GEMINI_API_KEY, body, env, 'DatingGemini: generateCharacterResponse');
            return data.candidates[0].content.parts[0].text.trim();

        } catch (error) {
            await logError(error, env, 'DatingGemini: generateCharacterResponse');
            return '...지금은 무슨 말을 해야 할지 잘 모르겠어.';
        }
    },

    async analyzeAffectionChange(env, conversationHistory, currentLevel, affectionType) {
        try {
            const prompt = `주어진 대화 내역을 바탕으로, 사용자에 대한 캐릭터의 '${affectionType}' 호감도 변화를 -5에서 +5 사이의 정수 하나로만 평가해줘.
            
[현재 호감도]
${currentLevel}

[대화 내역]
${conversationHistory}

[평가 (숫자만 응답)]`;

            const body = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 5 }
            };

            const data = await callGemini('gemini-2.5-flash', env.GEMINI_API_KEY, body, env, `DatingGemini: analyzeAffectionChange (${affectionType})`);
            const changeText = data.candidates[0].content.parts[0].text.trim();
            const change = parseInt(changeText.match(/-?\d+/)?.[0] || '0');
            
            return Math.max(-5, Math.min(5, isNaN(change) ? 0 : change));
        } catch (error) {
            await logError(error, env, `DatingGemini: analyzeAffectionChange (${affectionType})`);
            return 0;
        }
    },

    async updateCharacterMemory(env, userId, characterId, conversationId) {
        try {
            const currentAffection = await env.DB.prepare(`
                SELECT character_memory FROM user_character_affection 
                WHERE user_id = ? AND character_id = ?
            `).bind(userId, characterId).first();

            const { results: recentMessages } = await env.DB.prepare(`
                SELECT role, content FROM dating_messages 
                WHERE dating_conversation_id = ? ORDER BY created_at DESC LIMIT 20
            `).bind(conversationId).all();

            const character = await env.DB.prepare(`
                SELECT internal_prompt FROM dating_characters WHERE id = ?
            `).bind(characterId).first();

            if (!character) return;
            
            const conversationHistory = recentMessages.reverse().map(msg =>
                `${msg.role === 'user' ? '유저' : '캐릭터'}: ${msg.content}`
            ).join('\n');

            const prompt = `당신은 미연시 캐릭터입니다. 다음 정보를 바탕으로 사용자에 대한 당신의 생각과 기억을 요약하고 업데이트하세요.

[캐릭터 설정]
${character.internal_prompt}

[기존 기억]
${currentAffection?.character_memory || '아직 특별한 기억이 없음'}

[최근 대화 내역]
${conversationHistory}

[지침]
- 기존 기억을 바탕으로, 최근 대화에서 있었던 중요한 사건이나 감정 변화를 반영하여 기억을 갱신합니다.
- 당신의 입장에서 사용자에 대한 생각과 인상을 1인칭 시점으로 간결하게 서술합니다.
- 전체 내용은 200자 이내로 요약합니다.

[업데이트된 기억]`;

            const body = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
            };

            const data = await callGemini('gemini-2.5-flash', env.GEMINI_API_KEY, body, env, 'DatingGemini: updateCharacterMemory');
            const newMemory = data.candidates[0].content.parts[0].text.trim();

            await env.DB.prepare(`
                UPDATE user_character_affection 
                SET character_memory = ?, last_memory_update = CURRENT_TIMESTAMP
                WHERE user_id = ? AND character_id = ?
            `).bind(newMemory, userId, characterId).run();

        } catch (error) {
            await logError(error, env, 'DatingGemini: updateCharacterMemory');
        }
    }
};
