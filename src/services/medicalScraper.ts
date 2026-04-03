import https from 'https';
import http from 'http';

export interface ScrapedNewsItem {
  title: string;
  url: string;
  summary: string;
  publishedAt: Date;
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

function fetchPage(url: string, redirectsLeft = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers: HEADERS }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        if (redirectsLeft === 0) return reject(new Error('Too many redirects'));
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return resolve(fetchPage(next, redirectsLeft - 1));
      }
      if (res.statusCode && res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => {
        chunks.push(c);
        if (chunks.reduce((a, b) => a + b.length, 0) > 1_000_000) req.destroy();
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function extractLinks(html: string, baseUrl: string): { href: string; text: string }[] {
  const results: { href: string; text: string }[] = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (!text || text.length < 10) continue;
    if (href.startsWith('/')) href = new URL(href, baseUrl).href;
    if (!href.startsWith('http')) continue;
    results.push({ href, text });
  }
  return results;
}

function extractSnippet(html: string): string {
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  return descMatch ? descMatch[1].trim().slice(0, 500) : '';
}

export async function scrapeEbserh(): Promise<ScrapedNewsItem[]> {
  const url = 'https://www.gov.br/ebserh/pt-br/acesso-a-informacao/agencia-ebserh';
  try {
    const html = await fetchPage(url);
    const links = extractLinks(html, 'https://www.gov.br');
    return links
      .filter((l) => l.href.includes('/ebserh/') && l.href.includes('/noticias/') || l.href.includes('/comunicados/'))
      .slice(0, 15)
      .map((l) => ({
        title: l.text,
        url: l.href,
        summary: '',
        publishedAt: new Date(),
      }));
  } catch (err) {
    console.error('[medicalScraper] EBSERH scrape failed:', err);
    return [];
  }
}

export async function scrapeEnare(): Promise<ScrapedNewsItem[]> {
  const url = 'https://www.gov.br/ebserh/pt-br/acesso-a-informacao/agencia-ebserh/noticias';
  try {
    const html = await fetchPage(url);
    const links = extractLinks(html, 'https://www.gov.br');
    return links
      .filter((l) => l.href.includes('enare') || l.href.includes('residencia') || l.href.includes('enamed'))
      .slice(0, 10)
      .map((l) => ({
        title: l.text,
        url: l.href,
        summary: '',
        publishedAt: new Date(),
      }));
  } catch (err) {
    console.error('[medicalScraper] ENARE scrape failed:', err);
    return [];
  }
}

export async function scrapeResidenciaMedica(): Promise<ScrapedNewsItem[]> {
  const urls = [
    'https://www.gov.br/saude/pt-br/composicao/sgtes/residencias-em-saude',
    'https://www.gov.br/ebserh/pt-br/ensino-e-pesquisa/residencia-medica',
  ];

  const items: ScrapedNewsItem[] = [];
  for (const url of urls) {
    try {
      const html = await fetchPage(url);
      const links = extractLinks(html, new URL(url).origin);
      const filtered = links
        .filter((l) =>
          (l.href.includes('residencia') || l.href.includes('enamed') || l.href.includes('enare'))
          && l.text.length > 15
        )
        .slice(0, 10);
      items.push(...filtered.map((l) => ({
        title: l.text,
        url: l.href,
        summary: '',
        publishedAt: new Date(),
      })));
    } catch (err) {
      console.error(`[medicalScraper] Residência scrape failed for ${url}:`, err);
    }
  }
  return items;
}
