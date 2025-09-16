// 플레이그라운드 호감도 시스템 관리
import { logError, verifyJwt } from './utils.js';

// JWT 토큰에서 사용자 정보 추출
async function getUserFromToken(request, env) {
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
    await logError(error, env, 'Affection System: GetUserFromToken');
    return null;
  }
}

// 호감도 범위별 행동지침 반환 (수정됨)
function getAffectionPrompt(level, type) {
    // 음수 범위 - 3단계
    if (level < -50) return "상대를 매우 싫어하며, 적대적이고 공격적인 태도를 보입니다.";
    if (level < -20) return "상대에게 부정적인 감정이 있으며, 차갑고 비판적인 태도를 보입니다.";
    if (level < -10) return "상대에게 약간 부정적인 감정이 있으며, 거리감을 두려고 합니다.";
    
    // 중립 범위 (-10 ~ +10) - 호감도 프롬프트 없음
    if (level >= -10 && level <= 10) return "";
    
    // 양수 범위 - 3단계 (우정/애정 분리 유지)
    if (level < 30) {
      if (type === 'love') return "상대에게 약간의 이성적 호감을 느끼며, 조심스럽게 다가가려고 합니다.";
      return "상대에게 약간의 호감을 느끼며, 친근하게 대하려고 합니다.";
    }
    if (level < 70) {
      if (type === 'love') return "상대에게 확실한 이성적 매력을 느끼며, 애정을 표현하려고 합니다.";
      return "상대와 친구로서 편안함을 느끼며, 긍정적이고 따뜻한 태도를 보입니다.";
    }
    // level >= 70
    if (type === 'love') return "상대를 깊이 사랑하며, 애정 표현을 적극적으로 하고 헌신적인 모습을 보입니다.";
    return "상대와 매우 가까운 친구 사이이며, 깊은 유대감을 느끼고 신뢰를 보입니다.";
}

// 호감도 시스템 프롬프트 생성 (수정됨)
export function generateAffectionPrompt(characterId, affectionLevel, affectionType, userNickname) {
  if (affectionLevel === null || affectionLevel === undefined) {
    return '';
  }

  const behaviorGuide = getAffectionPrompt(affectionLevel, affectionType);
  
  // 중립 범위(-10 ~ +10)에서는 호감도 프롬프트를 전혀 전달하지 않음
  if (behaviorGuide === '') {
    return '';
  }

  let prompt = `
[호감도 정보]
`;
  prompt += `{${userNickname || '사용자'}}에 대한 현재 호감도: ${affectionLevel}
`;
  
  // 호감도가 0 이상일 때만 애정/우정 상태를 프롬프트에 포함
  if (affectionLevel >= 0 && affectionType) {
    const typeText = affectionType === 'love' ? '애정' : '우정';
    prompt += `호감 상태: ${typeText}
`;
  }
  
  prompt += `행동 지침: ${behaviorGuide}`;
  
  return prompt;
}

// 호감도 분석을 위한 Gemini API 호출
async function analyzeAffectionChange(conversationHistory, currentAffection, apiKey) {
  try {
    const prompt = `
다음 대화내역을 분석하여 사용자에 대한 호감도 변화를 판단해주세요.

===대화내역===
${conversationHistory}
======

현재 호감도: ${currentAffection}

이 대화내역을 보고, 사용자에 대한 캐릭터의 호감도를 얼마나 조정할지 숫자로만 답변하세요.
최대 +10, 최소 -10
변화량만 숫자로 답변하세요. (예: +3, -2, 0)

긍정적인 대화는 +, 부정적인 대화는 -, 중립적인 대화는 0으로 판단하세요.
`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 10
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API 오류: ${response.status}`);
    }

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (!result) {
      return 0;
    }

    const match = result.match(/([+-]?\d+)/);
    if (match) {
      const change = parseInt(match[1]);
      return Math.max(-10, Math.min(10, change)); // -10 ~ +10 범위로 제한
    }

    return 0;
  } catch (error) {
    console.error('호감도 분석 실패:', error);
    return 0;
  }
}

// 호감도 자동 업데이트 (수정됨)
export async function updateAffectionAuto(conversationId, characterId, characterType, userMessage, characterResponse, env) {
  try {
    const conversation = await env.DB.prepare(
      'SELECT use_affection_sys FROM conversations WHERE id = ?'
    ).bind(conversationId).first();

    if (!conversation || !conversation.use_affection_sys) {
      return;
    }

    const participant = await env.DB.prepare(
      'SELECT message_count, affection_level FROM conversation_participants WHERE conversation_id = ? AND character_id = ? AND character_type = ?'
    ).bind(conversationId, characterId, characterType).first();

    if (!participant) {
      return;
    }

    const currentMessageCount = participant.message_count || 0;
    const newMessageCount = currentMessageCount + 1;
    const nextUpdateCount = 4; 
    
    if (newMessageCount >= nextUpdateCount) {
      const { results: recentMessages } = await env.DB.prepare(
        `SELECT role, content, character_id, character_type 
         FROM messages 
         WHERE conversation_id = ? 
         ORDER BY created_at DESC 
         LIMIT 20`
      ).bind(conversationId).all();

      const conversationHistory = recentMessages
        .reverse()
        .map(msg => {
          if (msg.role === 'user') return `사용자 : ${msg.content}`;
          if (msg.role === 'assistant' && msg.character_id == characterId && msg.character_type === characterType) return `캐릭터 : ${msg.content}`;
          return null;
        })
        .filter(Boolean)
        .join('\n');

      const conversationOwner = await env.DB.prepare(
        'SELECT u.gemini_api_key FROM conversations c JOIN users u ON c.user_id = u.id WHERE c.id = ?'
      ).bind(conversationId).first();

      const apiKey = conversationOwner?.gemini_api_key || env.GEMINI_API_KEY;
      
      const affectionChange = await analyzeAffectionChange(
        conversationHistory,
        participant.affection_level || 0,
        apiKey
      );

      const newAffection = Math.max(-100, Math.min(100, (participant.affection_level || 0) + affectionChange));

      await env.DB.prepare(
        'UPDATE conversation_participants SET affection_level = ?, message_count = 0 WHERE conversation_id = ? AND character_id = ? AND character_type = ?'
      ).bind(newAffection, conversationId, characterId, characterType).run();

    } else {
      await env.DB.prepare(
        'UPDATE conversation_participants SET message_count = ? WHERE conversation_id = ? AND character_id = ? AND character_type = ?'
      ).bind(newMessageCount, conversationId, characterId, characterType).run();
    }

  } catch (error) {
    await logError(error, env, 'Update Affection Auto');
  }
}

// 호감도 시스템 토글
export async function toggleAffectionSystem(request, env) {
  try {
    const user = await getUserFromToken(request, env);
    if (!user) return new Response('Unauthorized', { status: 401 });

    const { conversationId, useAffectionSys } = await request.json();

    const conversation = await env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) return new Response('Not Found', { status: 404 });

    await env.DB.prepare(
      'UPDATE conversations SET use_affection_sys = ? WHERE id = ?'
    ).bind(useAffectionSys ? 1 : 0, conversationId).run();

    return new Response(JSON.stringify({ success: true, use_affection_sys: useAffectionSys }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    await logError(error, env, 'Toggle Affection System');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 호감도 수동 조절 (수정됨)
export async function adjustAffectionManual(request, env) {
  try {
    const user = await getUserFromToken(request, env);
    if (!user) return new Response('Unauthorized', { status: 401 });

    const { conversationId, characterId, characterType, affectionLevel } = await request.json();

    if (!Number.isInteger(affectionLevel)) {
        return new Response(JSON.stringify({ error: '호감도는 정수여야 합니다.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const conversation = await env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) return new Response('Not Found', { status: 404 });

    const clampedAffection = Math.max(-100, Math.min(100, affectionLevel));

    await env.DB.prepare(
      'UPDATE conversation_participants SET affection_level = ? WHERE conversation_id = ? AND character_id = ? AND character_type = ?'
    ).bind(clampedAffection, conversationId, characterId, characterType).run();

    return new Response(JSON.stringify({ success: true, affection_level: clampedAffection }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    await logError(error, env, 'Adjust Affection Manual');
    return new Response('Internal Server Error', { status: 500 });
  }
}

// 호감도 타입 변경 (신규)
export async function updateAffectionType(request, env) {
    try {
        const user = await getUserFromToken(request, env);
        if (!user) return new Response('Unauthorized', { status: 401 });

        const { conversationId, characterId, characterType, affectionType } = await request.json();

        if (!['friendship', 'love'].includes(affectionType)) {
            return new Response('Invalid affection type', { status: 400 });
        }

        const conversation = await env.DB.prepare(
            'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
        ).bind(conversationId, user.id).first();

        if (!conversation) return new Response('Not Found', { status: 404 });

        await env.DB.prepare(
            'UPDATE conversation_participants SET affection_type = ? WHERE conversation_id = ? AND character_id = ? AND character_type = ?'
        ).bind(affectionType, conversationId, characterId, characterType).run();

        return new Response(JSON.stringify({ success: true, affection_type: affectionType }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        await logError(error, env, 'Update Affection Type');
        return new Response('Internal Server Error', { status: 500 });
    }
}

// 대화 참가자 호감도 정보 조회 (수정됨)
export async function getAffectionStatus(request, env) {
  try {
    const user = await getUserFromToken(request, env);
    if (!user) return new Response('Unauthorized', { status: 401 });

    const url = new URL(request.url);
    const conversationId = url.pathname.split('/')[3];

    const conversation = await env.DB.prepare(
      'SELECT use_affection_sys FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) return new Response('Not Found', { status: 404 });

    const { results: participants } = await env.DB.prepare(
      `SELECT 
        cp.character_id,
        cp.character_type,
        cp.affection_level,
        cp.affection_type,
        CASE 
          WHEN cp.character_type = 'official' THEN c.name
          ELSE uc.name
        END as name,
        CASE 
          WHEN cp.character_type = 'official' THEN c.profile_image
          ELSE '/api/user-characters/image/' || uc.profile_image_r2
        END as profile_image
       FROM conversation_participants cp
       LEFT JOIN characters c ON cp.character_id = c.id AND cp.character_type = 'official'
       LEFT JOIN user_characters uc ON cp.character_id = uc.id AND cp.character_type = 'user' AND uc.deleted_at IS NULL
       WHERE cp.conversation_id = ?
       ORDER BY cp.created_at ASC`
    ).bind(conversationId).all();

    return new Response(JSON.stringify({
      use_affection_sys: conversation.use_affection_sys,
      participants: participants.filter(p => p.name)
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    await logError(error, env, 'Get Affection Status');
    return new Response('Internal Server Error', { status: 500 });
  }
}