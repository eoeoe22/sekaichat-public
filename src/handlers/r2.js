export async function handleR2Request(request, env, path) {
    const key = path.substring(4);
    const object = await env.R2.get(key);

    if (object === null) {
        return new Response('Object Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);

    return new Response(object.body, {
        headers,
    });
}
