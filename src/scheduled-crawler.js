import { logError } from './utils.js';

const BASE_URL = "http://vocaro.wikidot.com";
const RECENT_LYRICS_URL = `${BASE_URL}/recently-translated-lyrics`;

export async function handleScheduled(event, env, ctx) {
    try {
        console.log("Starting scheduled crawl...");
        await crawlRecentLyrics(env);
        console.log("Scheduled crawl completed.");
    } catch (error) {
        console.error("Scheduled crawl failed:", error);
        await logError(error, env, 'Scheduled Crawler');
    }
}

async function crawlRecentLyrics(env) {
    // 1. Fetch the recently translated lyrics page
    const response = await fetch(RECENT_LYRICS_URL, {
        headers: { 'User-Agent': 'Sekai-Chat-Crawler/1.0' }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch recent lyrics: ${response.status}`);
    }

    const html = await response.text();

    // Regex to match the specific table structure from sample.html
    // <td class="listpages-page"><a href="/fake-marriage">페이크 매리지</a></td>
    const linkRegex = /<td class="listpages-page"><a href="([^"]+)">/g;
    let match;
    const links = new Set();

    while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1];
        // Ensure it's a relative path and not a system link (though the class filter helps a lot)
        if (href.startsWith('/') && !href.includes('system:') && !href.includes('javascript:')) {
            links.add(`${BASE_URL}${href}`);
        }
    }

    console.log(`Found ${links.size} potential links.`);

    for (const url of links) {
        // Check if exists in D1
        const exists = await env.VOCALOID_DB.prepare('SELECT id FROM lyrics WHERE url = ?').bind(url).first();

        if (!exists) {
            console.log(`New song found: ${url}. Crawling...`);
            await crawlAndSaveSong(url, env);
            // Respectful delay
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
}

function parseSongHtml(html, url) {
    const data = {
        url: url,
        title: '',
        title_jp: '',
        info: {},
        lyrics: ''
    };

    // Regex-based parsing (Fragile but necessary without DOM parser in Worker environment)
    // Note: Cloudflare Workers can use HTMLRewriter for streaming parsing, but for full page extraction regex/string manipulation is often used if structure is simple enough, 
    // or a lightweight parser like 'cheerio' (if size permits, but usually avoided). 
    // Here we'll use simple string extraction helpers.

    // 1. Title: <div id="page-title">...</div>
    const titleMatch = html.match(/<div id="page-title"[^>]*>([\s\S]*?)<\/div>/);
    if (titleMatch) {
        data.title = titleMatch[1].trim();
    }

    // 2. Japanese Title: <th class="title-cell"...>...</th>
    const titleJpMatch = html.match(/<th[^>]*class="[^"]*title-cell[^"]*"[^>]*>([\s\S]*?)<\/th>/);
    if (titleJpMatch) {
        data.title_jp = stripTags(titleJpMatch[1]).trim();
    }

    // 3. Info Table
    // This is hard with regex. We might look for specific headers like "작사", "작곡" etc.
    const infoKeys = ['작사', '작곡', '노래', '출처', '영상', '원곡', '가수'];
    for (const key of infoKeys) {
        // Look for <th>key</th>...<td>value</td>
        // This regex is very approximate and assumes standard table structure
        const regex = new RegExp(`<th[^>]*>\\s*${key}.*?<\\/th>[\\s\\S]*?<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i');
        const match = html.match(regex);
        if (match) {
            data.info[key] = stripTags(match[1]).replace(/\s+/g, ' ').trim();
        }
    }

    // 4. Lyrics: <table class="wiki-content-table">...</table>
    const lyricsTableMatch = html.match(/<table class="wiki-content-table">([\s\S]*?)<\/table>/);
    if (lyricsTableMatch) {
        const tableContent = lyricsTableMatch[1];
        // Extract all cell contents
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
        let cellMatch;
        const lines = [];
        while ((cellMatch = cellRegex.exec(tableContent)) !== null) {
            lines.push(stripTags(cellMatch[1]).trim());
        }
        data.lyrics = lines.join('\n');
    }

    return data;
}

function stripTags(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
}

async function crawlAndSaveSong(url, env) {
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Sekai-Chat-Crawler/1.0' }
        });

        if (!response.ok) {
            console.error(`Failed to fetch song page ${url}: ${response.status}`);
            return;
        }

        const html = await response.text();
        const songData = parseSongHtml(html, url);

        if (!songData.title) {
            console.error(`Failed to parse title for ${url}`);
            return;
        }

        // Insert into D1
        const result = await env.VOCALOID_DB.prepare(`
            INSERT INTO lyrics (url, title, title_jp, info, lyrics)
            VALUES (?, ?, ?, ?, ?)
        `).bind(
            songData.url,
            songData.title,
            songData.title_jp,
            JSON.stringify(songData.info),
            songData.lyrics
        ).run();

        if (result.success) {
            const songId = result.meta.last_row_id;
            console.log(`Saved metadata for ${songData.title} (ID: ${songId})`);

            // Upload to R2
            await env.VOCALOID_BUCKET.put(`${songId}.txt`, songData.lyrics, {
                httpMetadata: { contentType: 'text/plain' }
            });
            console.log(`Uploaded lyrics to R2 for ID: ${songId}`);
        } else {
            console.error(`Failed to insert into D1 for ${url}`);
        }

    } catch (error) {
        console.error(`Error processing ${url}:`, error);
        await logError(error, env, `Crawler: ${url}`);
    }
}
