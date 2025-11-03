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
 * Gemini API 호출을 위한 중앙 집중식 함수
 * @param {string} model - 호출할 모델 이름 (예: 'gemini-2.5-flash')
 * @param {string} apiKey - Gemini API 키
 * @param {object} body - API 요청 본문
 * @param {object} env - Worker 환경 변수
 * @param {string} context - 로깅을 위한 컨텍스트 문자열
 * @returns {Promise<object>} - API 응답 데이터
 */
export async function callGemini(model, apiKey, body, env, context = 'Gemini Call') {
  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const url = `${baseUrl}${model}:generateContent`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
      error.status = response.status; // 상태 코드를 에러 객체에 추가
      await logError(error, env, `${context} - ${model}`);
      throw error;
    }

    return await response.json();
  } catch (error) {
    // 400 Bad Request 에러 시 프록시로 재시도
    if (error.status === 400 && env.TTS_SERVICE_URL && env.TTS_API_KEY) {
      console.log('Gemini API 400 에러. 프록시로 재시도합니다.');
      try {
        const proxyUrl = env.TTS_SERVICE_URL.replace(/\/tts$/, '/gemini-proxy');
        
        const proxyResponse = await fetch(proxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.TTS_API_KEY}`
          },
          body: JSON.stringify({
            gemini_api_key: apiKey,
            model: model,
            body: body
          })
        });

        if (!proxyResponse.ok) {
          const proxyErrorText = await proxyResponse.text();
          const proxyError = new Error(`Gemini Proxy API error: ${proxyResponse.status} ${proxyResponse.statusText} - ${proxyErrorText}`);
          await logError(proxyError, env, `${context} - Proxy Fallback`);
          throw proxyError; // 프록시 에러도 던짐
        }

        console.log('Gemini 프록시 호출 성공');
        return await proxyResponse.json();

      } catch (proxyCatchError) {
        await logError(proxyCatchError, env, `${context} - Proxy Fetch Error`);
        throw proxyCatchError; // 프록시 호출 중 발생한 네트워크 에러 등
      }
    }

    // 그 외 다른 에러들
    await logError(error, env, `${context} - Fetch Error`);
    throw error;
  }
}