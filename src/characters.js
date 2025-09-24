import { logError, logDebug } from './utils.js';

// 캐릭터 관련 API 핸들러
export const handleCharacters = {
  // 전체 캐릭터 목록 조회
  async getAll(request, env) {
    try {
      const { results } = await env.DB.prepare(
        'SELECT id, name, nickname, profile_image, sekai, name_code FROM characters ORDER BY id ASC'
      ).all();
      
      return new Response(JSON.stringify(results || []), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Get All Characters');
      return new Response('으....이....', { status: 500 });
    }
  },

  // 특정 캐릭터 정보 조회
  async getById(request, env, characterId) {
    try {
      const character = await env.DB.prepare(
        'SELECT id, name, nickname, profile_image, system_prompt FROM characters WHERE id = ?'
      ).bind(characterId).first();
      
      if (!character) {
        return new Response('으....이....', { status: 404 });
      }
      
      return new Response(JSON.stringify(character), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Get Character By ID');
      return new Response('으....이....', { status: 500 });
    }
  }
};

// 캐릭터 이름으로 ID 조회
export async function getCharacterIdByName(characterName, env) {
  try {
    const character = await env.DB.prepare(
      'SELECT id FROM characters WHERE name = ? OR nickname = ?'
    ).bind(characterName, characterName).first();
    
    return character?.id || null;
  } catch (error) {
    await logError(error, env, 'Get Character ID By Name');
    return null;
  }
}

// 캐릭터 시스템 프롬프트 조회
export async function getCharacterPrompt(characterId, env) {
  try {
    const character = await env.DB.prepare(
      'SELECT system_prompt FROM characters WHERE id = ?'
    ).bind(characterId).first();
    
    return character?.system_prompt || null;
  } catch (error) {
    await logError(error, env, 'Get Character Prompt');
    return null;
  }
}
