// FILE: src/dating.js (Fully Replaced)

import { logError, getUserFromRequest } from './utils.js';
import { datingGemini } from './dating_gemini.js';

function parseLocationFromResponse(responseText) {
    const locationMatch = responseText.match(/^\(([^)]+)에서\)/);
    if (locationMatch && locationMatch[1]) {
        const locationName = locationMatch[1].trim();
        const cleanResponse = responseText.replace(locationMatch[0], '').trim();
        
        const locationMap = { '학교': 'school', '카페': 'cafe', '공원': 'park', '도서관': 'library', '쇼핑몰': 'shopping', '집': 'home' };
        const locationKey = Object.keys(locationMap).find(key => locationMap[key] === locationName.toLowerCase()) || 'online';

        return { location: locationKey, content: cleanResponse, isOffline: true };
    }
    return { location: 'online', content: responseText, isOffline: false };
}

export const handleDating = {
    async getConversations(request, env) {
        try {
            const user = await getUserFromRequest(request, env);
            if (!user) return new Response('Unauthorized', { status: 401 });

            const { results } = await env.DB.prepare(`
                SELECT dc.id, dc.character_id, dc.updated_at,
                       c.name AS character_name, c.profile_image AS character_image,
                       (SELECT content FROM dating_messages WHERE dating_conversation_id = dc.id ORDER BY created_at DESC LIMIT 1) as last_message
                FROM dating_conversations dc
                JOIN dating_characters c ON dc.character_id = c.id
                WHERE dc.user_id = ?
                ORDER BY dc.updated_at DESC
            `).bind(user.id).all();

            const conversationsWithFullPath = results.map(convo => ({
                ...convo,
                character_image: convo.character_image ? `/images/${convo.character_image}` : '/images/characters/default.webp'
            }));

            return new Response(JSON.stringify(conversationsWithFullPath), { headers: { 'Content-Type': 'application/json' } });
        } catch (error) {
            await logError(error, env, 'Dating: GetConversations');
            return new Response('Internal Server Error', { status: 500 });
        }
    },

    async initializeConversation(request, env) {
        try {
            const user = await getUserFromRequest(request, env);
            if (!user) return new Response('Unauthorized', { status: 401 });

            const { characterId } = await request.json();
            
            let conversation = await env.DB.prepare(
                `SELECT id FROM dating_conversations WHERE user_id = ? AND character_id = ?`
            ).bind(user.id, characterId).first();

            if (!conversation) {
                const character = await env.DB.prepare('SELECT name FROM dating_characters WHERE id = ?').bind(characterId).first();
                if(!character) return new Response('Character not found', { status: 404 });

                await env.DB.prepare(
                    `INSERT OR IGNORE INTO user_character_affection (user_id, character_id) VALUES (?, ?)`
                ).bind(user.id, characterId).run();

                const result = await env.DB.prepare(
                    `INSERT INTO dating_conversations (user_id, character_id, title) VALUES (?, ?, ?)`
                ).bind(user.id, characterId, `${character.name}와(과)의 대화`).run();
                
                conversation = { id: result.meta.last_row_id };
            }
            
            return new Response(JSON.stringify({ conversationId: conversation.id }), { headers: { 'Content-Type': 'application/json' } });
        } catch (error) {
            await logError(error, env, 'Dating: Initialize Conversation');
            return new Response('Internal Server Error', { status: 500 });
        }
    },

    async getConversationDetails(request, env, conversationId) {
        try {
            const user = await getUserFromRequest(request, env);
            if (!user) return new Response('Unauthorized', { status: 401 });

            const conversation = await env.DB.prepare(
                `SELECT * FROM dating_conversations WHERE id = ? AND user_id = ?`
            ).bind(conversationId, user.id).first();
            if (!conversation) return new Response('Conversation not found', { status: 404 });

            const affection = await env.DB.prepare(
                `SELECT friendship_level, romantic_level FROM user_character_affection WHERE user_id = ? AND character_id = ?`
            ).bind(user.id, conversation.character_id).first();

            const character = await env.DB.prepare(
                `SELECT name, profile_image FROM dating_characters WHERE id = ?`
            ).bind(conversation.character_id).first();
            
            return new Response(JSON.stringify({
                ...conversation,
                friendship_level: affection?.friendship_level || 50,
                romantic_level: affection?.romantic_level || 50,
                character_name: character?.name,
                character_image: character?.profile_image ? `/images/${character.profile_image}` : '/images/characters/default.webp'
            }), { headers: { 'Content-Type': 'application/json' } });
        } catch (error) {
            await logError(error, env, 'Dating: Get Conversation Details');
            return new Response('Internal Server Error', { status: 500 });
        }
    },

    async getMessages(request, env, conversationId) {
        try {
            const user = await getUserFromRequest(request, env);
            if (!user) return new Response('Unauthorized', { status: 401 });

            const conversation = await env.DB.prepare(
                `SELECT id FROM dating_conversations WHERE id = ? AND user_id = ?`
            ).bind(conversationId, user.id).first();
            if (!conversation) return new Response('Conversation not found', { status: 404 });

            const { results: messages } = await env.DB.prepare(
                `SELECT * FROM dating_messages WHERE dating_conversation_id = ? ORDER BY created_at ASC`
            ).bind(conversationId).all();

            return new Response(JSON.stringify(messages), { headers: { 'Content-Type': 'application/json' } });
        } catch (error) {
            await logError(error, env, 'Dating: Get Messages');
            return new Response('Internal Server Error', { status: 500 });
        }
    },
    
    async handleChat(request, env) {
        try {
            const user = await getUserFromRequest(request, env);
            if (!user) return new Response('Unauthorized', { status: 401 });

            const { conversationId, content } = await request.json();
            const messageTime = getTimeOfDay(); // Get current time of day

            const conversation = await env.DB.prepare(
                `SELECT * FROM dating_conversations WHERE id = ? AND user_id = ?`
            ).bind(conversationId, user.id).first();
            if (!conversation) return new Response('Conversation not found', { status: 404 });

            const lastMessage = await env.DB.prepare(
                `SELECT location, is_offline_meeting FROM dating_messages WHERE dating_conversation_id = ? ORDER BY created_at DESC LIMIT 1`
            ).bind(conversationId).first();

            const currentLocation = lastMessage?.location || 'online';
            const currentOfflineStatus = lastMessage?.is_offline_meeting || 0;

            await env.DB.prepare(`
                INSERT INTO dating_messages (dating_conversation_id, role, content, message_time, location, is_offline_meeting)
                VALUES (?, 'user', ?, ?, ?, ?)
            `).bind(conversationId, content, messageTime, currentLocation, currentOfflineStatus).run();

            const character = await env.DB.prepare('SELECT * FROM dating_characters WHERE id = ?').bind(conversation.character_id).first();
            const affection = await env.DB.prepare('SELECT * FROM user_character_affection WHERE user_id = ? AND character_id = ?').bind(user.id, conversation.character_id).first();

            const rawResponse = await datingGemini.generateCharacterResponse(env, conversation, character, affection, content, messageTime, currentLocation, !!currentOfflineStatus);
            const { location: newLocation, content: cleanResponse, isOffline: newIsOffline } = parseLocationFromResponse(rawResponse);

            const characterMessageResult = await env.DB.prepare(`
                INSERT INTO dating_messages (dating_conversation_id, role, content, message_time, location, is_offline_meeting)
                VALUES (?, 'assistant', ?, ?, ?, ?)
            `).bind(conversationId, cleanResponse, messageTime, newLocation, newIsOffline ? 1 : 0).run();
            
            await env.DB.prepare('UPDATE dating_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(conversationId).run();

            const messageCount = await getMessageCount(env, conversationId);
            let affectionUpdate = null;

            if (messageCount >= conversation.next_affection_update) {
                affectionUpdate = await updateAffectionLevels(env, conversationId, conversation.character_id, user.id);
                const newThreshold = messageCount + Math.floor(Math.random() * 6) + 5;
                await env.DB.prepare(`UPDATE dating_conversations SET next_affection_update = ? WHERE id = ?`).bind(newThreshold, conversationId).run();
            }

            if (messageCount > 0 && messageCount % 10 === 0) {
                await datingGemini.updateCharacterMemory(env, user.id, conversation.character_id, conversationId);
            }

            return new Response(JSON.stringify({
                characterResponse: {
                    id: characterMessageResult.meta.last_row_id, role: 'assistant', content: cleanResponse,
                    message_time: messageTime, location: newLocation, is_offline_meeting: newIsOffline
                },
                affectionUpdate,
            }), { headers: { 'Content-Type': 'application/json' } });
        } catch (error) {
            await logError(error, env, 'Dating: Handle Chat');
            return new Response('Internal Server Error', { status: 500 });
        }
    },

    async getDatingCharacters(request, env) {
        try {
            const user = await getUserFromRequest(request, env);
            if (!user) return new Response('Unauthorized', { status: 401 });

            // 사용자가 아직 대화하지 않는 캐릭터 목록만 가져오기
            const { results: characters } = await env.DB.prepare(`
                SELECT id, name, description, profile_image FROM dating_characters
                WHERE id NOT IN (
                    SELECT character_id FROM dating_conversations WHERE user_id = ?
                )
                ORDER BY name
            `).bind(user.id).all();
            
            const charactersWithFullPath = characters.map(char => ({
                ...char,
                profile_image: char.profile_image ? `/images/${char.profile_image}` : '/images/characters/default.webp'
            }));

            return new Response(JSON.stringify(charactersWithFullPath), { headers: { 'Content-Type': 'application/json' } });
        } catch (error) {
            await logError(error, env, 'Dating: Get Characters');
            return new Response('Internal Server Error', { status: 500 });
        }
    },
};

// Helper Functions
async function updateAffectionLevels(env, conversationId, characterId, userId) {
    try {
        const { results: recentMessages } = await env.DB.prepare(`
            SELECT role, content FROM dating_messages 
            WHERE dating_conversation_id = ? ORDER BY created_at DESC LIMIT 6
        `).bind(conversationId).all();

        const affection = await env.DB.prepare(`
            SELECT friendship_level, romantic_level FROM user_character_affection 
            WHERE user_id = ? AND character_id = ?
        `).bind(userId, characterId).first();
        if (!affection) return null;

        let conversationHistory = recentMessages.reverse().map(msg => 
            `${msg.role === 'user' ? '유저' : '캐릭터'}: ${msg.content}`
        ).join('\n');
        
        const friendshipChange = await datingGemini.analyzeAffectionChange(env, conversationHistory, affection.friendship_level, '우정');
        const romanticChange = await datingGemini.analyzeAffectionChange(env, conversationHistory, affection.romantic_level, '애정');

        const newFriendshipLevel = Math.max(0, Math.min(100, affection.friendship_level + friendshipChange));
        const newRomanticLevel = Math.max(0, Math.min(100, affection.romantic_level + romanticChange));

        await env.DB.prepare(`
            UPDATE user_character_affection 
            SET friendship_level = ?, romantic_level = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND character_id = ?
        `).bind(newFriendshipLevel, newRomanticLevel, userId, characterId).run();

        return {
            friendship_level: newFriendshipLevel, romantic_level: newRomanticLevel,
            friendship_change: friendshipChange, romantic_change: romanticChange
        };
    } catch (error) {
        await logError(error, env, 'Update Affection Levels');
        return null;
    }
}

async function getMessageCount(env, conversationId) {
    try {
        const { count } = await env.DB.prepare(
            `SELECT COUNT(*) as count FROM dating_messages WHERE dating_conversation_id = ?`
        ).bind(conversationId).first();
        return count || 0;
    } catch (error) {
        await logError(error, env, 'Get Message Count');
        return 0;
    }
}

function getTimeOfDay() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return '아침';
    if (hour >= 12 && hour < 18) return '낮';
    if (hour >= 18 && hour < 23) return '밤';
    return '새벽';
}
