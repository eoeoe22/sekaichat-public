import { logError, getUserFromRequest, verifyPassword, generateSalt, hashPassword, getAuth } from '../utils.js';
import { updateProfileImage } from '../auth.js';

export async function checkAuthStatus(request, env) {
    try {
        const auth = await getAuth(request, env);
        const isAuthenticated = auth && auth.userId;

        return new Response(JSON.stringify({
            authenticated: !!isAuthenticated,
            userId: isAuthenticated ? auth.userId : null
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
        });
    } catch (error) {
        await logError(error, env, 'Check Auth Status');
        return new Response(JSON.stringify({ authenticated: false }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

export function validateGeminiApiKeyFormat(apiKey) {
    if (!apiKey) return { isValid: true, reason: null };

    const apiKeyPattern = /^AIzaSy[A-Za-z0-9-_]{33}$/;

    if (!apiKey.startsWith('AIzaSy')) {
        return { isValid: false, reason: 'API 키는 "AIzaSy"로 시작해야 합니다.' };
    }

    if (apiKey.length !== 39) {
        return { isValid: false, reason: `API 키는 39자여야 합니다. (현재 ${apiKey.length}자)` };
    }

    if (!apiKeyPattern.test(apiKey)) {
        return { isValid: false, reason: 'API 키는 알파벳 대소문자, 숫자, 하이픈(-), 언더스코어(_)로만 구성되어야 합니다.' };
    }

    return { isValid: true, reason: null };
}

export async function getUserInfo(request, env) {
    try {
        const user = await getUserFromRequest(request, env);
        if (!user) {
            return new Response('Unauthorized', { status: 401 });
        }

        const apiKeyValidation = validateGeminiApiKeyFormat(user.gemini_api_key);

        const userInfo = {
            username: user.username,
            nickname: user.nickname,
            self_introduction: user.self_introduction,
            max_auto_call_sequence: user.max_auto_call_sequence || 3,
            has_api_key: !!user.gemini_api_key,
            api_key_valid: apiKeyValidation.isValid,
            api_key_error: apiKeyValidation.reason,
            discord_id: user.discord_id,
            discord_username: user.discord_username,
            discord_avatar: user.discord_avatar,
            profile_image: user.profile_image,
            profile_image_visible: user.profile_image_visible
        };

        return new Response(JSON.stringify(userInfo), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        await logError(error, env, 'Get User Info');
        return new Response('Internal Server Error', { status: 500 });
    }
}

export async function handleUserUpdate(request, env) {
    try {
        const user = await getUserFromRequest(request, env);
        if (!user) {
            return new Response('Unauthorized', { status: 401 });
        }

        const { type, ...data } = await request.json();

        switch (type) {
            case 'password':
                const { current_password, new_password } = data;
                const isValidPassword = await verifyPassword(current_password, user.password_hash, user.salt);

                if (!isValidPassword) {
                    return new Response('Invalid current password', { status: 400 });
                }

                const salt = generateSalt();
                const passwordHash = await hashPassword(new_password, salt);

                await env.DB.prepare(
                    'UPDATE users SET password_hash = ?, salt = ? WHERE id = ?'
                ).bind(passwordHash, salt, user.id).run();
                break;

            case 'nickname':
                const { new_nickname } = data;
                await env.DB.prepare(
                    'UPDATE users SET nickname = ? WHERE id = ?'
                ).bind(new_nickname, user.id).run();
                break;

            case 'api_key':
                const { api_key } = data;

                // API 키 형식 검증
                const apiKeyValidation = validateGeminiApiKeyFormat(api_key);
                if (!apiKeyValidation.isValid) {
                    return new Response(apiKeyValidation.reason, { status: 400 });
                }

                await env.DB.prepare(
                    'UPDATE users SET gemini_api_key = ? WHERE id = ?'
                ).bind(api_key, user.id).run();
                break;

            case 'delete_api_key':
                await env.DB.prepare(
                    'UPDATE users SET gemini_api_key = NULL WHERE id = ?'
                ).bind(user.id).run();
                break;

            case 'self_introduction':
                const { self_introduction } = data;
                await env.DB.prepare(
                    'UPDATE users SET self_introduction = ? WHERE id = ?'
                ).bind(self_introduction, user.id).run();
                break;

            case 'max_auto_call_sequence':
                const { max_auto_call_sequence } = data;
                await env.DB.prepare(
                    'UPDATE users SET max_auto_call_sequence = ? WHERE id = ?'
                ).bind(max_auto_call_sequence, user.id).run();
                break;

            case 'unlink_discord':
                await env.DB.prepare(
                    'UPDATE users SET discord_id = NULL, discord_username = NULL, discord_avatar = NULL WHERE id = ?'
                ).bind(user.id).run();
                break;

            case 'tts_language_preference':
                const { tts_language_preference } = data;
                if (!['kr', 'jp'].includes(tts_language_preference)) {
                    return new Response('잘못된 TTS 언어 설정입니다', { status: 400 });
                }
                await env.DB.prepare(
                    'UPDATE users SET tts_language_preference = ? WHERE id = ?'
                ).bind(tts_language_preference, user.id).run();
                break;

            default:
                return new Response('지원하지 않는 업데이트 유형입니다', { status: 400 });
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        await logError(error, env, 'Handle User Update');
        return new Response('Internal Server Error', { status: 500 });
    }
}

export async function handleProfileImageUpdate(request, env) {
    const user = await getUserFromRequest(request, env);
    if (!user) {
        return new Response('Unauthorized', { status: 401 });
    }
    // The new updateProfileImage function from auth.js will handle both POST and DELETE
    return updateProfileImage(user.id, request, env);
}
