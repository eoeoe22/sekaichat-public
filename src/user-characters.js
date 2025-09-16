import { logError, verifyJwt } from './utils.js';

// 사용자 인증 확인 함수
async function getUserFromRequest(request, env) {
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
    await logError(error, env, 'UserCharacters: GetUserFromRequest');
    return null;
  }
}

// 사용자 정의 캐릭터 API 핸들러
export const handleUserCharacters = {
  // 사용자 캐릭터 목록 조회
  async getAll(request, env) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) return new Response('Unauthorized', { status: 401 });
      
      const { results } = await env.DB.prepare(`
        SELECT id, name, description, system_prompt, profile_image_r2, created_at
        FROM user_characters 
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC
      `).bind(user.id).all();
      
      return new Response(JSON.stringify(results || []), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Get User Characters');
      return new Response('서버 오류', { status: 500 });
    }
  },

  // 새 캐릭터 생성
  async create(request, env) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) return new Response('Unauthorized', { status: 401 });
      
      const userCharacterCount = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM user_characters WHERE user_id = ? AND deleted_at IS NULL'
      ).bind(user.id).first();
      
      if (userCharacterCount.count >= 5) {
        return new Response('캐릭터 생성 한도(5개)를 초과했습니다.', { status: 400 });
      }
      
      const { name, description, systemPrompt, profileImageR2 } = await request.json();
      
      if (!name || !description || !systemPrompt || !profileImageR2) {
        return new Response('필수 정보가 누락되었습니다.', { status: 400 });
      }
      
      if (name.length > 50 || description.length > 100 || systemPrompt.length > 5000) {
        return new Response('입력 길이가 제한을 초과했습니다.', { status: 400 });
      }
      
      const maxIdResult = await env.DB.prepare(
        'SELECT MAX(id) as max_id FROM user_characters'
      ).first();
      const newId = (maxIdResult?.max_id || 10000) + 1;

      await env.DB.prepare(`
        INSERT INTO user_characters (id, user_id, name, description, system_prompt, profile_image_r2)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(newId, user.id, name, description, systemPrompt, profileImageR2).run();
      
      return new Response(JSON.stringify({ id: newId, success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Create User Character');
      return new Response('캐릭터 생성에 실패했습니다.', { status: 500 });
    }
  },

  // 캐릭터 수정
  async update(request, env, characterId) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) return new Response('Unauthorized', { status: 401 });
      
      const character = await env.DB.prepare(
        'SELECT id, profile_image_r2 FROM user_characters WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
      ).bind(characterId, user.id).first();
      
      if (!character) {
        return new Response('캐릭터를 찾을 수 없거나 수정 권한이 없습니다.', { status: 404 });
      }
      
      const { name, description, systemPrompt, profileImageR2 } = await request.json();
      
      if (!name || !description || !systemPrompt) {
        return new Response('필수 정보가 누락되었습니다.', { status: 400 });
      }
      
      if (name.length > 50 || description.length > 100 || systemPrompt.length > 5000) {
        return new Response('입력 길이가 제한을 초과했습니다.', { status: 400 });
      }
      
      await env.DB.prepare(`
        UPDATE user_characters 
        SET name = ?, description = ?, system_prompt = ?, profile_image_r2 = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(name, description, systemPrompt, profileImageR2 || character.profile_image_r2, characterId).run();
        
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Update User Character');
      return new Response('캐릭터 수정에 실패했습니다.', { status: 500 });
    }
  },

  // 캐릭터 삭제
  async delete(request, env, characterId) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) return new Response('Unauthorized', { status: 401 });
      
      const character = await env.DB.prepare(
        'SELECT profile_image_r2 FROM user_characters WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
      ).bind(characterId, user.id).first();
      
      if (!character) {
        return new Response('캐릭터를 찾을 수 없거나 삭제 권한이 없습니다.', { status: 404 });
      }
      
      try {
        if (character.profile_image_r2) {
          await env.R2.delete(character.profile_image_r2);
        }
      } catch (r2Error) {
        console.error('R2 이미지 삭제 실패:', r2Error);
      }
      
      await env.DB.prepare(
        'UPDATE user_characters SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(characterId).run();
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Delete User Character');
      return new Response('캐릭터 삭제에 실패했습니다.', { status: 500 });
    }
  },
};

// 캐릭터 프로필 이미지 업로드
export async function uploadCharacterImage(request, env) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return new Response('Unauthorized', { status: 401 });
    
    const formData = await request.formData();
    const file = formData.get('file');
    
    if (!file) return new Response('파일이 필요합니다.', { status: 400 });
    
    const allowedTypes = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
    if (!allowedTypes[file.type]) {
      return new Response('png, jpg, webp 파일만 허용됩니다.', { status: 400 });
    }
    
    if (file.size > 2 * 1024 * 1024) { // 2MB
      return new Response('파일 크기는 2MB를 초과할 수 없습니다.', { status: 400 });
    }
    
    const arrayBuffer = await file.arrayBuffer();
    const ext = allowedTypes[file.type];
    const key = `image_uploads/characters/${crypto.randomUUID()}.${ext}`;
    
    await env.R2.put(key, arrayBuffer, {
      httpMetadata: { contentType: file.type }
    });
    
    return new Response(JSON.stringify({ key }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Upload Character Image');
    return new Response('이미지 업로드에 실패했습니다.', { status: 500 });
  }
}

// 확장된 캐릭터 목록 (공식 + 내 캐릭터)
export async function getExtendedCharacterList(request, env) {
  try {
    const user = await getUserFromRequest(request, env);
    const userId = user?.id;

    const officialCharsQuery = `
        SELECT c.id, c.name, c.profile_image, c.sekai, 'official' as category 
        FROM characters c
        LEFT JOIN user_sekai_preferences usp ON c.sekai = usp.sekai AND usp.user_id = ?
        WHERE c.sekai IS NULL OR usp.visible IS NULL OR usp.visible = 1
        ORDER BY c.id ASC
    `;

    const { results: officialChars } = await env.DB.prepare(officialCharsQuery).bind(userId || 0).all();
    
    let userChars = [];
    if (user) {
        const userCharsQuery = `
            SELECT uc.id, uc.name, uc.profile_image_r2 as profile_image, uc.sekai, 'my_character' as category
            FROM user_characters uc
            WHERE uc.user_id = ? AND uc.deleted_at IS NULL
            ORDER BY uc.name ASC
        `;
        const { results } = await env.DB.prepare(userCharsQuery).bind(userId).all();
        userChars = results;
    }
    
    const allowedIdsString = env.IMAGE_GENERATION_CHARACTERS || '3,8';
    const allowedIds = new Set(allowedIdsString.split(',').map(id => parseInt(id.trim())));
    
    const allCharacters = [
      ...officialChars.map(char => ({
        ...char,
        profile_image: char.profile_image,
        is_user_character: false,
        supports_image_generation: allowedIds.has(char.id)
      })),
      ...userChars.map(char => ({
        ...char,
        profile_image: `/api/user-characters/image/${char.profile_image}`,
        is_user_character: true,
        supports_image_generation: true
      }))
    ];
    
    return new Response(JSON.stringify(allCharacters), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Get Extended Character List');
    return new Response('캐릭터 목록 조회에 실패했습니다.', { status: 500 });
  }
}

// 사용자 정의 캐릭터 이미지 서빙
export async function serveUserCharacterImage(request, env, imageKey) {
  try {
    const object = await env.R2.get(imageKey);
    
    if (!object) {
      return new Response('이미지를 찾을 수 없습니다.', { status: 404 });
    }
    
    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata.contentType || 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=31536000');
    
    return new Response(object.body, { headers });
  } catch (error) {
    await logError(error, env, 'Serve User Character Image');
    return new Response('이미지 로드에 실패했습니다.', { status: 500 });
  }
}

// 사용자 정의 캐릭터 정보 조회 (확장)
export async function getExtendedCharacterById(request, env, characterId) {
  try {
    const user = await getUserFromRequest(request, env);
    const userId = user?.id || 0;
    
    const isUserChar = characterId >= 10000;
    
    let character;
    
    if (isUserChar) {
      // 사용자가 만든 캐릭터는 본인만 조회 가능
      if (!user) return new Response('Unauthorized', { status: 401 });
      
      character = await env.DB.prepare(`
        SELECT id, name, description, profile_image_r2 as profile_image, system_prompt,
               (user_id = ?) as is_owner
        FROM user_characters 
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
      `).bind(userId, characterId, userId).first();
      
      if (character) {
        character.profile_image = `/api/user-characters/image/${character.profile_image}`;
        character.is_user_character = true;
      }
    } else {
      // 공식 캐릭터는 누구나 조회 가능
      character = await env.DB.prepare(
        'SELECT id, name, profile_image, system_prompt FROM characters WHERE id = ?'
      ).bind(characterId).first();
      
      if (character) {
        character.is_user_character = false;
        character.is_owner = 0; // 공식 캐릭터는 소유자가 없음
      }
    }
    
    if (!character) {
      return new Response('캐릭터를 찾을 수 없습니다.', { status: 404 });
    }
    
    return new Response(JSON.stringify(character), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Get Extended Character By ID');
    return new Response('캐릭터 정보 조회에 실패했습니다.', { status: 500 });
  }
}

// 캐릭터 시스템 프롬프트 조회 (확장)
export async function getExtendedCharacterPrompt(characterId, env) {
  try {
    const isUserChar = characterId >= 10000;
    let prompt = null;
    
    if (isUserChar) {
      const character = await env.DB.prepare(
        'SELECT system_prompt FROM user_characters WHERE id = ? AND deleted_at IS NULL'
      ).bind(characterId).first();
      prompt = character?.system_prompt;
    } else {
      const character = await env.DB.prepare(
        'SELECT system_prompt FROM characters WHERE id = ?'
      ).bind(characterId).first();
      prompt = character?.system_prompt;
    }
    
    return prompt;
  } catch (error) {
    await logError(error, env, 'Get Extended Character Prompt');
    return null;
  }
}