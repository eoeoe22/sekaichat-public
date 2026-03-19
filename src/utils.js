import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Google Generative AI SDK 모델 인스턴스 생성
 * @param {string} apiKey - Gemini API 키
 * @param {string} modelName - 모델 이름 (예: 'gemini-2.5-flash')
 * @param {object} options - 추가 옵션 (generationConfig 등)
 * @returns {GenerativeModel} - SDK 모델 인스턴스
 */
function getGeminiModel(apiKey, modelName, options = {}) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: modelName, ...options });
}

async function getJwtSecretKey(env) {

  const secret = env.JWT_SECRET;
  const encoder = new TextEncoder();

  return await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// JWT를 생성하고 서명합니다.
export async function createJwt(payload, env) {
  // Payload 유효성 검사
  if (!payload || !payload.userId || typeof payload.userId !== 'number') {
    await logError(new Error(`Invalid payload for JWT creation: ${JSON.stringify(payload)}`), env, 'JWT Creation');
    throw new Error('Invalid user ID for JWT creation');
  }

  const key = await getJwtSecretKey(env);
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const dataToSign = `${encodedHeader}.${encodedPayload}`;
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(dataToSign));

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${dataToSign}.${encodedSignature}`;
}

// JWT를 검증하고 페이로드를 반환합니다.
export async function verifyJwt(token, env) {
  try {
    if (!token || typeof token !== 'string') {
      return null;
    }

    const key = await getJwtSecretKey(env);
    const [header, payload, signature] = token.split('.');

    if (!header || !payload || !signature) {
      return null;
    }

    const dataToVerify = `${header}.${payload}`;
    const encoder = new TextEncoder();

    // Signature를 ArrayBuffer로 디코딩
    let signatureBuffer;
    try {
      signatureBuffer = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    } catch (decodeError) {
      // Base64 디코딩 실패
      return null;
    }

    const isValid = await crypto.subtle.verify('HMAC', key, signatureBuffer, encoder.encode(dataToVerify));

    if (!isValid) {
      return null;
    }

    let decodedPayload;
    try {
      decodedPayload = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    } catch (parseError) {
      // JSON 파싱 실패
      return null;
    }

    // 토큰 만료 확인
    if (decodedPayload.exp && Date.now() > decodedPayload.exp) {
      return null;
    }

    return decodedPayload;
  } catch (error) {
    await logError(error, env, 'JWT Verify');
    return null;
  }
}


export function generateSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt);
  return crypto.subtle.digest('SHA-256', data)
    .then(buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join(''));
}

export function verifyPassword(password, hash, salt) {
  return hashPassword(password, salt).then(newHash => newHash === hash);
}

// JSON 응답 헬퍼
export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

// 에러 응답 헬퍼
export function errorResponse(message, status = 500) {
  return new Response(message, { status });
}

// 쿠키 옵션 빌드 헬퍼
export function buildCookieHeader(token, url, maxAge) {
  const cookieOptions = [
    `token=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    'Path=/'
  ];

  if (!url.hostname.includes('localhost') &&
      !url.hostname.includes('127.0.0.1') &&
      !url.hostname.includes('.local')) {
    cookieOptions.push(`Domain=${url.hostname}`);
  }

  if (url.protocol === 'https:') {
    cookieOptions.push('Secure');
  }

  return cookieOptions.join('; ');
}

// 에러 로그 기록 함수 (Workers 로그만 사용)
export async function logError(error, env, context = '') {
  const timestamp = new Date().toISOString();

  // Workers 로그에 출력
  console.error('=== 에러 로그 ===');
  console.error(`시간: ${timestamp}`);
  console.error(`컨텍스트: ${context}`);
  console.error(`메시지: ${error.message}`);
  console.error(`스택 트레이스: ${error.stack}`);
  console.error('================');
}

// 일반 디버그 로그 함수 (Workers 로그만 사용)
export function logDebug(message, context = '', data = null) {
  console.log(`[DEBUG] ${context}: ${message}`, data || '');
}


// 사용자 인증 정보 가져오기
export async function getAuth(request, env) {
  try {
    const cookie = request.headers.get('Cookie');
    if (!cookie) return null;

    const tokenMatch = cookie.match(/(?:^|[; ])token=([^; ]+)/);
    if (!tokenMatch) return null;

    const token = tokenMatch[1];
    if (!token) return null;

    return await verifyJwt(token, env);
  } catch (error) {
    await logError(error, env, 'GetAuth');
    return null;
  }
}

// 요청에서 사용자 정보 가져오기
export async function getUserFromRequest(request, env) {
  try {
    const cookies = request.headers.get('Cookie');
    if (!cookies) return null;

    const tokenMatch = cookies.match(/token=([^;]+)/);
    if (!tokenMatch) return null;

    const token = tokenMatch[1];
    const tokenData = await verifyJwt(token, env);
    if (!tokenData) return null;

    logDebug(`Looking up user with ID: ${tokenData.userId}`, 'Utils: GetUserFromRequest');

    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(tokenData.userId).first();

    if (!user) {
      logDebug(`User not found in database for ID: ${tokenData.userId}`, 'Utils: GetUserFromRequest');
    }

    return user;
  } catch (error) {
    await logError(error, env, 'Utils: GetUserFromRequest');
    return null;
  }
}

/**
 * Gemini API 호출을 위한 중앙 집중식 함수 (SDK 기반, 논스트리밍)
 * @param {string} modelName - 호출할 모델 이름 (예: 'gemini-3-flash-preview')
 * @param {string} apiKey - Gemini API 키
 * @param {object} body - API 요청 본문 (contents, generationConfig 등)
 * @param {object} env - Worker 환경 변수
 * @param {string} context - 로깅을 위한 컨텍스트 문자열
 * @returns {Promise<object>} - API 응답 데이터 (기존 포맷 유지)
 */
export async function callGemini(modelName, apiKey, body, env, context = 'Gemini Call') {
  try {
    // SDK를 통한 호출
    const generationConfig = body.generationConfig || {};
    const tools = body.tools || [];
    const model = getGeminiModel(apiKey, modelName, { generationConfig, tools });

    const result = await model.generateContent({ contents: body.contents });
    const response = result.response;

    // SDK 응답에서 parts 추출 (텍스트 및 도구 호출 포함)
    const parts = response.candidates?.[0]?.content?.parts || [];

    // 기존 코드와의 호환성을 위해 원본 API 응답 구조로 래핑
    return {
      candidates: [{
        content: {
          parts: parts
        }
      }]
    };
  } catch (error) {
    console.error(`${context}: SDK 호출 실패 - ${error.message}`);

    // 프록시로 폴백 시도
    if (env.TTS_SERVICE_URL && env.TTS_API_KEY) {
      console.log(`${context}: 프록시로 재시도합니다.`);
      try {
        return await callGeminiViaProxy(modelName, apiKey, body, env, context);
      } catch (proxyError) {
        await logError(proxyError, env, `${context} - Proxy Fallback Failed`);
        throw proxyError;
      }
    }

    await logError(error, env, `${context} - SDK Error`);
    throw error;
  }
}

/**
 * Gemini API 스트리밍 호출 (SDK 기반)
 * @param {string} modelName - 호출할 모델 이름
 * @param {string} apiKey - Gemini API 키
 * @param {object} body - API 요청 본문
 * @param {object} env - Worker 환경 변수
 * @param {string} context - 로깅을 위한 컨텍스트 문자열
 * @returns {Promise<{stream: AsyncIterable, response: Promise}>} - 스트리밍 결과
 */
export async function callGeminiStream(modelName, apiKey, body, env, context = 'Gemini Stream') {
  try {
    const generationConfig = body.generationConfig || {};
    const tools = body.tools || [];
    const model = getGeminiModel(apiKey, modelName, { generationConfig, tools });

    const result = await model.generateContentStream({ contents: body.contents });
    return result; // { stream: AsyncIterable, response: Promise }
  } catch (error) {
    console.error(`${context}: SDK 스트리밍 호출 실패 - ${error.message}`);
    await logError(error, env, `${context} - Stream Error`);
    throw error;
  }
}

/**
 * 프록시 서버를 통한 Gemini API 호출 (논스트리밍)
 * @param {string} modelName - 호출할 모델 이름
 * @param {string} apiKey - Gemini API 키
 * @param {object} body - API 요청 본문
 * @param {object} env - Worker 환경 변수
 * @param {string} context - 로깅을 위한 컨텍스트 문자열
 * @returns {Promise<object>} - API 응답 데이터
 */
export async function callGeminiViaProxy(modelName, apiKey, body, env, context = 'Gemini Proxy') {
  const proxyUrl = env.TTS_SERVICE_URL.replace(/\/tts$/, '/gemini-proxy');

  const proxyResponse = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.TTS_API_KEY}`
    },
    body: JSON.stringify({
      gemini_api_key: apiKey,
      model: modelName,
      body: body
    })
  });

  if (!proxyResponse.ok) {
    const proxyErrorText = await proxyResponse.text();
    const proxyError = new Error(`Gemini Proxy API error: ${proxyResponse.status} ${proxyResponse.statusText} - ${proxyErrorText}`);
    await logError(proxyError, env, `${context} - Proxy Error`);
    throw proxyError;
  }

  console.log(`${context}: Gemini 프록시 호출 성공`);
  return await proxyResponse.json();
}