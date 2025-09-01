
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
    const key = await getJwtSecretKey(env);
    const [header, payload, signature] = token.split('.');
    
    if (!header || !payload || !signature) {
      return null;
    }
    
    const dataToVerify = `${header}.${payload}`;
    const encoder = new TextEncoder();
    
    // Signature를 ArrayBuffer로 디코딩
    const signatureBuffer = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    
    const isValid = await crypto.subtle.verify('HMAC', key, signatureBuffer, encoder.encode(dataToVerify));
    
    if (!isValid) {
      logDebug('JWT 서명 검증 실패', 'JWT Verify');
      return null;
    }
    
    const decodedPayload = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    
    // 토큰 만료 확인
    if (decodedPayload.exp && Date.now() > decodedPayload.exp) {
      logDebug('JWT 토큰 만료됨', 'JWT Verify');
      return null;
    }
    
    return decodedPayload;
  } catch (error) {
    logError(error, env, 'JWT Verify');
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
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;

  const tokenMatch = cookie.match(/token=([^;]+)/);
  if (!tokenMatch) return null;

  const token = tokenMatch[1];
  return await verifyJwt(token, env);
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
    
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(tokenData.userId).first();
    
    return user;
  } catch (error) {
    await logError(error, env, 'Utils: GetUserFromRequest');
    return null;
  }
}
