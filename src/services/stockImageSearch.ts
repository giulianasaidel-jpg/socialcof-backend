import OpenAI from 'openai';
import { env } from '../config/env';

type UnsplashOrientation = 'landscape' | 'portrait' | 'squarish';

interface UnsplashSearchResult {
  results?: Array<{ urls?: { regular?: string; full?: string } }>;
}

function heuristicStockQuery(transcript: string, caption: string): string {
  const base = (caption || transcript || 'healthcare').slice(0, 160);
  const cleaned = base.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter((w) => w.length > 2).slice(0, 8);
  const q = words.join(' ');
  return q ? `${q} medical` : 'medical education hospital';
}

export async function deriveStockSearchQuery(transcript: string, caption: string): Promise<string> {
  const snippet = [caption, transcript].filter(Boolean).join('\n').slice(0, 1800);
  if (env.GPT_KEY) {
    try {
      const client = new OpenAI({ apiKey: env.GPT_KEY });
      const r = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'Reply with ONLY 3 to 6 English keywords for stock photo search (healthcare or medical education context). No punctuation, quotes, or explanation.',
          },
          { role: 'user', content: snippet },
        ],
        max_tokens: 40,
      });
      const q = r.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
      if (q) return q.slice(0, 120);
    } catch {
      /* use heuristic */
    }
  }
  return heuristicStockQuery(transcript, caption);
}

export async function searchUnsplashPhotos(
  query: string,
  opts: { perPage: number; page: number; orientation: UnsplashOrientation },
): Promise<string[]> {
  const key = env.UNSPLASH_ACCESS_KEY;
  if (!key) throw new Error('UNSPLASH_ACCESS_KEY is not configured');

  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(Math.min(Math.max(opts.perPage, 1), 30)));
  url.searchParams.set('page', String(Math.max(opts.page, 1)));
  url.searchParams.set('orientation', opts.orientation);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Client-ID ${key}` },
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Unsplash search failed: ${res.status} ${t.slice(0, 200)}`);
  }

  const data = (await res.json()) as UnsplashSearchResult;
  const list = data.results ?? [];
  return list.map((r) => r.urls?.regular || r.urls?.full).filter((u): u is string => Boolean(u));
}

export async function fetchWebBackgroundUrls(
  transcript: string,
  caption: string,
  count: number,
  panoramic: boolean,
): Promise<{ urls: string[]; query: string }> {
  const query = await deriveStockSearchQuery(transcript, caption);
  if (panoramic) {
    const found = await searchUnsplashPhotos(query, { perPage: 8, page: 1, orientation: 'landscape' });
    const u = found[0];
    if (!u) return { urls: [], query };
    return { urls: Array.from({ length: count }, () => u), query };
  }
  const need = Math.max(count, 1);
  const found = await searchUnsplashPhotos(query, { perPage: Math.min(30, Math.max(need, 12)), page: 1, orientation: 'squarish' });
  return { urls: found.slice(0, count), query };
}

export async function searchAlternateBackgroundUrls(
  query: string,
  page: number,
  orientation: UnsplashOrientation,
  perPage = 10,
): Promise<string[]> {
  return searchUnsplashPhotos(query, { perPage, page, orientation });
}
