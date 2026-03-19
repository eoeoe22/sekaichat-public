import { logError, getUserFromRequest, callGemini, callGeminiStream, callGeminiViaProxy } from './utils.js';
import { getExtendedCharacterPrompt } from './user-characters.js';
import { updateConversationTitle } from './conversations.js';

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



// 캐릭터 호출 시스템 안내
const CHARACTER_CALL_SYSTEM = `
[다른 캐릭터 호출]

다른 캐릭터가 다음으로 말하며 대화를 이어가게 하려는 경우, 캐릭터의 이름을 명시적으로 메시지에 포함하세요. 
특별한 호출 명령어를 사용할 필요는 없으며, 자연스러운 대화처럼 이름을 부르세요.
자기 자신을 호출하지 마세요.
호출 기능 이용은 필수가 아니며, 필요한 경우에만 적절히 사용하세요.

현재 호출 가능한 대화 참여 캐릭터:
   {participantsList}
`;

export async function handleChat(request, env) {
  try {
    const { message, model, conversationId, imageData, role = 'user' } = await request.json();

    const user = await getUserFromRequest(request, env);
    if (!user) return new Response('으....이....', { status: 401 });

    // 사용자 존재 여부 확인 (Foreign Key 제약조건 오류 방지)
    const userExists = await env.DB.prepare('SELECT id FROM users WHERE id = ?')
      .bind(user.id).first();

    if (!userExists) {
      await logError(new Error(`User ID ${user.id} from JWT token does not exist in database`), env, 'Handle Chat - User Validation');
      return new Response('Invalid user session. Please login again.', { status: 401 });
    }

    // 대화방 소유권 확인
    const conversation = await env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) {
      return new Response('대화방을 찾을 수 없거나 접근 권한이 없습니다.', { status: 404 });
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







export async function handleCharacterGeneration(request, env) {
  // 요청 본문을 미리 파싱하고 변수들을 상위 스코프에 선언
  let characterId, conversationId, imageData, workMode, showTime, situationPrompt;
  let autoCallCount, thinkingLevel, isContinuous;
  let user, participant, history, characterPrompt, maxAutoCallSequence, participants;
  let commonRulesPrompt, currentTime, latestImages, apiKey, autoragContext;

  try {
    const requestBody = await request.json();
    characterId = requestBody.characterId;
    conversationId = requestBody.conversationId;
    imageData = requestBody.imageData;
    workMode = requestBody.workMode;
    showTime = requestBody.showTime;
    situationPrompt = requestBody.situationPrompt;

    autoCallCount = requestBody.autoCallCount;
    thinkingLevel = requestBody.thinkingLevel;
    isContinuous = requestBody.isContinuous;

    user = await getUserFromRequest(request, env);
    if (!user) return new Response('으....이....', { status: 401 });

    // 대화방 소유권 확인
    const conversation = await env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) {
      return new Response('대화방을 찾을 수 없거나 접근 권한이 없습니다.', { status: 404 });
    }

    participant = await env.DB.prepare(
      'SELECT character_type FROM conversation_participants WHERE conversation_id = ? AND character_id = ?'
    ).bind(conversationId, characterId).first();

    if (!participant) {
      return new Response('참여하지 않은 캐릭터입니다.', { status: 400 });
    }

    history = await getChatHistory(conversationId, env);
    characterPrompt = await getExtendedCharacterPrompt(characterId, env);
    if (!characterPrompt) return new Response('캐릭터를 찾을 수 없습니다.', { status: 404 });

    maxAutoCallSequence = user.max_auto_call_sequence || 3;
    participants = await getConversationParticipants(conversationId, env);
    autoragContext = await getAutoragMemoryContext(conversationId, user, env);

    commonRulesPrompt = '';
    if (characterId !== 0) {
      if (workMode) {
        commonRulesPrompt = env.WORK_MODE_PROMPT;
      } else {
        commonRulesPrompt = env.COMMON_RULES_PROMPT;
      }
    }

    currentTime = showTime ? getCurrentSeoulTime() : null;
    latestImages = imageData ? [imageData] : await getLatestImagesFromHistory(conversationId, env);
    apiKey = user.gemini_api_key || env.GEMINI_API_KEY;

  } catch (error) {
    await logError(error, env, 'Character Generation - Request Parsing');
    return new Response('으....이....', { status: 500 });
  }

  // SSE 스트리밍 응답 생성
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 시스템 프롬프트 생성
        const body = buildGeminiRequestBody(
          characterPrompt, commonRulesPrompt, history, user.nickname, user.self_introduction,
          currentTime, latestImages, autoCallCount || 0, maxAutoCallSequence,
          participants, situationPrompt, characterId, participant.character_type,
          env, autoragContext, thinkingLevel || 'MEDIUM',
          isContinuous
        );

        let fullText = '';
        let usedFallback = false;

        try {
          // 1차 시도: SDK 스트리밍
          const streamResult = await callGeminiStream('gemini-3-flash-preview', apiKey, body, env, 'Character Generation Stream');

          try {
            for await (const chunk of streamResult.stream) {
              try {


                const text = chunk.text();
                if (text) {
                  fullText += text;
                  // SSE 포맷으로 전송
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text, type: 'chunk' })}\n\n`));
                }
              } catch (chunkError) {
                console.error('청크 처리 중 오류:', chunkError.message);
                // 특정 청크 오류 시에도 수집된 텍스트가 있으면 계속 진행하거나 안전하게 종료 시도
              }
            }
          } catch (innerStreamError) {
            console.error('스트림 반복 중 오류:', innerStreamError.message);
            // 이미 데이터를 보냈다면 여기서 중단하고 수집된 데이터라도 처리하도록 함
          }
        } catch (streamError) {
          console.error('스트리밍 실패, 프록시로 폴백:', streamError.message);

          // 2차 시도: 프록시 폴백 (논스트리밍)
          try {
            const fallbackResult = await callGeminiViaProxy('gemini-3-flash-preview', apiKey, body, env, 'Character Generation Fallback');
            if (fallbackResult.candidates && fallbackResult.candidates[0]?.content?.parts) {
              const parts = fallbackResult.candidates[0].content.parts;

              for (const part of parts) {
                if (part.text) {
                  fullText += part.text;
                }
              }

              usedFallback = true;
              // 프록시 결과는 한번에 전송
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: fullText, type: 'fallback' })}\n\n`));
            } else {
              throw new Error('프록시 응답이 비어있습니다.');
            }
          } catch (proxyError) {
            await logError(proxyError, env, 'Character Generation - Proxy Fallback');
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '응답 생성에 실패했습니다.', type: 'error' })}\n\n`));
            controller.close();
            return;
          }
        }

        // 응답 파싱 및 캐릭터 호출
        const { cleanContent: finalContent, calledCharacter } = parseCharacterCall(fullText);

        // ★★★ 스트리밍 완료 후 DB 저장 ★★★
        const newMessage = await saveChatMessage(conversationId, 'assistant', finalContent, env, characterId, autoCallCount || 0, null, participant.character_type);

        // 완료 이벤트 전송
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'done',
          messageId: newMessage.id,
          content: finalContent,
          calledCharacter,
          usedFallback
        })}\n\n`));

      } catch (error) {
        await logError(error, env, 'Character Generation Stream');
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '응답 생성 중 오류가 발생했습니다.', type: 'error' })}\n\n`));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
export async function handleAutoReply(request, env) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { conversationId } = await request.json();
    if (!conversationId) {
      return new Response('Missing conversationId', { status: 400 });
    }

    // 대화방 소유권 확인
    const conversation = await env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) {
      return new Response('대화방을 찾을 수 없거나 접근 권한이 없습니다.', { status: 404 });
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

      // 3. Determine next speaker
      let nextSpeakerName = null;
      let selectedCharacter = null;

      // [Optimization] If there is only one character, select them only for the first response
      if (participants.length === 1) {
        if (i > 0) break;
        selectedCharacter = participants[0];
      } else {
        // Ask model to select next speaker (only for multi-character chats)
        const participantNames = participants.map(p => p.name);
        const userNickname = user.nickname || '사용자';

        const prompt = `최근 대화 내용입니다:\n${historyText}\n\n대화 참가자 목록: [${participantNames.join(', ')}, ${userNickname}]\n\n다음으로 답변할 대화 참가자를 목록에서 선정해 이름만 정확히 말해주세요.`;

        const apiKey = user.gemini_api_key || env.GEMINI_API_KEY;
        const body = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 1.0, maxOutputTokens: 50 }
        };

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
        selectedCharacter = participants.find(p => nextSpeakerName.includes(p.name));
        if (!selectedCharacter) {
          continue;
        }
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

/**
 * Gemini API 요청 본문을 생성하는 헬퍼 함수
 * 스트리밍과 논스트리밍 호출 모두에서 재사용됨
 */
function buildGeminiRequestBody(
  characterPrompt, commonRulesPrompt, history, userNickname, userSelfIntro,
  currentTime, imageDataArray, autoCallSequence, maxAutoCallSequence,
  participants, situationPrompt, currentCharacterId, currentCharacterType,
  env, autoragContext, thinkingLevel = 'MEDIUM',
  isContinuous = false
) {
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

  if (isContinuous && participants && participants.length > 0) {
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
      temperature: 0.8, topK: 40, topP: 0.95, maxOutputTokens: 2048,
      thinkingConfig: {
        thinkingLevel: thinkingLevel
      }
    }
  };



  return body;
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
           LEFT JOIN characters c ON m.character_id = c.id AND m.character_type = 'official'
           LEFT JOIN user_characters uc ON m.user_character_id = uc.id AND m.character_type = 'user'
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


export async function handleSelectSpeaker(request, env) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { conversationId, autoCallCount, maxSequence, isContinuous } = await request.json();
    if (!conversationId) {
      return new Response('Missing conversationId', { status: 400 });
    }

    // 대화방 소유권 확인
    const conversation = await env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();

    if (!conversation) {
      return new Response('대화방을 찾을 수 없거나 접근 권한이 없습니다.', { status: 404 });
    }

    // Check if continuous call limit has been reached
    const currentAutoCallCount = autoCallCount || 0;
    const maxAutoCallSequence = maxSequence || (user.max_auto_call_sequence || 1);
    if (currentAutoCallCount >= maxAutoCallSequence) {
      return new Response(JSON.stringify({ speaker: null, reason: 'limit_reached' }), { headers: { 'Content-Type': 'application/json' } });
    }

    const participants = await getConversationParticipants(conversationId, env);
    if (participants.length === 0) {
      return new Response(JSON.stringify({ speaker: null, reason: 'no_participants' }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 대화 참여자가 1명인 경우: 연속 응답 옵션에 상관없이 1회만 답변하도록 함
    if (participants.length === 1) {
      if ((autoCallCount || 0) > 0) {
        return new Response(JSON.stringify({ speaker: null, reason: 'single_participant_limit' }), { headers: { 'Content-Type': 'application/json' } });
      }
      const characterDetails = await getCharacterDetails(participants[0].id, participants[0].type, env);
      return new Response(JSON.stringify({ speaker: characterDetails }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Fetch only the last message for analysis
    const recentMessages = await getRecentMessages(conversationId, 1, env);
    const lastMessage = recentMessages.length > 0 ? recentMessages[0] : null;

    if (!lastMessage || !lastMessage.content) {
      return new Response(JSON.stringify({ speaker: null, reason: 'no_message' }), { headers: { 'Content-Type': 'application/json' } });
    }

    const lastSpeakerName = lastMessage.character_name || (lastMessage.role === 'user' ? (user.nickname || '사용자') : '알 수 없음');
    const lastMessageContent = lastMessage.content;

    const participantNames = participants.map(p => p.nickname ? `${p.name}(${p.nickname})` : p.name);
    const userNickname = user.nickname || '사용자';

    // 1차 자동 답변(유저 메시지 직후)이거나 연속 응답 모드인 경우 더 적극적으로 선택
    const isFirstAutoReply = (autoCallCount || 0) === 0;

    // Analyze only the last message to find the next speaker
    const prompt = `대화 맥락을 분석하여 다음 발언자를 선택하세요.

대화 참가자 목록: [${participantNames.join(', ')}, ${userNickname}]
최근 메시지: "${lastMessageContent}"
최근 발언자: "${lastSpeakerName}"

지침:
1. 최근 메시지에서 특정 참가자를 명시적으로 불렀거나 대화를 넘겼다면, 해당 참가자의 이름만 정확히 출력하세요.
2. 유저(${userNickname})에게 대화를 넘겼거나 유저의 차례라면 "유저"라고 출력하세요.
3. ${isFirstAutoReply ? '누구도 명시적으로 호출되지 않았다면, 대화 흐름상 가장 적절한 다음 캐릭터를 선택하여 이름만 출력하세요.' : '누구도 명시적으로 호출되지 않았거나 호출이 불분명하면 "없음"이라고 출력하세요.'}

다음 발화자 이름:`;

    const apiKey = user.gemini_api_key || env.GEMINI_API_KEY;
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 50 }
    };

    let nextSpeakerName = null;
    try {
      const nextSpeakerData = await callGemini('gemini-3-flash-preview', apiKey, body, env, 'Select Speaker');
      nextSpeakerName = nextSpeakerData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    } catch (error) {
      await logError(error, env, 'handleSelectSpeaker');
      return new Response(JSON.stringify({ speaker: null, reason: 'selection_failed' }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Check for "없음" or user selection
    if (!nextSpeakerName || nextSpeakerName === '없음' || nextSpeakerName.includes('유저') || nextSpeakerName.includes(userNickname)) {
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
  }
  return character;
}

// Helper function to get recent messages
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
