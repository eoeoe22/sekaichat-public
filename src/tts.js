import { logError, getUserFromRequest, callGemini } from './utils.js';

/**
 * TTS (Text-to-Speech) API handler using ProsekaTTS service
 */
export async function handleTTS(request, env) {
  try {
    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response('POST 요청만 지원합니다.', { status: 405 });
    }

    // Verify user authentication
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Parse request body
    const { text, character_name_code, language } = await request.json();

    if (!text || !character_name_code) {
      return new Response('필수 파라미터(text, character_name_code)가 누락되었습니다.', { status: 400 });
    }

    // Verify the character exists and supports TTS (must be "프로젝트 세카이" character)
    const character = await env.DB.prepare(
      'SELECT id, name, name_code, sekai FROM characters WHERE name_code = ? AND sekai = ?'
    ).bind(character_name_code, '프로젝트 세카이').first();

    if (!character) {
      return new Response('해당 캐릭터는 TTS를 지원하지 않습니다.', { status: 400 });
    }

    // ProsekaTTS API endpoint URL
    const apiUrl = env.TTS_SERVICE_URL;

    // Request body for ProsekaTTS API (matching the example format)
    const ttsRequest = {
      text: text,
      speaker: character_name_code,
      speed: 1.0,
      is_phoneme: false,
    };

    try {
      console.log(`TTS API call starting: ${apiUrl} with character: ${character_name_code}`, {
        request: ttsRequest,
        textLength: text.length
      });
      
      // Try calling ProsekaTTS API
      const apiKey = env.TTS_API_KEY;
      if (!apiKey) {
        throw new Error('TTS API key not configured');
      }

      let apiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'audio/wav',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(ttsRequest)
      });

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        console.error('TTS API 에러 응답:', {
          status: apiResponse.status,
          statusText: apiResponse.statusText,
          body: errorText,
          character: character_name_code
        });
        await logError(new Error(`TTS API error: ${apiResponse.status} ${apiResponse.statusText} - ${errorText}`), env, 'TTS API Call');
        throw new Error(`API 호출 실패: ${apiResponse.status} ${apiResponse.statusText}`);
      }

      console.log('TTS API 성공 응답:', {
        status: apiResponse.status,
        contentType: apiResponse.headers.get('content-type'),
        contentLength: apiResponse.headers.get('content-length')
      });

      // According to the example, ProsekaTTS API returns audio data directly as stream
      // Use TransformStream to pipe the response directly to client
      const { readable, writable } = new TransformStream();
      
      // Handle potential streaming errors
      apiResponse.body.pipeTo(writable).catch(async (error) => {
        console.error('TTS 스트리밍 오류:', error);
        await logError(error, env, 'TTS Streaming Error');
      });

      // Return audio file (wav) as response with proper headers
      return new Response(readable, {
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Disposition': 'attachment; filename="speech.wav"'
        }
      });

    } catch (error) {
      await logError(error, env, 'TTS API Call');
      // Check if the error is a network error, suggesting the server is down.
      if (error instanceof TypeError) {
        return new Response('지금은 TTS 서버가 꺼져있으니 나중에 시도해주세요.', { status: 503 });
      }
      return new Response('오디오 생성 중 오류가 발생했습니다.', { status: 500 });
    }

  } catch (error) {
    await logError(error, env, 'Handle TTS');
    return new Response('TTS 요청 처리 중 오류가 발생했습니다.', { status: 500 });
  }
}

/**
 * TTS Translation API handler using Gemini
 * Note: Using gemini-2.0-flash as primary model since 2.5 models mentioned in 
 * instructions don't appear to exist in current Gemini API
 */
export async function handleTTSTranslation(request, env) {
  try {
    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response('POST 요청만 지원합니다.', { status: 405 });
    }

    // Verify user authentication
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Parse request body
    let requestBody;
    try {
      requestBody = await request.json();
    } catch (error) {
      return new Response('잘못된 JSON 형식입니다.', { status: 400 });
    }

    const { text, target } = requestBody;

    if (!text) {
      return new Response('필수 파라미터(text)가 누락되었습니다.', { status: 400 });
    }

    // Validate text length
    if (text.length > 1000) {
      return new Response('텍스트가 너무 깁니다. (최대 1000자)', { status: 400 });
    }

    // Check user's TTS language preference
    const userTtsPreference = user.tts_language_preference || 'jp';
    
    // If user prefers Korean, return original text without translation
    if (userTtsPreference === 'kr') {
      return new Response(JSON.stringify({
        translatedText: text
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // If user prefers Japanese, translate to Japanese
    const prompt = `다음 텍스트를 자연스러운 일본어로 번역해주세요. 번역된 결과만 출력하고 다른 설명은 생략해주세요.\n\n텍스트: ${text}`;

    try {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('Gemini API key not configured');
      }

      const body = {
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1000
        }
      };

      const result = await callGemini('gemini-2.5-flash-lite', apiKey, body, env, 'TTS Translation');
      console.log('Gemini API 응답:', result);
      
      const translatedText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (!translatedText) {
        console.error('빈 번역 결과:', result);
        throw new Error('번역 결과를 받을 수 없습니다.');
      }

      console.log('번역 성공:', {
        original: text,
        translated: translatedText,
        target: 'japanese'
      });

      return new Response(JSON.stringify({
        translatedText: translatedText
      }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      await logError(error, env, 'TTS Translation API Call');
      return new Response('번역 중 오류가 발생했습니다.', { status: 500 });
    }

  } catch (error) {
    await logError(error, env, 'Handle TTS Translation');
    return new Response('번역 요청 처리 중 오류가 발생했습니다.', { status: 500 });
  }
}

/**
 * Base64 string to ArrayBuffer conversion helper function
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * TTS API test endpoint for debugging ProsekaTTS API
 */
export async function handleTTSTest(request, env) {
  try {
    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response('POST 요청만 지원합니다.', { status: 405 });
    }

    // Verify user authentication
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Test payload for ProsekaTTS API
    const testPayload = {
      text: "안녕하세요",           // Test text
      speaker: "星乃 一歌",          // Test character
      speed: 1.0,                   // Speed
      is_phoneme: false,            // Is phoneme
    };

    const apiUrl = env.TTS_SERVICE_URL;
    let testResult = {
      endpoint: apiUrl,
      payload: testPayload,
      results: []
    };

    // Test 1: Try calling the API
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'audio/wav',
        },
        body: JSON.stringify(testPayload)
      });
      
      testResult.results.push({
        method: 'call',
        status: response.status,
        statusText: response.statusText,
        success: response.ok
      });
      
      if (response.ok) {
        // For ProsekaTTS API, response is audio stream, not JSON
        testResult.results[0].hasAudioData = true;
        testResult.results[0].contentType = response.headers.get('content-type');
      }
    } catch (error) {
      testResult.results.push({
        method: 'call',
        error: error.message,
        success: false
      });
    }

    return new Response(JSON.stringify(testResult, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    await logError(error, env, 'TTS Test');
    return new Response('TTS 테스트 중 오류가 발생했습니다.', { status: 500 });
  }
}

/**
 * TTS Debug endpoint to help troubleshoot API issues
 */
export async function handleTTSDebug(request, env) {
  try {
    const debugInfo = {
      timestamp: new Date().toISOString(),
      environment: {
        hasApiKey: !!env.GEMINI_API_KEY,
        apiKeyPrefix: env.GEMINI_API_KEY ? env.GEMINI_API_KEY.substring(0, 10) + '...' : 'Not configured',
        ttsServiceUrl: env.TTS_SERVICE_URL || 'Not configured'
      },
      models: {
        primary: 'gemini-2.5-flash-lite',
        fallback: 'gemini-2.0-flash',
        endpoints: [
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
        ]
      },
      testCases: [
        { text: '안녕하세요', target: 'japanese' }
      ]
    };

    return new Response(JSON.stringify(debugInfo, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    await logError(error, env, 'TTS Debug');
    return new Response('Debug 정보 조회 중 오류가 발생했습니다.', { status: 500 });
  }
}

