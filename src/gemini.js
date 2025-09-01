import { logError, verifyJwt } from './utils.js';
import { generateAffectionPrompt, updateAffectionAuto } from './affection-system.js';

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
    await logError(error, env, 'Gemini: GetUserFromToken');
    return null;
  }
}

// 현재 서울 시간 반환
function getCurrentSeoulTime() {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
}

// 이미지 생성 지원 캐릭터 확인
async function supportsImageGeneration(characterId, characterType, env) {
  try {
    // Official characters: ID 3 or 8
    if (characterType === 'official') {
      const allowedIds = env.IMAGE_GENERATION_CHARACTERS.split(',').map(id => parseInt(id.trim()));
      return allowedIds.includes(characterId);
    }
    
    // Custom user characters: ID >= 10000 and exists in user_characters table
    if (characterType === 'user') {
      if (characterId < 10000) return false;
      
      const exists = await env.DB.prepare(
        'SELECT id FROM user_characters WHERE id = ? AND deleted_at IS NULL'
      ).bind(characterId).first();
      
      return !!exists;
    }
    
    return false;
  } catch (error) {
    await logError(error, env, 'Check Image Generation Support');
    return false;
  }
}

// 이미지 프롬프트 파싱 및 처리
function parseImagePrompt(content) {
  const imagePromptPattern = /<<([^<>]+)>>/g;
  const matches = [...content.matchAll(imagePromptPattern)];
  
  if (matches.length > 0) {
    const prompts = matches.map(match => match[1].trim());
    const cleanContent = content.replace(imagePromptPattern, '').trim();
    return { cleanContent, imagePrompts: prompts };
  }
  
  return { cleanContent: content, imagePrompts: [] };
}

// ===== 추가: base64 디코딩 유틸 =====
function base64ToUint8Array(base64) {
  base64 = base64.replace(/^data:image\/\w+;base64,/, '');
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Workers AI로 이미지 생성 (수정됨)
async function generateImage(prompt, env) {
  try {
    const response = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt: prompt,
      steps: 3,
      width: 400,
      height: 400
    });
    
    // 응답 표준화
    let base64 = null;
    
    if (!response) {
      throw new Error('AI 이미지 응답이 비어있습니다.');
    }
    
    if (typeof response === 'string') {
      base64 = response;
    } else if (response.image && typeof response.image === 'string') {
      base64 = response.image;
    } else if (Array.isArray(response.images) && response.images[0]) {
      base64 = response.images[0];
    } else if (response.data && typeof response.data === 'string') {
      // 혹시 다른 키 이름 사용 시
      base64 = response.data;
    }
    
    if (!base64) {
      // 키 목록만 로그 (전체 base64 미노출)
      const keys = Object.keys(response || {});
      throw new Error('알 수 없는 AI 이미지 응답 구조: keys=' + JSON.stringify(keys));
    }
    
    const uint8 = base64ToUint8Array(base64);
    return {
      uint8,
      arrayBuffer: uint8.buffer,
      base64
    };
  } catch (error) {
    await logError(error, env, 'Generate Image');
    return null;
  }
}

// 생성된 이미지를 R2에 저장 (유연 처리로 수정)
async function saveImageToR2(imageData, env) {
  try {
    if (!imageData) throw new TypeError('imageData 값이 없습니다.');
    
    let body = null;
    
    // generateImage 반환 형태
    if (imageData.uint8 instanceof Uint8Array) {
      body = imageData.uint8;
    } else if (imageData.arrayBuffer instanceof ArrayBuffer) {
      body = new Uint8Array(imageData.arrayBuffer);
    }
    // base64 문자열
    else if (typeof imageData === 'string') {
      body = base64ToUint8Array(imageData);
    }
    // Workers AI 원본 응답 형태 (image / images)
    else if (imageData.image) {
      body = base64ToUint8Array(imageData.image);
    } else if (Array.isArray(imageData.images) && imageData.images[0]) {
      body = base64ToUint8Array(imageData.images[0]);
    }
    // ArrayBufferView
    else if (ArrayBuffer.isView(imageData)) {
      body = imageData;
    }
    // 순수 ArrayBuffer
    else if (imageData instanceof ArrayBuffer) {
      body = new Uint8Array(imageData);
    }
    
    if (!body) {
      throw new TypeError('지원하지 않는 imageData 타입입니다.');
    }
    
    const fileName = `generated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
    const key = `generated_images/${fileName}`;
    
    await env.R2.put(key, body, {
      httpMetadata: {
        contentType: 'image/png'
      }
    });
    
    return { fileName, key };
  } catch (error) {
    await logError(error, env, 'Save Image to R2');
    return null;
  }
}

// 캐릭터 호출 시스템 안내
const CHARACTER_CALL_SYSTEM = `
[다른 캐릭터 호출]
기본 규칙:
• 다른 캐릭터를 호출하려면 @캐릭터명을 메시지 마지막에 적어주세요
• 한번에 오직 한 명의 캐릭터만 호출 가능합니다
• 호출문은 반드시 메시지의 맨 마지막에 위치해야 합니다

올바른 예시:
   "카나데, 이 부분 어떻게 생각해? @요이사키 카나데"

잘못된 예시:
   "@요이사키 카나데, 이 부분 어떻게 생각해?"
   → 호출문이 메시지 맨 마지막에 있어야 합니다

잘못된 예시 2:
   "다들 이 부분 어떻게 생각하는지 말해줘. @요이사키 카나데 @아키야마 미즈키"
   → 여러명을 동시에 호출할 수 없습니다

현재 호출 가능한 대화 참여 캐릭터:
   {participantsList}
`;

export async function handleChat(request, env) {
  try {
    const { message, model, conversationId, imageData, role = 'user' } = await request.json();
    
    const user = await getUserFromToken(request, env);
    if (!user) return new Response('으....이....', { status: 401 });
    
    await updateConversationTitle(conversationId, message, env);
    
    const newMessage = await saveChatMessage(conversationId, role, message, env, null, 0, user.id);
    
    // 🔧 키워드 기반 지식 검색
    const suggestedKnowledge = await searchKnowledgeByMessage(conversationId, message, env, user.id);
    
    return new Response(JSON.stringify({
      success: true,
      message: newMessage,
      suggestedKnowledge: suggestedKnowledge
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Handle Chat');
    return new Response('으....이....', { status: 500 });
  }
}

// 🔧 메시지 기반 지식 검색 (키워드 매칭)
async function searchKnowledgeByMessage(conversationId, message, env, userId) {
  try {
    // 현재 대화에 이미 적용된 지식 조회
    const conversation = await env.DB.prepare(
      'SELECT knowledge_ids FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, userId).first();
    
    const appliedKnowledgeIds = conversation?.knowledge_ids ? 
      JSON.parse(conversation.knowledge_ids) : [];
    
    // 모든 지식 베이스 조회
    const { results: allKnowledge } = await env.DB.prepare(
      'SELECT * FROM knowledge_base'
    ).all();
    
    // 키워드 매칭 로직 (단어 경계 검사 포함)
    const matchedKnowledge = allKnowledge.filter(knowledge => {
      // 이미 적용된 지식은 제외
      if (appliedKnowledgeIds.includes(knowledge.id)) {
        return false;
      }
      
      const keywords = knowledge.keywords.toLowerCase().split(',').map(k => k.trim());
      const messageLower = message.toLowerCase();
      
      return keywords.some(keyword => {
        // 키워드가 영문/숫자로만 구성되어 있으면 단어 경계 사용
        if (/^[a-zA-Z0-9]+$/.test(keyword)) {
          const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const wordBoundaryRegex = new RegExp('\\b' + escapedKeyword + '\\b');
          return wordBoundaryRegex.test(messageLower);
        } else {
          // 한글이나 특수문자가 포함된 경우, 정확한 매칭 사용
          return messageLower.includes(keyword);
        }
      });
    });
    
    return matchedKnowledge;
  } catch (error) {
    await logError(error, env, 'Search Knowledge By Message');
    return [];
  }
}

async function getCharacterPromptWithType(characterId, characterType, env) {
  try {
    if (characterType === 'official') {
      const character = await env.DB.prepare(
        'SELECT system_prompt FROM characters WHERE id = ?'
      ).bind(characterId).first();
      return character?.system_prompt || null;
    } else if (characterType === 'user') {
      const character = await env.DB.prepare(
        'SELECT system_prompt FROM user_characters WHERE id = ? AND deleted_at IS NULL'
      ).bind(characterId).first();
      return character?.system_prompt || null;
    }
    return null;
  } catch (error) {
    await logError(error, env, 'Get Character Prompt With Type');
    return null;
  }
}

async function getCharacterByName(characterName, env) {
  try {
    const officialChar = await env.DB.prepare(
      'SELECT id, name FROM characters WHERE name = ? OR nickname = ?'
    ).bind(characterName, characterName).first();
    
    if (officialChar) {
      return { id: officialChar.id, type: 'official', name: officialChar.name };
    }
    
    // 사용자 캐릭터는 더 이상 이름으로 검색하지 않음 (초대 방식 변경)
    return null;
  } catch (error) {
    await logError(error, env, 'Get Character By Name');
    return null;
  }
}

async function isCharacterInConversation(conversationId, characterId, characterType, env) {
  try {
    const result = await env.DB.prepare(
      'SELECT id FROM conversation_participants WHERE conversation_id = ? AND character_id = ? AND character_type = ?'
    ).bind(conversationId, characterId, characterType).first();
    
    return !!result;
  } catch (error) {
    return false;
  }
}

// 🔧 대화에 적용된 지식 베이스 조회
async function getAppliedKnowledge(conversationId, env) {
  try {
    const conversation = await env.DB.prepare(
      'SELECT knowledge_ids FROM conversations WHERE id = ?'
    ).bind(conversationId).first();
    
    if (!conversation || !conversation.knowledge_ids) {
      return [];
    }
    
    const knowledgeIds = JSON.parse(conversation.knowledge_ids);
    if (knowledgeIds.length === 0) {
      return [];
    }
    
    // 지식 베이스 상세 정보 조회
    const placeholders = knowledgeIds.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT title, content FROM knowledge_base WHERE id IN (${placeholders})`
    ).bind(...knowledgeIds).all();
    
    return results || [];
  } catch (error) {
    await logError(error, env, 'Get Applied Knowledge');
    return [];
  }
}

export async function handleCharacterGeneration(request, env) {
  try {
    const { characterId, conversationId, imageData, workMode, showTime, situationPrompt, imageGenerationEnabled, imageCooldownSeconds, autoCallCount } = await request.json();
    
    const user = await getUserFromToken(request, env);
    if (!user) return new Response('으....이....', { status: 401 });
    
    const participant = await env.DB.prepare(
      'SELECT character_type FROM conversation_participants WHERE conversation_id = ? AND character_id = ?'
    ).bind(conversationId, characterId).first();
    
    if (!participant) {
      return new Response('참여하지 않은 캐릭터입니다.', { status: 400 });
    }
    
    const history = await getChatHistory(conversationId, env); //    캐시 사용
    const characterPrompt = await getCharacterPromptWithType(characterId, participant.character_type, env);
    if (!characterPrompt) return new Response('캐릭터를 찾을 수 없습니다.', { status: 404 });
    
    const maxAutoCallSequence = user.max_auto_call_sequence || 3;
    
    const participants = await getConversationParticipants(conversationId, env);
    
    // 🔧 적용된 지식 베이스 조회
    const appliedKnowledge = await getAppliedKnowledge(conversationId, env);
    
    let commonRulesPrompt = '';
    if (characterId !== 0) {
      if (workMode) {
        commonRulesPrompt = env.WORK_MODE_PROMPT;
      } else {
        commonRulesPrompt = env.COMMON_RULES_PROMPT;
      }
    }
    
    const currentTime = showTime ? getCurrentSeoulTime() : null;
    let latestImageData = imageData || await getLatestImageFromHistory(conversationId, env);
    
    const apiKey = user.gemini_api_key || env.GEMINI_API_KEY;
    const response = await callGeminiAPI(
      characterPrompt, commonRulesPrompt, history, user.nickname, user.self_introduction,
      apiKey, currentTime, latestImageData, autoCallCount || 0, maxAutoCallSequence,
      participants, situationPrompt, characterId, participant.character_type, appliedKnowledge,
      imageGenerationEnabled, env, imageCooldownSeconds || 0, conversationId
    );
    
    const { cleanContent, calledCharacter } = parseCharacterCall(response);
    
    // 🔧 이미지 생성 처리
    let processedContent = cleanContent;
    let generatedImages = [];
    
    if (imageGenerationEnabled && await supportsImageGeneration(characterId, participant.character_type, env)) {
      const { cleanContent: contentWithoutImagePrompts, imagePrompts } = parseImagePrompt(cleanContent);
      processedContent = contentWithoutImagePrompts;
      
      // 이미지 프롬프트가 있으면 이미지 생성
      for (const prompt of imagePrompts) {
        try {
          const imageResult = await generateImage(prompt, env);
          if (imageResult) {
            const savedImage = await saveImageToR2(imageResult, env);
            if (savedImage) {
              generatedImages.push({
                prompt: prompt,
                fileName: savedImage.fileName,
                url: `/api/images/generated/${savedImage.fileName}`
              });
            }
          }
        } catch (error) {
          await logError(error, env, 'Process Image Generation');
        }
      }
    }
    
    // 처리된 컨텐츠로 메시지 저장 (이미지 프롬프트 제거됨)
    const newMessage = await saveChatMessage(conversationId, 'assistant', processedContent, env, characterId, autoCallCount || 0, null, participant.character_type);
    
    // 🔧 호감도 자동 업데이트 (마지막에 수행)
    if (history.length > 0) {
      const lastUserMessage = history.filter(msg => msg.role === 'user').pop();
      if (lastUserMessage) {
        await updateAffectionAuto(
          conversationId, 
          characterId, 
          participant.character_type, 
          lastUserMessage.content, 
          processedContent, 
          env
        );
      }
    }
    
    let autoCallTriggered = false;
    if (calledCharacter && (autoCallCount || 0) < maxAutoCallSequence) {
      const targetCharacter = await getCharacterByName(calledCharacter, env);
      if (targetCharacter && await isCharacterInConversation(conversationId, targetCharacter.id, targetCharacter.type, env)) {
        autoCallTriggered = true;
      }
    }
    
    return new Response(JSON.stringify({
      response: processedContent,
      autoCallTriggered,
      calledCharacter,
      newMessage: newMessage,
      generatedImages: generatedImages
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    await logError(error, env, 'Character Generation');
    return new Response('으....이....', { status: 500 });
  }
}

export async function handleAutoReply(request, env) {
  try {
    const user = await getUserFromToken(request, env);
    if (!user) {
        return new Response('Unauthorized', { status: 401 });
    }

    const { conversationId } = await request.json();
    if (!conversationId) {
        return new Response('Missing conversationId', { status: 400 });
    }

    const maxSequence = user.max_auto_call_sequence || 1;
    const generatedMessages = [];

    for (let i = 0; i < maxSequence; i++) {
        // 1. Get participants
        const participants = await getConversationParticipants(conversationId, env);
        if (participants.length === 0) break;

        // 2. Get recent messages
        const recentMessages = await getRecentMessages(conversationId, 10, env);
        const historyText = recentMessages.map(m => `${m.character_name || m.role}: ${m.content}`).join('\n');

        // 3. Ask model to select next speaker
        const participantNames = participants.map(p => p.name);
        const userNickname = user.nickname || '사용자';
        
        const prompt = `최근 대화 내용입니다:\n${historyText}\n\n대화 참가자 목록: [${participantNames.join(', ')}, ${userNickname}]\n\n다음으로 답변할 대화 참가자를 목록에서 선정해 이름만 정확히 말해주세요.`;

        const apiKey = user.gemini_api_key || env.GEMINI_API_KEY;
        const nextSpeakerNameResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.0, maxOutputTokens: 50 }
            })
        });
        
        if (!nextSpeakerNameResponse.ok) continue;
        const nextSpeakerData = await nextSpeakerNameResponse.json();
        const nextSpeakerName = nextSpeakerData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        // 4. Check if the user was selected
        if (!nextSpeakerName || nextSpeakerName.includes('유저') || nextSpeakerName.includes(userNickname)) {
            break; // Stop if user is selected or response is invalid
        }

        // 5. Find the selected character
        const selectedCharacter = participants.find(p => nextSpeakerName.includes(p.name));
        if (!selectedCharacter) {
            continue; 
        }

        // 6. Generate the character's response by calling handleCharacterGeneration
        try {
            const generationRequest = new Request(request.url, {
                method: 'POST',
                headers: request.headers,
                body: JSON.stringify({
                    conversationId,
                    characterId: selectedCharacter.id,
                    characterType: selectedCharacter.type,
                    autoCallCount: i + 1,
                    // Pass other necessary parameters from conversation settings
                    workMode: false, // Assuming default, adjust as needed
                    showTime: true, // Assuming default, adjust as needed
                    situationPrompt: '', // Assuming default, adjust as needed
                    imageGenerationEnabled: true, // Assuming default, adjust as needed
                }),
            });

            const response = await handleCharacterGeneration(generationRequest, env);
            if (response.ok) {
                const messageData = await response.json();
                generatedMessages.push(messageData.newMessage);
            } else {
                break;
            }
        } catch (error) {
            await logError(error, env, 'Auto-Reply Generation');
            break;
        }
    }

    return new Response(JSON.stringify({ messages: generatedMessages }), {
        headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    await logError(error, env, 'Handle Auto Reply');
    return new Response('Internal Server Error', { status: 500 });
  }
}

async function getRecentMessages(conversationId, limit, env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM (
          SELECT 
              m.role, m.content, m.created_at,
              COALESCE(c.name, uc.name) as character_name
           FROM messages m
           LEFT JOIN characters c ON m.character_id = c.id AND m.character_type = 'official'
           LEFT JOIN user_characters uc ON m.user_character_id = uc.id AND m.character_type = 'user'
           WHERE m.conversation_id = ?
           ORDER BY m.created_at DESC
           LIMIT ?
       ) sub
       ORDER BY sub.created_at ASC`
    ).bind(conversationId, limit).all();
    return results || [];
  } catch (error) {
    await logError(error, env, 'Get Recent Messages');
    return [];
  }
}


async function callGeminiAPI(characterPrompt, commonRulesPrompt, history, userNickname, userSelfIntro, apiKey, currentTime, imageData, autoCallSequence, maxAutoCallSequence, participants, situationPrompt, currentCharacterId, currentCharacterType, appliedKnowledge, imageGenerationEnabled, env, imageCooldownSeconds, conversationId) {
  try {
    let systemPrompt = characterPrompt;
    
    if (commonRulesPrompt) {
      systemPrompt += '\n\n' + commonRulesPrompt;
    }
    
    if (participants && participants.length > 1) {
      const otherParticipants = participants.filter(p => !(p.id === currentCharacterId && p.type === currentCharacterType));
      if (otherParticipants.length > 0) {
        const participantsText = otherParticipants
          .map(p => `• ${p.name}: ${p.description || '소개 없음'}`)
          .join('\n');
        systemPrompt += '\n\n[현재 참가한 다른 캐릭터 목록 및 소개]\n' + participantsText;
      }
    }

    if (participants && participants.length > 0) {
      const participantsList = participants.map(p => p.name);
      const participantsText = participantsList.map(name => `   • ${name}`).join('\n');
      systemPrompt += '\n\n' + CHARACTER_CALL_SYSTEM.replace('{participantsList}', participantsText);
    }
    
    if (userNickname) {
      systemPrompt += `\n\n[사용자 정보]\n사용자 닉네임: ${userNickname}`;
      if (userSelfIntro) {
        systemPrompt += `\n사용자 자기소개: ${userSelfIntro}`;
      }
    }
    
    if (currentTime) {
      systemPrompt += `\n\n[현재 시간]\n${currentTime}`;
    }
    
    if (situationPrompt && situationPrompt.trim()) {
      systemPrompt += `\n\n[상황 설정]\n${situationPrompt.trim()}`;
    }
    
    // 🔧 적용된 지식 베이스 컨텍스트 추가
    if (appliedKnowledge && appliedKnowledge.length > 0) {
      const knowledgeContext = appliedKnowledge
        .map(knowledge => `• ${knowledge.title}:\n${knowledge.content}`)
        .join('\n\n');
      systemPrompt += `\n\n[관련 지식]\n다음 지식들을 참고하여 답변에 활용해주세요:\n\n${knowledgeContext}`;
    }
    
    // 🔧 호감도 시스템 프롬프트 추가
    if (conversationId) {
      try {
        const conversation = await env.DB.prepare(
          'SELECT use_affection_sys FROM conversations WHERE id = ?'
        ).bind(conversationId).first();
        
        if (conversation && conversation.use_affection_sys) {
          const participant = await env.DB.prepare(
            'SELECT affection_level FROM conversation_participants WHERE conversation_id = ? AND character_id = ? AND character_type = ?'
          ).bind(conversationId, currentCharacterId, currentCharacterType).first();
          
          if (participant && participant.affection_level !== null) {
            const affectionPrompt = generateAffectionPrompt(
              currentCharacterId, 
              participant.affection_level, 
              userNickname
            );
            if (affectionPrompt) {
              systemPrompt += '\n\n[호감도 정보]\n' + affectionPrompt;
            }
          }
        }
      } catch (affectionError) {
        // 호감도 시스템 오류가 있어도 대화는 계속 진행
        await logError(affectionError, env, 'Affection System in Gemini API');
      }
    }
    
    // 🔧 이미지 생성 프롬프트 추가 (지원 캐릭터만)
    if (imageGenerationEnabled && env && await supportsImageGeneration(currentCharacterId, currentCharacterType, env)) {
      let imagePrompt = '';
      
      // 쿨다운 상태에 따른 안내 메시지 추가
      if (imageCooldownSeconds > 0) {
        imagePrompt = `이미지 생성은 ${imageCooldownSeconds}초 후에 가능합니다. 이미지 생성 요청이 들어왔다면 지쳤으니 ${imageCooldownSeconds}초 후에 다시 오라고 말하세요.`;
      } else {
        imagePrompt = env.IMAGE_GENERATION_PROMPT || `
이미지 생성 기능 사용법: 그림을 그려달라는 요청을 받으면, 메시지에 <<여기에 그림에 대한 영어 프롬프트>>형식으로 이미지 생성 명령을 포함하세요.

이미지 생성이 가능한 상태입니다. 그림 요청을 받으면 적극적으로 이미지 생성 명령을 사용해주세요.`;
      }
      
      systemPrompt += `\n\n${imagePrompt}`;
    }
    
    if (autoCallSequence > 0) {
      systemPrompt += `\n\n[자동 호출 정보]\n현재 연속 호출 순서: ${autoCallSequence}/${maxAutoCallSequence}`;
    }
    
    if (history && history.length > 0) {
      systemPrompt += '\n\n[대화 기록]';
      const conversationHistory = history.map(msg => {
        if (msg.role === 'user') {
          return `${msg.nickname || '사용자'} : ${msg.content}`;
        } else if (msg.role === 'assistant') {
          return `${msg.character_name || '캐릭터'} : ${msg.content}`;
        } else if (msg.role === 'situation') {
            return `[상황] ${msg.content}`;
        }
        return null;
      }).filter(Boolean).join('\n-----\n');
      
      if (conversationHistory) {
        systemPrompt += '\n' + conversationHistory;
      }
    }
    
    const messages = [{ role: 'user', parts: [{ text: systemPrompt }] }];
    
    if (imageData && messages.length > 0) {
      messages[messages.length - 1].parts.push({
        inline_data: { mime_type: imageData.mimeType, data: imageData.base64Data }
      });
    }
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages,
        generationConfig: {
          temperature: 0.8, topK: 40, topP: 0.95, maxOutputTokens: 2048
        }
      })
    });
    
    if (!response.ok) throw new Error(`Gemini API 오류: ${response.status}`);
    
    const data = await response.json();
    
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      return data.candidates[0].content.parts[0].text;
    } else {
      throw new Error('Gemini API 응답이 비어있습니다.');
    }
    
  } catch (error) {
    console.error('Gemini API 호출 실패:', error);
    throw error;
  }
}

function parseCharacterCall(content) {
  const callPattern = /@([^\s@]+(?:\s+[^\[@]+)*)\s*$/;
  const match = content.match(callPattern);
  
  if (match) {
    const calledCharacter = match[1].trim();
    const cleanContent = content.replace(callPattern, '').trim();
    return { cleanContent, calledCharacter };
  }
  
  return { cleanContent: content, calledCharacter: null };
}


// 대화내역 파싱
async function getChatHistoryFromDB(conversationId, env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM (
          SELECT 
              m.role, m.content, m.auto_call_sequence, m.created_at,
              CASE WHEN m.role = 'user' THEN u.nickname ELSE NULL END as nickname,
              COALESCE(c.name, uc.name) as character_name
           FROM messages m
           LEFT JOIN characters c ON m.character_id = c.id
           LEFT JOIN user_characters uc ON m.user_character_id = uc.id
           LEFT JOIN conversations conv ON m.conversation_id = conv.id
           LEFT JOIN users u ON conv.user_id = u.id
           WHERE m.conversation_id = ?
           ORDER BY m.created_at DESC
           LIMIT 200
       ) sub
       ORDER BY sub.created_at ASC`
    ).bind(conversationId).all();
    return results || [];
  } catch (error) {
    await logError(error, env, 'Get Chat History From DB');
    return [];
  }
}

// Updates the cache with fresh data from the DB.
async function refreshChatHistoryCache(conversationId, env) {
  try {
    const history = await getChatHistoryFromDB(conversationId, env);
    if (history.length > 0) {
      const historyJson = JSON.stringify(history);
      await env.DB.prepare(
        `INSERT OR REPLACE INTO conversation_history_cache (conversation_id, history, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)`
      ).bind(conversationId, historyJson).run();
    }
  } catch (error) {
    await logError(error, env, 'Refresh Chat History Cache');
  }
}

// Main function to get chat history, using cache first.
async function getChatHistory(conversationId, env) {
  try {
    // 1. Try to get from cache
    const cached = await env.DB.prepare(
      'SELECT history FROM conversation_history_cache WHERE conversation_id = ?'
    ).bind(conversationId).first();

    if (cached && cached.history) {
      try {
        // If cache hit, return parsed data
        return JSON.parse(cached.history);
      } catch (e) {
        await logError(e, env, 'Get Chat History - JSON Parse Error');
        // Fall through to fetch from DB if JSON is invalid
      }
    }

    // 2. If cache miss or invalid, fetch from DB
    const history = await getChatHistoryFromDB(conversationId, env);

    // 3. Populate cache for next time
    if (history.length > 0) {
      // Await to ensure completion
      await refreshChatHistoryCache(conversationId, env);
    }

    return history;
  } catch (error) {
    await logError(error, env, 'Get Chat History');
    // Fallback to DB if all else fails
    return getChatHistoryFromDB(conversationId, env);
  }
}

// ===================================================================
// Modified Core Functions
// ===================================================================

async function saveChatMessage(conversationId, role, content, env, characterId = null, autoCallSequence = 0, userId = null, characterType = 'official') {
  try {
    const officialCharacterId = characterType === 'official' ? characterId : null;
    const userCharacterId = characterType === 'user' ? characterId : null;

    const result = await env.DB.prepare(
      `INSERT INTO messages (conversation_id, role, content, character_id, user_character_id, auto_call_sequence, user_id, character_type) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(conversationId, role, content, officialCharacterId, userCharacterId, autoCallSequence, userId, characterType).first();
    
    // After saving a new message, immediately refresh the cache.
    await refreshChatHistoryCache(conversationId, env);

    return result;
  } catch (error) {
    await logError(error, env, 'Save Chat Message');
    throw error;
  }
}

async function getConversationParticipants(conversationId, env) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT 
        cp.character_id as id,
        cp.character_type as type,
        CASE 
          WHEN cp.character_type = 'official' THEN c.name
          ELSE uc.name
        END as name,
        CASE
          WHEN cp.character_type = 'user' THEN uc.description
          ELSE '공식 캐릭터'
        END as description
      FROM conversation_participants cp
      LEFT JOIN characters c ON cp.character_id = c.id AND cp.character_type = 'official'
      LEFT JOIN user_characters uc ON cp.character_id = uc.id AND cp.character_type = 'user' AND uc.deleted_at IS NULL
      WHERE cp.conversation_id = ?
      ORDER BY cp.created_at ASC
    `).bind(conversationId).all();
    
    return results.filter(p => p.name);
  } catch (error) {
    await logError(error, env, 'Get Conversation Participants');
    return [];
  }
}

async function getCurrentAutoCallSequence(conversationId, env) {
  try {
    const result = await env.DB.prepare(
      'SELECT COALESCE(MAX(auto_call_sequence), 0) as max_sequence FROM messages WHERE conversation_id = ?'
    ).bind(conversationId).first();
    
    return result?.max_sequence || 0;
  } catch (error) {
    return 0;
  }
}

async function getLatestImageFromHistory(conversationId, env) {
  try {
    const result = await env.DB.prepare(
      `SELECT f.filename, f.mime_type FROM messages m
       JOIN files f ON m.file_id = f.id
       WHERE m.conversation_id = ? AND m.message_type = 'image'
       ORDER BY m.created_at DESC
       LIMIT 1`
    ).bind(conversationId).first();
    
    if (!result) return null;
    
    const object = await env.R2.get(`image_uploads/${result.filename}`);
    if (!object) return null;
    
    const arrayBuffer = await object.arrayBuffer();
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    return {
      base64Data,
      mimeType: result.mime_type,
      fileName: result.filename
    };
  } catch (error) {
    await logError(error, env, 'Get Latest Image');
    return null;
  }
}

async function updateConversationTitle(conversationId, message, env) {
  try {
    const conversation = await env.DB.prepare(
      'SELECT title FROM conversations WHERE id = ?'
    ).bind(conversationId).first();
    
    if (!conversation || !conversation.title || conversation.title.startsWith('대화 ')) {
      const title = message.length > 20 ? message.substring(0, 17) + '...' : message;
      
      await env.DB.prepare(
        'UPDATE conversations SET title = ? WHERE id = ?'
      ).bind(title, conversationId).run();
    }
  } catch (error) {
    await logError(error, env, 'Update Conversation Title');
  }
}

export async function handleSelectSpeaker(request, env) {
  try {
    const user = await getUserFromToken(request, env);
    if (!user) {
        return new Response('Unauthorized', { status: 401 });
    }

    const { conversationId } = await request.json();
    if (!conversationId) {
        return new Response('Missing conversationId', { status: 400 });
    }

    const participants = await getConversationParticipants(conversationId, env);
    if (participants.length === 0) {
        return new Response(JSON.stringify({ speaker: null, reason: 'no_participants' }), { headers: { 'Content-Type': 'application/json' } });
    }

    const recentMessages = await getRecentMessages(conversationId, 10, env);
    const historyText = recentMessages.map(m => `${m.character_name || m.role}: ${m.content}`).join('\n');

    const lastMessage = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;
    const lastSpeakerName = lastMessage ? (lastMessage.character_name || 'user') : 'N/A';

    const participantNames = participants.map(p => p.name);
    const userNickname = user.nickname || '사용자';
    
    const prompt = `최근 대화 내용입니다:\n${historyText}\n\n대화 참가자 목록: [${participantNames.join(', ')}, ${userNickname}]\n\n바로 직전 발언자는 "${lastSpeakerName}"입니다. 대화의 흐름상 꼭 필요한 경우가 아니라면, "${lastSpeakerName}"가 아닌 다른 참가자를 다음 발언자로 선정해주세요. 다음으로 답변할 대화 참가자를 목록에서 선정해 이름만 정확히 말해주세요.`;

    const apiKey = user.gemini_api_key || env.GEMINI_API_KEY;
    const nextSpeakerNameResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 1.0, maxOutputTokens: 50 }
        })
    });
    
    if (!nextSpeakerNameResponse.ok) {
        return new Response(JSON.stringify({ speaker: null, reason: 'selection_failed' }), { headers: { 'Content-Type': 'application/json' } });
    }
    const nextSpeakerData = await nextSpeakerNameResponse.json();
    const nextSpeakerName = nextSpeakerData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!nextSpeakerName || nextSpeakerName.includes('유저') || nextSpeakerName.includes(userNickname)) {
        return new Response(JSON.stringify({ speaker: null, reason: 'user_selected' }), { headers: { 'Content-Type': 'application/json' } });
    }

    const selectedCharacter = participants.find(p => nextSpeakerName.includes(p.name));
    if (!selectedCharacter) {
        return new Response(JSON.stringify({ speaker: null, reason: 'character_not_found' }), { headers: { 'Content-Type': 'application/json' } });
    }

    const characterDetails = await getCharacterDetails(selectedCharacter.id, selectedCharacter.type, env);

    return new Response(JSON.stringify({ speaker: characterDetails }), {
        headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    await logError(error, env, 'handleSelectSpeaker');
    return new Response('Internal Server Error', { status: 500 });
  }
}

async function getCharacterDetails(characterId, characterType, env) {
    let character;
    if (characterType === 'official') {
        character = await env.DB.prepare(
            'SELECT id, name, profile_image FROM characters WHERE id = ?'
        ).bind(characterId).first();
    } else {
        character = await env.DB.prepare(
            'SELECT id, name, profile_image_r2 FROM user_characters WHERE id = ? AND deleted_at IS NULL'
        ).bind(characterId).first();
        if (character && character.profile_image_r2) {
            character.profile_image = `/api/user-characters/image/${character.profile_image_r2}`;
        } else if (character) {
            character.profile_image = '/images/characters/kanade.webp'; // fallback
        }
    }
    if (character) {
        character.type = characterType;
    }
    return character;
}
