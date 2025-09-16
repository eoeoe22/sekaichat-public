import { logError } from './utils.js';

// Rate limiting for guest users (in-memory store)
const guestRateLimit = new Map(); // IP -> { count, resetTime }
const GUEST_RATE_LIMIT_REQUESTS = 6;
const GUEST_RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// Turnstile verification for guest access
async function verifyTurnstile(token, env) {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token
      })
    });
    
    const result = await response.json();
    return result.success;
  } catch {
    return false;
  }
}

// Check rate limit for guest users
function checkGuestRateLimit(clientIP) {
  const now = Date.now();
  
  // Clean up expired entries periodically
  cleanupExpiredRateLimits(now);
  
  const userLimit = guestRateLimit.get(clientIP);
  
  if (!userLimit || now > userLimit.resetTime) {
    // Reset or initialize
    guestRateLimit.set(clientIP, {
      count: 1,
      resetTime: now + GUEST_RATE_LIMIT_WINDOW
    });
    return true;
  }
  
  if (userLimit.count >= GUEST_RATE_LIMIT_REQUESTS) {
    return false;
  }
  
  userLimit.count++;
  return true;
}

// Clean up expired rate limit entries to prevent memory leaks
function cleanupExpiredRateLimits(now) {
  for (const [ip, limit] of guestRateLimit.entries()) {
    if (now > limit.resetTime) {
      guestRateLimit.delete(ip);
    }
  }
}

// Get client IP from request
function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || 
         request.headers.get('X-Forwarded-For') || 
         request.headers.get('X-Real-IP') || 
         '0.0.0.0';
}

// Get Project Sekai characters only
export async function getProjectSekaiCharacters(env) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT id, name, profile_image, system_prompt
      FROM characters 
      WHERE sekai = ?
      ORDER BY id ASC
    `).bind('프로젝트 세카이').all();
    
    return results;
  } catch (error) {
    await logError(error, env, 'Guest: Get Project Sekai Characters');
    return [];
  }
}

export const handleGuest = {
  // Verify Turnstile and create guest session
  async verifyAccess(request, env) {
    try {
      const formData = await request.formData();
      const turnstileToken = formData.get('cf-turnstile-response');
      
      const turnstileValid = await verifyTurnstile(turnstileToken, env);
      if (!turnstileValid) {
        return new Response('Turnstile verification failed', { status: 400 });
      }
      
      // Create a simple guest session token (not JWT, just a random string)
      const guestToken = crypto.randomUUID();
      
      const response = new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
      
      // Set guest session cookie with proper domain settings
      const url = new URL(request.url);
      const cookieOptions = [
        `guest_session=${guestToken}`,
        'Path=/',
        'SameSite=Strict',
        'Max-Age=3600'
      ];
      
      // Add domain for non-local environments (matching auth.js pattern)
      if (!url.hostname.includes('localhost') && 
          !url.hostname.includes('127.0.0.1') && 
          !url.hostname.includes('.local')) {
        cookieOptions.push(`Domain=${url.hostname}`);
      }
      
      // Add Secure flag for HTTPS
      if (url.protocol === 'https:') {
        cookieOptions.push('Secure');
      }
      
      response.headers.set('Set-Cookie', cookieOptions.join('; '));
      
      return response;
    } catch (error) {
      await logError(error, env, 'Guest: Verify Access');
      return new Response('Internal server error', { status: 500 });
    }
  },
  
  // Get available characters for guest (Project Sekai only)
  async getCharacters(request, env) {
    try {
      const characters = await getProjectSekaiCharacters(env);
      
      if (characters.length === 0) {
        return new Response(JSON.stringify({
          error: 'No Project Sekai characters found'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      return new Response(JSON.stringify(characters), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Guest: Get Characters');
      return new Response('Failed to get characters', { status: 500 });
    }
  },
  
  // Guest chat endpoint (no database storage)
  async chat(request, env) {
    try {
      // Check guest session
      const cookies = request.headers.get('Cookie');
      if (!cookies || !cookies.includes('guest_session=')) {
        return new Response('Unauthorized', { status: 401 });
      }
      
      // Check rate limit
      const clientIP = getClientIP(request);
      if (!checkGuestRateLimit(clientIP)) {
        return new Response('Rate limit exceeded. Please wait before sending another message.', { status: 429 });
      }
      
      const { message, characters, autoReplyMode } = await request.json();
      
      if (!message || !characters || !Array.isArray(characters) || characters.length === 0) {
        return new Response('Invalid request data', { status: 400 });
      }
      
      // Get character data for validation
      const validCharacters = await getProjectSekaiCharacters(env);
      const validCharacterIds = validCharacters.map(c => c.id);
      
      // Validate all requested characters are from Project Sekai
      const invalidCharacters = characters.filter(charId => !validCharacterIds.includes(charId));
      if (invalidCharacters.length > 0) {
        return new Response('Invalid characters selected', { status: 400 });
      }
      
      // Call gemini with guest mode
      const response = await handleGuestChat(message, characters, validCharacters, autoReplyMode, env);
      
      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      await logError(error, env, 'Guest: Chat');
      return new Response('Chat failed', { status: 500 });
    }
  }
};

// Handle guest chat with Gemini
async function handleGuestChat(userMessage, characterIds, availableCharacters, autoReplyMode, env) {
  try {
    // Get character data
    const characters = availableCharacters.filter(c => characterIds.includes(c.id));
    
    if (characters.length === 0) {
      throw new Error('No valid characters found');
    }
    
    // For single character, respond directly
    if (characters.length === 1) {
      const character = characters[0];
      const response = await generateGuestResponse(userMessage, character, [], env);
      return {
        responses: [{
          character: character,
          message: response
        }]
      };
    }
    
    // For multiple characters in auto-reply mode, select speaker first
    if (autoReplyMode) {
      const selectedCharacter = await selectSpeakerForGuest(userMessage, characters, [], env);
      const response = await generateGuestResponse(userMessage, selectedCharacter, [], env);
      return {
        responses: [{
          character: selectedCharacter,
          message: response
        }]
      };
    }
    
    // For multiple characters in manual mode, return all responses
    const responses = [];
    for (const character of characters) {
      const response = await generateGuestResponse(userMessage, character, [], env);
      responses.push({
        character: character,
        message: response
      });
    }
    
    return { responses };
    
  } catch (error) {
    await logError(error, env, 'Guest: Handle Chat');
    throw error;
  }
}

// Generate response using guest Gemini API key and models
async function generateGuestResponse(userMessage, character, conversationHistory, env) {
  try {
    const commonRules = `
- 대답 길이는 되도록 3줄 이하로 유지합니다.
- (매우중요!!) 캐릭터 설정·세계관을 벗어나는 발언 지양합니다(메타발언 금지).
- 사용자에게 기본적으로 친근하게 반말을 사용하며, '~아', '~야' 또는 닉네임 그대로 호칭등 친근하게 부릅니다. (~님 금지)
- 대화 내역이 비어있다면 인사부터 합니다.

★★★ 매우 중요한 규칙 ★★★
- 당신은 오직 한 명의 캐릭터입니다. 절대로 다른 캐릭터의 대사나 행동을 대신 생성하지 마세요.
- 한 번의 응답에서는 오직 자신의 캐릭터만의 메시지를 "한개만" 작성합니다.
- 캐릭터명 : 형식으로 응답하지 마세요. 메시지 내용만 작성하세요.
- 다른 캐릭터들이 말하는 것처럼 가정하여 대화를 이어가지 말고, 하나의 메시지만 작성하세요.

사용 가능 언어: 한국어/일본어
`;
    
    const fullPrompt = `${character.system_prompt}

${commonRules}

사용자: ${userMessage}`;
    
    const messages = [
      {
        role: 'user',
        parts: [{ text: fullPrompt }]
      }
    ];
    
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GUEST_GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: messages,
        generationConfig: {
          temperature: 0.8,
          topK: 40,
          topP: 0.9,
          maxOutputTokens: 1000,
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Invalid response from Gemini API');
    }
    
    return data.candidates[0].content.parts[0].text;
    
  } catch (error) {
    await logError(error, env, 'Guest: Generate Response');
    return '죄송해요, 응답을 생성하는 중에 오류가 발생했습니다.';
  }
}

// Select speaker for auto-reply mode (using 2.5 flash as specified)
async function selectSpeakerForGuest(userMessage, characters, conversationHistory, env) {
  try {
    const characterList = characters.map(c => `- ${c.name}: ${c.system_prompt}`).join('\n');
    
    const prompt = `다음 캐릭터들 중에서 사용자의 메시지에 가장 적절하게 응답할 캐릭터를 선택해주세요.

캐릭터 목록:
${characterList}

사용자 메시지: "${userMessage}"

캐릭터 이름만 정확히 답해주세요.`;
    
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GUEST_GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 50,
        }
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const selectedName = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      
      const selectedCharacter = characters.find(c => c.name === selectedName);
      if (selectedCharacter) {
        return selectedCharacter;
      }
    }
    
    // Fallback to first character if selection fails
    return characters[0];
    
  } catch (error) {
    await logError(error, env, 'Guest: Select Speaker');
    return characters[0]; // Fallback
  }
}