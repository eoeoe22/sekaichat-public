import { logError, getUserFromRequest } from '../utils.js';

export async function getSekaiPreferences(request, env) {
    try {
        const user = await getUserFromRequest(request, env);
        if (!user) {
            return new Response('Unauthorized', { status: 401 });
        }

        // 1. Get all sekai from the new sekai table
        const { results: allSekai } = await env.DB.prepare(
            'SELECT name, description, image_path FROM sekai'
        ).all();

        // 2. Get user preferences
        const { results: userPrefs } = await env.DB.prepare(
            'SELECT sekai, visible FROM user_sekai_preferences WHERE user_id = ?'
        ).bind(user.id).all();

        const userPrefsMap = new Map(userPrefs.map(p => [p.sekai, p.visible]));

        // 3. Combine and apply default logic
        const sekaiWithPrefs = allSekai.map(s => {
            const userPreference = userPrefsMap.get(s.name);
            let visible;

            if (userPreference !== undefined) {
                visible = userPreference;
            } else {
                // Default logic
                visible = (s.name === '프로젝트 세카이' || s.name === 'Google') ? 1 : 0;
            }

            return {
                sekai: s.name,
                description: s.description,
                image_path: s.image_path,
                visible: visible
            };
        });

        return new Response(JSON.stringify(sekaiWithPrefs), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        await logError(error, env, 'Get Sekai Preferences');
        return new Response('Internal Server Error', { status: 500 });
    }
}

export async function updateSekaiPreferences(request, env) {
    try {
        const user = await getUserFromRequest(request, env);
        if (!user) {
            return new Response('Unauthorized', { status: 401 });
        }

        const preferences = await request.json(); // Expects an array of {sekai: string, visible: boolean}

        const statements = preferences.map(p =>
            env.DB.prepare('INSERT OR REPLACE INTO user_sekai_preferences (user_id, sekai, visible) VALUES (?, ?, ?)')
                .bind(user.id, p.sekai, p.visible ? 1 : 0)
        );

        await env.DB.batch(statements);

        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        await logError(error, env, 'Update Sekai Preferences');
        return new Response('Internal Server Error', { status: 500 });
    }
}
