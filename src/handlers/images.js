import { logError, getUserFromRequest } from '../utils.js';



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
