import { logError, getUserFromRequest } from '../utils.js';

// 쿨다운 관리를 위한 메모리 저장소
const imageCooldowns = new Map();

// 이미지 생성 쿨다운 확인
function isImageGenerationOnCooldown(userId) {
    const lastGeneration = imageCooldowns.get(userId);
    if (!lastGeneration) return false;

    const now = Date.now();
    const cooldownPeriod = 20 * 1000; // 20초
    return (now - lastGeneration) < cooldownPeriod;
}

// 이미지 생성 쿨다운 설정
function setImageGenerationCooldown(userId) {
    imageCooldowns.set(userId, Date.now());
}

// 남은 쿨다운 시간 계산 (초 단위)
function getRemainingCooldown(userId) {
    const lastGeneration = imageCooldowns.get(userId);
    if (!lastGeneration) return 0;

    const now = Date.now();
    const cooldownPeriod = 20 * 1000; // 20초
    const elapsed = now - lastGeneration;
    const remaining = Math.max(0, cooldownPeriod - elapsed);
    return Math.ceil(remaining / 1000);
}

// 이미지 생성 처리 함수
export async function handleImageGeneration(request, env) {
    try {
        const user = await getUserFromRequest(request, env);
        if (!user) {
            return new Response('Unauthorized', { status: 401 });
        }

        const { prompt, conversationId, characterId, characterType } = await request.json();

        if (!prompt || !conversationId || !characterId) {
            return new Response('필수 매개변수가 누락되었습니다.', { status: 400 });
        }

        // 쿨다운 확인
        if (isImageGenerationOnCooldown(user.id)) {
            const remainingSeconds = getRemainingCooldown(user.id);
            return new Response(JSON.stringify({
                error: 'cooldown',
                message: `이미지 생성은 20초마다 한 번만 가능합니다. ${remainingSeconds}초 후에 다시 시도해주세요.`,
                remainingSeconds: remainingSeconds
            }), {
                status: 429,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 캐릭터가 이미지 생성을 지원하는지 확인
        const supportsImageGen = await supportsImageGeneration(characterId, characterType, env);
        if (!supportsImageGen) {
            return new Response(JSON.stringify({
                error: 'unsupported_character',
                message: '이 캐릭터는 이미지 생성을 지원하지 않습니다.'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            // Workers AI로 이미지 생성
            const imageBuffer = await generateImageWithAI(prompt, env);
            if (!imageBuffer) {
                throw new Error('이미지 생성에 실패했습니다.');
            }

            // R2에 이미지 저장
            const imageInfo = await saveGeneratedImageToR2(imageBuffer, env);
            if (!imageInfo) {
                throw new Error('이미지 저장에 실패했습니다.');
            }

            // 쿨다운 설정
            setImageGenerationCooldown(user.id);

            return new Response(JSON.stringify({
                success: true,
                imageUrl: `/api/images/generated/${imageInfo.fileName}`,
                fileName: imageInfo.fileName,
                prompt: prompt
            }), {
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (imageError) {
            await logError(imageError, env, 'Image Generation Process');
            return new Response(JSON.stringify({
                error: 'generation_failed',
                message: '이미지 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

    } catch (error) {
        await logError(error, env, 'Handle Image Generation');
        return new Response('Internal Server Error', { status: 500 });
    }
}

// 이미지 생성 지원 확인 함수
export async function supportsImageGeneration(characterId, characterType, env) {
    try {
        if (characterType === 'official') {
            const allowedIds = env.IMAGE_GENERATION_CHARACTERS?.split(',').map(id => parseInt(id.trim())) || [3, 8];
            return allowedIds.includes(characterId);
        }

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

// Workers AI로 이미지 생성
export async function generateImageWithAI(prompt, env) {
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
        await logError(error, env, 'Generate Image with AI');
        return null;
    }
}

// 생성된 이미지를 R2에 저장
export async function saveGeneratedImageToR2(imageBuffer, env) {
    try {
        const fileName = `generated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
        const key = `generated_images/${fileName}`;
        await env.R2.put(key, imageBuffer, {
            httpMetadata: { contentType: 'image/png' }
        });
        return { fileName, key };
    } catch (error) {
        await logError(error, env, 'Save Generated Image to R2');
        return null;
    }
}

// 이미지 직접 업로드 함수
export async function handleDirectUpload(request, env) {
    try {
        const user = await getUserFromRequest(request, env);
        if (!user || !user.gemini_api_key) {
            return new Response('Forbidden', { status: 403 });
        }

        // 사용자 존재 여부 확인 (Foreign Key 제약조건 오류 방지)
        const userExists = await env.DB.prepare('SELECT id FROM users WHERE id = ?')
            .bind(user.id).first();

        if (!userExists) {
            await logError(new Error(`User ID ${user.id} from JWT token does not exist in database`), env, 'Handle Direct Upload - User Validation');
            return new Response('Invalid user session. Please login again.', { status: 401 });
        }

        const formData = await request.formData();
        const file = formData.get('file');
        const conversationId = formData.get('conversationId');

        if (!file) {
            return new Response('파일이 필요합니다.', { status: 400 });
        }

        if (!validateUploadFile(file)) {
            return new Response('지원하지 않는 파일 형식이거나 크기가 5MB를 초과합니다.', { status: 400 });
        }

        // 대화방 존재 여부 및 소유권 확인 (Foreign Key 제약조건 오류 방지)
        if (conversationId) {
            const conversationExists = await env.DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
                .bind(conversationId, user.id).first();

            if (!conversationExists) {
                return new Response('Invalid conversation or access denied', { status: 403 });
            }
        }

        const uniqueFileName = generateUniqueFileName(file.name);
        const r2Key = `image_uploads/${uniqueFileName}`;

        try {
            await env.R2.put(r2Key, file.stream(), {
                httpMetadata: { contentType: file.type },
            });

            const fileResult = await env.DB.prepare(
                'INSERT INTO files (user_id, filename, original_name, file_size, mime_type, r2_key) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
            ).bind(user.id, uniqueFileName, file.name, file.size, file.type, r2Key).first();

            const fileId = fileResult.id;

            await env.DB.prepare(
                'INSERT INTO messages (conversation_id, role, content, message_type, file_id, user_id) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(conversationId, 'user', file.name, 'image', fileId, user.id).run();

            // 대화 캐시 무효화
            const cacheKey = `chat_history:${conversationId}`;
            await env.KV.delete(cacheKey);

            return new Response(JSON.stringify({
                success: true,
                fileId,
                imageUrl: `/api/images/${uniqueFileName}`,
                fileName: uniqueFileName
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (uploadError) {
            await env.R2.delete(r2Key).catch(() => { });
            throw uploadError;
        }
    } catch (error) {
        await logError(error, env, 'Handle Direct Upload');
        return new Response('업로드 실패', { status: 500 });
    }
}

// 파일 검증 함수
export function validateUploadFile(file) {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (!allowedTypes.includes(file.type)) return false;
    if (!file.size || file.size > maxSize || file.size <= 0) return false;
    if (!file.name || file.name.length > 255) return false;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
    if (!ext || !allowedExts.includes(ext)) return false;
    return true;
}

// 고유 파일명 생성
export function generateUniqueFileName(originalName) {
    const ext = originalName.split('.').pop();
    const uuid = crypto.randomUUID();
    const timestamp = Date.now();
    return `${uuid}_${timestamp}.${ext}`;
}

// 이미지 서빙
export async function serveImage(request, env, fileName) {
    try {
        let r2Key = `image_uploads/${fileName}`;
        let object = await env.R2.get(r2Key);

        if (!object && fileName.startsWith('generated/')) {
            r2Key = `generated_images/${fileName.replace('generated/', '')}`;
            object = await env.R2.get(r2Key);
        }

        if (!object) {
            return new Response('이미지를 찾을 수 없습니다.', { status: 404 });
        }

        const headers = new Headers();
        headers.set('Content-Type', object.httpMetadata.contentType || 'image/png');
        headers.set('Cache-Control', 'public, max-age=31536000'); // 1년 캐싱

        return new Response(object.body, { headers });
    } catch (error) {
        await logError(error, env, 'Serve Image');
        return new Response('이미지 로드 실패', { status: 500 });
    }
}
