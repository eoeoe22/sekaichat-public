// Gemini API 스트리밍 테스트 핸들러
import { logError } from '../utils.js';

/**
 * 일반 응답 생성 (비스트리밍)
 */
export async function handleTestGenerate(request, env) {
    try {
        const { model, systemPrompt, userPrompt } = await request.json();
        
        if (!userPrompt) {
            return new Response(JSON.stringify({ error: '사용자 프롬프트가 필요합니다.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const apiKey = env.GEMINI_API_KEY;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        const contents = [];
        if (systemPrompt) {
            contents.push({
                role: 'user',
                parts: [{ text: `[시스템 지시사항]\n${systemPrompt}\n\n[사용자 메시지]\n${userPrompt}` }]
            });
        } else {
            contents.push({
                role: 'user',
                parts: [{ text: userPrompt }]
            });
        }

        const body = {
            contents,
            generationConfig: {
                temperature: 0.8,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 2048
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API 오류: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        return new Response(JSON.stringify({ text }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        await logError(error, env, 'Test Generate');
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

/**
 * 스트리밍 응답 생성
 */
export async function handleTestStream(request, env) {
    try {
        const { model, systemPrompt, userPrompt } = await request.json();
        
        if (!userPrompt) {
            return new Response(JSON.stringify({ error: '사용자 프롬프트가 필요합니다.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const apiKey = env.GEMINI_API_KEY;
        // 스트리밍 엔드포인트 사용 (streamGenerateContent)
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

        const contents = [];
        if (systemPrompt) {
            contents.push({
                role: 'user',
                parts: [{ text: `[시스템 지시사항]\n${systemPrompt}\n\n[사용자 메시지]\n${userPrompt}` }]
            });
        } else {
            contents.push({
                role: 'user',
                parts: [{ text: userPrompt }]
            });
        }

        const body = {
            contents,
            generationConfig: {
                temperature: 0.8,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 2048
            }
        };

        const geminiResponse = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify(body)
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            return new Response(`data: ${JSON.stringify({ error: `Gemini API 오류: ${geminiResponse.status}` })}\n\n`, {
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                }
            });
        }

        // ReadableStream을 변환하여 SSE 형식으로 전달
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // 비동기적으로 Gemini 스트림 처리
        (async () => {
            try {
                const reader = geminiResponse.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    
                    // SSE 데이터 파싱
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // 마지막 불완전한 라인 보관

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const jsonStr = line.slice(6).trim();
                            if (jsonStr) {
                                try {
                                    const data = JSON.parse(jsonStr);
                                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                                    if (text) {
                                        await writer.write(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
                                    }
                                } catch (e) {
                                    // JSON 파싱 오류 무시
                                }
                            }
                        }
                    }
                }

                // 완료 메시지
                await writer.write(encoder.encode('data: [DONE]\n\n'));
                await writer.close();

            } catch (error) {
                await writer.write(encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`));
                await writer.close();
            }
        })();

        return new Response(readable, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        await logError(error, env, 'Test Stream');
        return new Response(`data: ${JSON.stringify({ error: error.message })}\n\n`, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache'
            }
        });
    }
}
