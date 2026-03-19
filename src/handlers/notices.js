import { logError } from '../utils.js';

export async function getNotice(request, env) {
    try {
        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type');

        let query = 'SELECT content, type FROM notices';
        let params = [];

        if (type) {
            query += ' WHERE type = ?';
            params.push(type);
        }

        query += ' ORDER BY id DESC';

        const { results } = await env.DB.prepare(query).bind(...params).all();

        return new Response(JSON.stringify(results || []), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        await logError(error, env, 'Get Notice');
        return new Response('Internal Server Error', { status: 500 });
    }
}
