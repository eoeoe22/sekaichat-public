import { logError } from '../utils.js';

export async function getNotice(request, env) {
    try {
        const { results } = await env.DB.prepare(
            'SELECT content FROM notices ORDER BY id DESC'
        ).all();

        return new Response(JSON.stringify(results || []), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        await logError(error, env, 'Get Notice');
        return new Response('Internal Server Error', { status: 500 });
    }
}
