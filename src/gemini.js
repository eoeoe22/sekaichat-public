import { logError, verifyJwt, callGemini } from './utils.js';
import { generateAffectionPrompt, updateAffectionAuto } from './affection-system.js';
import { getExtendedCharacterPrompt } from './user-characters.js';

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
    
    if (!user) {
      await logError(new Error(`User not found in database for ID: ${tokenData.userId}`), env, 'Gemini: GetUserFromToken');
    }
    
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
    console.log(`Checking image generation support for characterId: ${characterId}, characterType: ${characterType}`);
    // Official characters: ID 3 or 8
    if (characterType === 'official') {
      const allowedIdsString = env.IMAGE_GENERATION_CHARACTERS || '';
      const allowedIds = allowedIdsString.split(',').map(id => parseInt(id.trim()));
      const isAllowed = allowedIds.includes(characterId);
      console.log(`Allowed IDs: [${allowedIds.join(', ')}], Is character ID ${characterId} allowed? ${isAllowed}`);
      return isAllowed;
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

// 생성된 이미지를 R2에 저장 (유연 처리로 수정)
async function saveImageToR2(imageData, env) {
  try {
    if (!imageData) throw new TypeError('imageData 값이 없습니다.');
    
    let body = null;
    
    if (typeof imageData === 'string') {
      body = base64ToUint8Array(imageData);
    } else if (imageData.uint8 instanceof Uint8Array) {
      body = imageData.uint8;
    } else if (imageData.arrayBuffer instanceof ArrayBuffer) {
      body = new Uint8Array(imageData.arrayBuffer);
    } else if (imageData.image) {
      body = base64ToUint8Array(imageData.image);
    } else if (Array.isArray(imageData.images) && imageData.images[0]) {
      body = base64ToUint8Array(imageData.images[0]);
    } else if (ArrayBuffer.isView(imageData)) {
      body = imageData;
    } else if (imageData instanceof ArrayBuffer) {
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
    
    // 사용자 존재 여부 확인 (Foreign Key 제약조건 오류 방지)
    const userExists = await env.DB.prepare('SELECT id FROM users WHERE id = ?')
      .bind(user.id).first();
    
    if (!userExists) {
      await logError(new Error(`User ID ${user.id} from JWT token does not exist in database`), env, 'Handle Chat - User Validation');
      return new Response('Invalid user session. Please login again.', { status: 401 });
    }
    
    await updateConversationTitle(conversationId, message, env);
    
    const newMessage = await saveChatMessage(conversationId, role, message, env, null, 0, user.id);
    
    return new Response(JSON.stringify({
      success: true,
      message: newMessage
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(error, env, 'Handle Chat');
    return new Response('으....이....', { status: 500 });
  }
}



// Generate image using Workers AI (Flux model)
async function generateImageWithWorkersAI(prompt, env) {
  try {
    const use25Flash = env['25FLASH_IMAGE'] === 'true';
    
    const response = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt: prompt,
      steps: use25Flash ? 3 : 4,
      width: use25Flash ? 400 : 512,
      height: use25Flash ? 400 : 512
    });
    return response;
  } catch (error) {
    await logError(error, env, 'Generate Image with Workers AI');
    return null;
  }
}

// Generate image using Gemini 2.0 Flash Preview Image Generation model with optional reference images
// Supports image-to-image functionality by including the most recent image from conversation
async function generateImageWithGemini(prompt, env, apiKey, latestImages = []) {
    const parts = [{ text: prompt }];
    if (latestImages && latestImages.length > 0) {
        const imagesToUse = latestImages.slice(-2).reverse();
        for (const recentImage of imagesToUse) {
            if (recentImage && recentImage.base64Data && recentImage.mimeType) {
                parts.push({
                    inlineData: {
                        mimeType: recentImage.mimeType,
                        data: recentImage.base64Data
                    }
                });
            }
        }
    }

    const body = {
        contents: [{ parts: parts }],
        generationConfig: {
            responseModalities: ["TEXT", "IMAGE"]
        }
    };

    try {
        const data = await callGemini('gemini-2.0-flash-preview-image-generation', apiKey, body, env, 'Generate Image with Gemini');
        if (!data.candidates?.[0]?.content?.parts) {
            throw new Error('Invalid response structure from Gemini API');
        }
        const imagePart = data.candidates[0].content.parts.find(part => part.inlineData);
        if (imagePart?.inlineData?.data && imagePart?.inlineData?.mimeType) {
            return { 
                base64Data: imagePart.inlineData.data, 
                mimeType: imagePart.inlineData.mimeType 
            };
        }
        throw new Error('No image data found in Gemini API response');
    } catch (error) {
        await logError(error, env, 'Generate Image with Gemini');
        return null;
    }
}

export async function handleCharacterGeneration(request, env) {
  try {
    const { characterId, conversationId, imageData, workMode, showTime, situationPrompt, imageGenerationEnabled, imageCooldownSeconds, autoCallCount, selectedModel } = await request.json();
    
    const user = await getUserFromToken(request, env);
    if (!user) return new Response('으....이....', { status: 401 });
    
    const participant = await env.DB.prepare(
      'SELECT character_type FROM conversation_participants WHERE conversation_id = ? AND character_id = ?'
    ).bind(conversationId, characterId).first();
    
    if (!participant) {
      return new Response('참여하지 않은 캐릭터입니다.', { status: 400 });
    }
    
    const history = await getChatHistory(conversationId, env);
    const characterPrompt = await getExtendedCharacterPrompt(characterId, env);
    if (!characterPrompt) return new Response('캐릭터를 찾을 수 없습니다.', { status: 404 });
    
    const maxAutoCallSequence = user.max_auto_call_sequence || 3;
    const participants = await getConversationParticipants(conversationId, env);
    const autoragContext = await getAutoragMemoryContext(conversationId, user, env);
    
    let commonRulesPrompt = '';
    if (characterId !== 0) {
      if (workMode) {
        commonRulesPrompt = env.WORK_MODE_PROMPT;
      } else {
        commonRulesPrompt = env.COMMON_RULES_PROMPT;
      }
    }
    
    const currentTime = showTime ? getCurrentSeoulTime() : null;
    let latestImages = imageData ? [imageData] : await getLatestImagesFromHistory(conversationId, env);
    
    const apiKey = user.gemini_api_key || env.GEMINI_API_KEY;
    
    // Use Gemini API for character message generation
    const textResponse = await callGeminiAPI(
      characterPrompt, commonRulesPrompt, history, user.nickname, user.self_introduction,
      apiKey, currentTime, latestImages, autoCallCount || 0, maxAutoCallSequence,
      participants, situationPrompt, characterId, participant.character_type, 
      imageGenerationEnabled, env, imageCooldownSeconds || 0, conversationId, autoragContext, selectedModel
    );

    let processedContent = textResponse;
    let generatedImages = [];

    // Parse image prompts from response first
    const { cleanContent, imagePrompts } = parseImagePrompt(textResponse);
    processedContent = cleanContent;

    // Only run image generation if there are actual image prompts and the feature is enabled
    if (imageGenerationEnabled && imagePrompts.length > 0 && await supportsImageGeneration(characterId, participant.character_type, env)) {
        for (const prompt of imagePrompts) {
            try {
                // Check 25FLASH_IMAGE setting to decide which image generation method to use
                const use25Flash = env['25FLASH_IMAGE'] === 'true';
                let imageResult = null;
                let imageData = null;
                
                if (use25Flash) {
                    // Use Gemini API for image generation when 25FLASH_IMAGE is true
                    imageResult = await generateImageWithGemini(prompt, env, apiKey, latestImages);
                    if (imageResult && imageResult.base64Data) {
                        imageData = imageResult.base64Data;
                    }
                } else {
                    // Use Workers AI (Flux) for image generation when 25FLASH_IMAGE is false
                    imageResult = await generateImageWithWorkersAI(prompt, env);
                    if (imageResult) {
                        imageData = imageResult; // Workers AI returns the image buffer directly
                    }
                }
                
                if (imageData) {
                    const savedImage = await saveImageToR2(imageData, env);
                    if (savedImage) {
                        // Save generated image to files table
                        const fileResult = await env.DB.prepare(
                            'INSERT INTO files (user_id, filename, original_name, file_size, mime_type, r2_key) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
                        ).bind(
                            user.id, 
                            `generated/${savedImage.fileName}`, // Add generated/ prefix for correct image serving
                            `Generated: ${prompt}`, 
                            0, // File size not available for generated images
                            'image/png', 
                            savedImage.key
                        ).first();
                        
                        // Save generated image as message record
                        await env.DB.prepare(
                            'INSERT INTO messages (conversation_id, role, content, character_id, user_character_id, message_type, file_id, user_id, character_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
                        ).bind(
                            conversationId,
                            'assistant',
                            `🖼️ "${prompt}"`,
                            participant.character_type === 'official' ? characterId : null,
                            participant.character_type === 'user' ? characterId : null,
                            'image',
                            fileResult.id,
                            user.id,
                            participant.character_type
                        ).run();
                        
                        generatedImages.push({
                            prompt: prompt,
                            fileName: savedImage.fileName,
                            url: `/api/images/generated/${savedImage.fileName}`
                        });
                    }
                }
            } catch (error) {
                await logError(error, env, `Process Image Generation (${env['25FLASH_IMAGE'] === 'true' ? 'Gemini' : 'Workers AI'})`);
            }
        }
        
        // Refresh chat history cache if images were generated
        if (generatedImages.length > 0) {
            await refreshChatHistoryCache(conversationId, env);
        }
    }

    const { cleanContent: finalContent, calledCharacter } = parseCharacterCall(processedContent);
    
    const newMessage = await saveChatMessage(conversationId, 'assistant', finalContent, env, characterId, autoCallCount || 0, null, participant.character_type);
    
    if (history.length > 0) {
      const lastUserMessage = history.filter(msg => msg.role === 'user').pop();
      if (lastUserMessage) {
        await updateAffectionAuto(
          conversationId, 
          characterId, 
          participant.character_type, 
          lastUserMessage.content, 
          finalContent, 
          env
        );
      }
    }
    
    return new Response(JSON.stringify({
      response: finalContent,
      calledCharacter,
      newMessage: newMessage,
      generatedImages: generatedImages // Keep for profile updates
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    await logError(error, env, 'Character Generation');
    return new Response('으....이....', { status: 500 });
  }
}

async function callGeminiAPI(characterPrompt, commonRulesPrompt, history, userNickname, userSelfIntro, apiKey, currentTime, imageDataArray, autoCallSequence, maxAutoCallSequence, participants, situationPrompt, currentCharacterId, currentCharacterType, imageGenerationEnabled, env, imageCooldownSeconds, conversationId, autoragContext, selectedModel = 'gemini-2.5-flash') {
  const modelMapping = {
    'gemini-1.5-pro-latest': 'gemini-2.5-pro',
    'gemini-1.5-flash-latest': 'gemini-2.5-flash',
    'gemini-pro': 'gemini-2.5-flash',
    'gemini-1.0-pro': 'gemini-2.5-flash'
  };
  const finalModel = modelMapping[selectedModel] || selectedModel;

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
    const participantsList = participants.map(p => p.nickname ? `${p.name}(${p.nickname})` : p.name);
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

  if (autoragContext) {
    systemPrompt += `\n\n[스토리 기억]\n다음은 관련된 스토리 맥락입니다. 이 정보를 참고하여 답변에 활용해주세요:\n\n${autoragContext}`;
  }

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
      await logError(affectionError, env, 'Affection System in Gemini API');
    }
  }

  if (imageGenerationEnabled && await supportsImageGeneration(currentCharacterId, currentCharacterType, env)) {
      let imagePrompt = `\n이미지 생성 기능 사용법: 그림을 그려달라는 요청을 받으면, 메시지에 <<여기에 그림에 대한 영어 프롬프트>>형식으로 이미지 생성 명령을 포함하세요.`;
      systemPrompt += `\n\n${imagePrompt}`;
  }

  if (autoCallSequence > 0) {
    systemPrompt += `\n\n[자동 호출 정보]\n현재 연속 호출 순서: ${autoCallSequence}/${maxAutoCallSequence}`;
  }

  if (history && history.length > 0) {
    systemPrompt += '\n\n[대화 기록]';
    const conversationHistory = history.map(msg => {
      if (!msg.content) return null;
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
  if (imageDataArray && Array.isArray(imageDataArray) && imageDataArray.length > 0) {
    for (const imageData of imageDataArray) {
      if (imageData && imageData.base64Data && imageData.mimeType) {
        messages[messages.length - 1].parts.push({
          inlineData: { mimeType: imageData.mimeType, data: imageData.base64Data }
        });
      }
    }
  }

  const body = {
    contents: messages,
    generationConfig: {
      temperature: 0.8, topK: 40, topP: 0.95, maxOutputTokens: 2048
    }
  };

  try {
    const data = await callGemini(finalModel, apiKey, body, env, 'Character Generation');
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
        const body = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 1.0, maxOutputTokens: 50 }
        };

        let nextSpeakerName = null;
        try {
            const nextSpeakerData = await callGemini('gemini-2.5-flash-lite', apiKey, body, env, 'Auto-Reply Speaker Selection');
            nextSpeakerName = nextSpeakerData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        } catch (error) {
            await logError(error, env, 'Auto-Reply Speaker Selection');
            continue; // Continue to next iteration on error
        }

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

// 🔧 AutoRAG 메모리 컨텍스트 조회
async function getAutoragMemoryContext(conversationId, user, env) {
  try {
    // AutoRAG 메모리 설정이 활성화되어 있는지 확인
    const conversation = await env.DB.prepare(
      'SELECT use_autorag_memory FROM conversations WHERE id = ?'
    ).bind(conversationId).first();
    
    if (!conversation || !conversation.use_autorag_memory) {
      return null;
    }
    
    // 최근 5개 메시지 조회
    const recentMessages = await getRecentMessages(conversationId, 5, env);
    if (recentMessages.length === 0) {
      return null;
    }
    
    // 최근 메시지들을 쿼리 텍스트로 결합
    const conversationText = recentMessages
      .map(msg => `${msg.character_name || msg.role}: ${msg.content}`)
      .join('\n');
    
    if (!conversationText.trim()) {
      return null;
    }

    const apiKey = user?.gemini_api_key || env.GEMINI_API_KEY;
    const keywordPrompt = `다음 대화 내역에서 핵심 키워드를 쉼표로 구분해 나열하세요. (현재 대화중인 주제의 키워드만 나열하며, 대화가 다른 주제로 넘어갔다면 그 이전 대화의 키워드는 무시합니다):\n\n${conversationText}`;

    const body = {
        contents: [{ role: 'user', parts: [{ text: keywordPrompt }] }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 100 }
    };

    let keywords = conversationText.trim(); // Fallback to original text
    try {
        const keywordData = await callGemini('gemini-2.5-flash-lite', apiKey, body, env, 'AutoRAG Keyword Extraction');
        const extractedKeywords = keywordData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (extractedKeywords) {
            keywords = extractedKeywords;
        }
    } catch (error) {
        await logError(error, env, 'AutoRAG Keyword Extraction');
    }
    
    // Cloudflare AutoRAG로 검색
    try {
      const answer = await env.AI.autorag("sekai").search({
        query: keywords, // Use extracted keywords
      });
      
      if (answer && answer.length > 0) {
        // Enhanced extraction to preserve filename metadata
        const extractedResults = extractAutoragResultsForChat(answer, env);
        
        // Format results with filename information when available
        const formattedResults = extractedResults.map(result => {
          let resultText = result.text;
          
          // Add filename information if available
          if (result.filename) {
            resultText = `📁 ${result.filename}\n${result.text}`;
          } else if (result.source && !result.source.startsWith('검색 결과') && !result.source.startsWith('문서')) {
            resultText = `📋 ${result.source}\n${result.text}`;
          }
          
          return resultText;
        });
        
        return formattedResults.join('\n\n');
      }
    } catch (autoragError) {
      await logError(autoragError, env, 'AutoRAG Search');
      // AutoRAG 실패 시 null 반환 (대화는 계속 진행)
    }
    
    return null;
  } catch (error) {
    await logError(error, env, 'Get AutoRAG Memory Context');
    return null;
  }
}

// Enhanced autorag results extraction for chat context (simplified version for gemini.js)
function extractAutoragResultsForChat(results) {
  if (!results) {
    return [];
  }

  let extractedResults = [];

  // Case 1: Results is a simple array of strings
  if (Array.isArray(results) && results.every(item => typeof item === 'string')) {
    extractedResults = results.map((result, index) => ({
      source: `검색 결과 ${index + 1}`,
      text: result,
      filename: null
    }));
  }
  // Case 2: Results is an object with array property
  else {
    const potentialResultKeys = ['results', 'data', 'documents', 'passages'];
    let found = false;
    
    for (const key of potentialResultKeys) {
      if (results[key] && Array.isArray(results[key])) {
        extractedResults = results[key].map((result, index) => {
          if (typeof result === 'string') {
            return { source: `검색 결과 ${index + 1}`, text: result, filename: null };
          }
          if (typeof result === 'object' && result !== null) {
            // Extract filename from various possible metadata locations
            let filename = result.filename || 
                         result.metadata?.filename || 
                         result.metadata?.file || 
                         result.metadata?.source_file ||
                         result.source_metadata?.filename ||
                         result.document_metadata?.filename;
            
            let source = filename || 
                        result.source || 
                        result.metadata?.source || 
                        `검색 결과 ${index + 1}`;
            
            return {
              source: source,
              text: result.text || result.content || result.passage || JSON.stringify(result),
              filename: filename
            };
          }
          return { source: `검색 결과 ${index + 1}`, text: String(result), filename: null };
        });
        found = true;
        break;
      }
    }

    if (!found) {
      // Case 3: Results is a single object with text/content
      if (typeof results === 'object' && (results.text || results.content)) {
        let filename = results.filename || 
                      results.metadata?.filename || 
                      results.metadata?.file || 
                      results.metadata?.source_file ||
                      results.source_metadata?.filename ||
                      results.document_metadata?.filename;
        
        extractedResults = [{
          source: filename || results.source || '검색 결과',
          text: results.text || results.content,
          filename: filename
        }];
      }
      // Case 4: Results is a single string
      else if (typeof results === 'string') {
        extractedResults = [{
          source: '검색 결과',
          text: results,
          filename: null
        }];
      }
      // Fallback: Unknown structure
      else {
        extractedResults = [{
          source: '알 수 없는 형식의 결과',
          text: JSON.stringify(results, null, 2),
          filename: null
        }];
      }
    }
  }

  return extractedResults;
}


function parseCharacterCall(content) {
  const callPattern = /@([^\s@]+(?:\s+[^[\@]+)*)\s*$/;
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
      const cacheKey = `chat_history:${conversationId}`;
      await env.KV.put(cacheKey, historyJson);
    }
  } catch (error) {
    await logError(error, env, 'Refresh Chat History Cache');
  }
}

// Main function to get chat history, using cache first.
async function getChatHistory(conversationId, env) {
  try {
    // 1. Try to get from cache
    const cacheKey = `chat_history:${conversationId}`;
    const cachedHistory = await env.KV.get(cacheKey);

    if (cachedHistory) {
      try {
        // If cache hit, return parsed data
        return JSON.parse(cachedHistory);
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
          WHEN cp.character_type = 'official' THEN c.nickname
          ELSE NULL
        END as nickname,
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

function uint8ArrayToBinaryString(uint8Array) {
    let binaryString = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
        binaryString += String.fromCharCode.apply(null, uint8Array.subarray(i, i + chunkSize));
    }
    return binaryString;
}

async function getLatestImagesFromHistory(conversationId, env, limit = 2) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT f.filename, f.mime_type, f.r2_key FROM messages m
       JOIN files f ON m.file_id = f.id
       WHERE m.conversation_id = ? AND m.message_type = 'image'
       ORDER BY m.created_at DESC
       LIMIT ?`
    ).bind(conversationId, limit).all();
    
    if (!results || results.length === 0) return [];
    
    const images = [];
    for (const result of results) {
      try {
        // Check if it's a generated image (stored with r2_key) or uploaded image
        const key = result.r2_key || `image_uploads/${result.filename}`;
        const object = await env.R2.get(key);
        
        if (object) {
          const arrayBuffer = await object.arrayBuffer();
          const binaryString = uint8ArrayToBinaryString(new Uint8Array(arrayBuffer));
          const base64Data = btoa(binaryString);
          
          images.push({
            base64Data,
            mimeType: result.mime_type,
            fileName: result.filename
          });
        }
      } catch (imageError) {
        await logError(imageError, env, `Get Latest Images - Processing ${result.filename}`);
        // Continue with other images even if one fails
      }
    }
    
    return images;
  } catch (error) {
    await logError(error, env, 'Get Latest Images');
    return [];
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

    const participantNames = participants.map(p => p.nickname ? `${p.name}(${p.nickname})` : p.name);
    const userNickname = user.nickname || '사용자';
    
    const prompt = `최근 대화 내용입니다:\n${historyText}\n\n대화 참가자 목록: [${participantNames.join(', ')}, ${userNickname}]\n\n바로 직전 발언자는 "${lastSpeakerName}"입니다. 대화의 흐름상 꼭 필요한 경우가 아니라면, "${lastSpeakerName}"가 아닌 다른 참가자를 다음 발언자로 선정해주세요. 다음으로 답변할 대화 참가자를 목록에서 선정해 이름만 정확히 말해주세요.`;

    const apiKey = user.gemini_api_key || env.GEMINI_API_KEY;
    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 50 }
    };

    let nextSpeakerName = null;
    try {
        const nextSpeakerData = await callGemini('gemini-2.5-flash-lite', apiKey, body, env, 'Select Speaker');
        nextSpeakerName = nextSpeakerData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    } catch (error) {
        await logError(error, env, 'handleSelectSpeaker');
        return new Response(JSON.stringify({ speaker: null, reason: 'selection_failed' }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (!nextSpeakerName || nextSpeakerName.includes('유저') || nextSpeakerName.includes(userNickname)) {
        return new Response(JSON.stringify({ speaker: null, reason: 'user_selected' }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Find the selected character with flexible matching
    let selectedCharacter = null;

    // Priority 1: Exact match on name or nickname
    selectedCharacter = participants.find(p => p.name === nextSpeakerName || (p.nickname && p.nickname === nextSpeakerName));

    // Priority 2: Match on "name(nickname)" format
    if (!selectedCharacter) {
        selectedCharacter = participants.find(p => nextSpeakerName === `${p.name}(${p.nickname})`);
    }

    // Priority 3: Lenient includes check (handles partial matches)
    if (!selectedCharacter) {
        selectedCharacter = participants.find(p => nextSpeakerName.includes(p.name) || (p.nickname && nextSpeakerName.includes(p.nickname)));
    }

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

