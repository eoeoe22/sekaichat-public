import { logError } from '../utils.js';

async function extractAutoragResults(results, env) {
    if (!results) {
        return [];
    }

    let extractedResults = [];

    // Case 1: Results is a simple array of strings (as seen in gemini.js)
    if (Array.isArray(results) && results.every(item => typeof item === 'string')) {
        extractedResults = results.map((result, index) => ({
            source: `검색 결과 ${index + 1}`,
            text: result,
            filename: null // No filename info available for simple strings
        }));
    }
    // Case 2: Results is an object with a property containing the array of results
    // Common keys are 'results', 'data', 'documents', 'passages'
    else {
        const potentialResultKeys = ['results', 'data', 'documents', 'passages'];
        let found = false;

        for (const key of potentialResultKeys) {
            if (results[key] && Array.isArray(results[key])) {
                extractedResults = results[key].map((result, index) => {
                    if (typeof result === 'string') {
                        return { source: `검색 결과 ${index + 1}`, text: result, filename: null };
                    }
                    if (typeof result === 'object' && result !== null) {
                        // Extract filename from various possible metadata locations
                        let filename = result.filename ||
                            result.metadata?.filename ||
                            result.metadata?.file ||
                            result.metadata?.source_file ||
                            result.source_metadata?.filename ||
                            result.document_metadata?.filename;

                        // If we have a filename, use it as the source, otherwise fall back to existing logic
                        let source = filename ||
                            result.source ||
                            result.metadata?.source ||
                            `검색 결과 ${index + 1}`;

                        return {
                            source: source,
                            text: result.text || result.content || result.passage || JSON.stringify(result),
                            filename: filename // Include filename as a separate field for frontend use
                        };
                    }
                    return { source: `검색 결과 ${index + 1}`, text: String(result), filename: null };
                });
                found = true;
                break;
            }
        }

        if (!found) {
            // Case 3: Results is a single object with text/content
            if (typeof results === 'object' && (results.text || results.content)) {
                let filename = results.filename ||
                    results.metadata?.filename ||
                    results.metadata?.file ||
                    results.metadata?.source_file ||
                    results.source_metadata?.filename ||
                    results.document_metadata?.filename;

                extractedResults = [{
                    source: filename || results.source || '검색 결과',
                    text: results.text || results.content,
                    filename: filename
                }];
            }
            // Case 4: Results is a single string
            else if (typeof results === 'string') {
                extractedResults = [{
                    source: '검색 결과',
                    text: results,
                    filename: null
                }];
            }
            // Fallback: If the structure is completely unknown, try to convert it to a string
            else {
                extractedResults = [{
                    source: '알 수 없는 형식의 결과',
                    text: JSON.stringify(results, null, 2),
                    filename: null
                }];
            }
        }
    }

    // Now try to enhance the source information by matching with knowledge_base entries
    if (env && env.DB) {
        try {
            const { results: knowledgeEntries } = await env.DB.prepare(
                'SELECT title, content FROM knowledge_base ORDER BY title ASC'
            ).all();

            if (knowledgeEntries && knowledgeEntries.length > 0) {
                extractedResults = extractedResults.map((result, index) => {
                    // If we already have a filename, prioritize it over knowledge base matching
                    if (result.filename) {
                        return result; // Keep the filename as source
                    }

                    // Try to find a matching knowledge base entry by content similarity
                    const matchedEntry = findBestKnowledgeMatch(result.text, knowledgeEntries);

                    if (matchedEntry) {
                        return {
                            ...result,
                            source: matchedEntry.title
                        };
                    }

                    // If no match found and source is generic, keep it but make it more descriptive
                    if (result.source.startsWith('검색 결과')) {
                        return {
                            ...result,
                            source: `문서 ${index + 1}`
                        };
                    }

                    return result;
                });
            }
        } catch (error) {
            console.warn('Failed to enhance AutoRAG results with knowledge base titles:', error);
            // Continue with original results if knowledge base lookup fails
        }
    }

    return extractedResults;
}

// Helper function to find the best matching knowledge base entry
function findBestKnowledgeMatch(resultText, knowledgeEntries) {
    if (!resultText || !knowledgeEntries || knowledgeEntries.length === 0) {
        return null;
    }

    // Normalize text for comparison
    const normalizedResultText = resultText.toLowerCase().trim();

    // First, try to find exact substring matches
    for (const entry of knowledgeEntries) {
        const normalizedContent = entry.content.toLowerCase();

        // Check if result text is a substring of the knowledge content
        if (normalizedContent.includes(normalizedResultText)) {
            return entry;
        }

        // Check if knowledge content is a substring of the result text
        if (normalizedResultText.includes(normalizedContent)) {
            return entry;
        }
    }

    // If no exact match, try to find the entry with the most word overlap
    let bestMatch = null;
    let bestScore = 0;

    const resultWords = normalizedResultText.split(/\s+/).filter(word => word.length > 2);

    for (const entry of knowledgeEntries) {
        const contentWords = entry.content.toLowerCase().split(/\s+/).filter(word => word.length > 2);

        // Calculate word overlap score
        let score = 0;
        for (const word of resultWords) {
            if (contentWords.some(cWord => cWord.includes(word) || word.includes(cWord))) {
                score++;
            }
        }

        // Normalize score by result text length
        const normalizedScore = score / Math.max(resultWords.length, 1);

        if (normalizedScore > bestScore && normalizedScore > 0.3) { // Minimum threshold
            bestScore = normalizedScore;
            bestMatch = entry;
        }
    }

    return bestMatch;
}

export async function handleAutoragPreview(request, env) {
    try {
        const { query, mode, server } = await request.json();
        const autoragProject = server === 'jp' ? 'sekai-jp' : 'sekai';
        const r2Bucket = server === 'jp' ? env.AutoRAG2 : env.AutoRAG1;

        if (!query) {
            return new Response('Query is required', { status: 400 });
        }

        let searchQuery = query;
        let extractedKeywords = null;

        if (mode === 'ai') {
            const keywordPrompt = `다음 텍스트의 핵심 키워드를 쉼표로 구분하여 다른 설명 없이 나열해줘:

${query}`;

            const apiKey = env.GEMINI_API_KEY;

            if (!apiKey) {
                throw new Error("GEMINI_API_KEY is not configured for unauthenticated AI search.");
            }

            try {
                const keywordResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': apiKey
                    },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: keywordPrompt }] }],
                        generationConfig: { temperature: 0.0, maxOutputTokens: 100 }
                    })
                });

                if (keywordResponse.ok) {
                    const keywordData = await keywordResponse.json();
                    const keywords = keywordData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                    if (keywords) {
                        searchQuery = keywords;
                        extractedKeywords = keywords;
                    }
                } else {
                    await logError(new Error(`Keyword extraction failed: ${keywordResponse.status}`), env, 'AutoRAG Preview Keyword Extraction');
                }
            } catch (keywordError) {
                // If Gemini API fails (e.g., network issues in local dev), log the error but continue with original query
                await logError(keywordError, env, 'AutoRAG Preview Keyword Extraction - Network');
                console.warn('Keyword extraction failed, using original query:', keywordError.message);
                // searchQuery remains as the original query
            }
        }

        let results;
        let formattedResults = [];

        try {
            results = await env.AI.autorag(autoragProject).search({
                query: searchQuery,
            });

            // Log the actual response structure for debugging
            console.log('AutoRAG raw response:', JSON.stringify(results, null, 2));
            console.log('AutoRAG response type:', typeof results, 'isArray:', Array.isArray(results));

            // Extract results with filenames
            formattedResults = await extractAutoragResults(results, env);
            // filename is included in results for frontend to request full content
        } catch (autoragError) {
            // Handle specific AutoRAG errors
            console.error('AutoRAG service error:', autoragError.message);
            await logError(autoragError, env, 'AutoRAG Service Call');

            // Check if this is an authentication error (common in local development)
            if (autoragError.message && autoragError.message.includes('Not logged in')) {
                // For authentication errors, return empty results to show "no results" message
                formattedResults = [];
            } else {
                // For other errors, return a helpful message
                formattedResults = [{
                    source: 'System',
                    text: `AutoRAG 검색 서비스에 일시적인 문제가 발생했습니다. (검색어: "${searchQuery}") 오류: ${autoragError.message}`
                }];
            }
        }

        return new Response(JSON.stringify({
            results: formattedResults,
            keywords: extractedKeywords,
            mode: mode
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        await logError(error, env, 'handleAutoragPreview');
        console.error('AutoRAG Preview Error:', error);

        // Return a more specific error response
        return new Response(JSON.stringify({
            error: error.message,
            results: [],
            keywords: extractedKeywords || null,
            mode: mode || 'normal'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}


// Get AutoRAG vectorize bucket status
export async function handleAutoragStatus(request, env) {
    try {
        const status = {
            vectorize: {
                lastModified: null,
                error: null
            },
            vectorize_jp: {
                lastModified: null,
                error: null
            }
        };

        // Get last modified date from vectorize bucket (Korean server)
        try {
            const koreanObjects = await env.AutoRAG1.list({ limit: 1000 });
            if (koreanObjects.objects && koreanObjects.objects.length > 0) {
                // Find the most recent upload
                const mostRecent = koreanObjects.objects.reduce((latest, obj) => {
                    return new Date(obj.uploaded) > new Date(latest.uploaded) ? obj : latest;
                });
                status.vectorize.lastModified = mostRecent.uploaded;
            }
        } catch (error) {
            status.vectorize.error = error.message;
        }

        // Get last modified date from vectorize-jp bucket (Japanese server)
        try {
            const japaneseObjects = await env.AutoRAG2.list({ limit: 1000 });
            if (japaneseObjects.objects && japaneseObjects.objects.length > 0) {
                // Find the most recent upload
                const mostRecent = japaneseObjects.objects.reduce((latest, obj) => {
                    return new Date(obj.uploaded) > new Date(latest.uploaded) ? obj : latest;
                });
                status.vectorize_jp.lastModified = mostRecent.uploaded;
            }
        } catch (error) {
            status.vectorize_jp.error = error.message;
        }

        return new Response(JSON.stringify(status), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        await logError(error, env, 'handleAutoragStatus');
        console.error('AutoRAG Status Error:', error);

        return new Response(JSON.stringify({
            error: error.message,
            vectorize: { lastModified: null, error: error.message },
            vectorize_jp: { lastModified: null, error: error.message }
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

export async function handleVocaloidSearch(request, env) {
    try {
        const { query } = await request.json();
        if (!query) {
            return new Response('Query is required', { status: 400 });
        }

        const results = await env.AI.autorag("vocaloid").search({ query });

        let matches = [];
        let characters = [];

        // Fetch character data for matching
        try {
            const { results: charResults } = await env.DB.prepare(
                'SELECT name, profile_image FROM characters'
            ).all();
            if (charResults) {
                characters = charResults;
            }
        } catch (e) {
            console.error('Failed to fetch characters', e);
        }

        if (results && results.data && Array.isArray(results.data)) {
            // Extract IDs from filenames (e.g., "5.txt" -> 5)
            const ids = results.data
                .map(item => {
                    const filename = item.attributes ? item.attributes.filename : null;
                    if (filename && filename.endsWith('.txt')) {
                        const id = parseInt(filename.replace('.txt', ''));
                        return isNaN(id) ? null : id;
                    }
                    return null;
                })
                .filter(id => id !== null);

            if (ids.length > 0) {
                // Fetch details from D1
                const placeholders = ids.map(() => '?').join(',');
                const queryStmt = `SELECT * FROM lyrics WHERE id IN (${placeholders})`;

                const { results: dbResults } = await env.VOCALOID_DB.prepare(queryStmt)
                    .bind(...ids)
                    .all();

                const dbMap = new Map();
                if (dbResults) {
                    dbResults.forEach(row => dbMap.set(row.id, row));
                }

                matches = ids.map(id => {
                    const row = dbMap.get(id);
                    if (!row) return null;

                    let info = {};
                    try {
                        info = JSON.parse(row.info);
                    } catch (e) {
                        console.error('Failed to parse info JSON', e);
                    }

                    return {
                        id: row.id,
                        title: row.title,
                        title_jp: row.title_jp,
                        url: row.url,
                        composer: info['작곡'] || info['작사&작곡'] || null,
                        lyricist: info['작사'] || info['작사&작곡'] || null,
                        singer: info['노래'] || null,
                        lyrics: row.lyrics,
                        original_content: null
                    };
                }).filter(item => item !== null);
            }
        }

        return new Response(JSON.stringify({ matches, characters }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        await logError(error, env, 'Vocaloid Search');
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

// Fetch full content from R2 by filename
export async function handleAutoragFullContent(request, env) {
    try {
        const { filename, server } = await request.json();

        if (!filename) {
            return new Response(JSON.stringify({ error: 'Filename is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const r2Bucket = server === 'jp' ? env.AutoRAG2 : env.AutoRAG1;
        const object = await r2Bucket.get(filename);

        if (!object) {
            return new Response(JSON.stringify({ error: 'File not found', filename }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const fullContent = await object.text();

        return new Response(JSON.stringify({
            filename,
            content: fullContent
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        await logError(error, env, 'AutoRAG Full Content');
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
