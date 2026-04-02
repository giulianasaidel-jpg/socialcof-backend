import https from 'https';
import http from 'http';

export interface ScrapedContent {
  title: string;
  text: string;
  url: string;
}

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

/**
 * Fetches raw HTML from a URL, following up to 5 redirects.
 */
function fetchHtml(url: string, redirectsLeft = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers: FETCH_HEADERS }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        if (redirectsLeft === 0) return reject(new Error('Too many redirects'));
        return resolve(fetchHtml(res.headers.location, redirectsLeft - 1));
      }
      if (res.statusCode && res.statusCode >= 400) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        if (chunks.reduce((a, c) => a + c.length, 0) > 512_000) req.destroy();
      });
      res.on('close', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Fetch timeout')); });
  });
}

/**
 * Extracts the <title> from an HTML string.
 */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : '';
}

/**
 * Strips HTML tags and extracts clean readable text from an HTML string.
 * Removes scripts, styles, nav, footer, header, and normalizes whitespace.
 */
function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(nav|header|footer|aside|form|button|iframe|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|h[1-6]|li|div|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 30)
    .join('\n')
    .slice(0, 4000);
}

/**
 * Fetches a URL and returns the title and main readable text content.
 * Suitable for news articles, blogs, and general websites.
 */
export async function scrapeUrl(url: string): Promise<ScrapedContent> {
  const html = await fetchHtml(url);
  const title = extractTitle(html);
  const text = extractText(html);

  if (!text) throw new Error(`No readable content found at ${url}`);

  return { title, text, url };
}
