import { ApifyClient } from 'apify-client';
import { env } from '../config/env';
import { summarizeArticle } from './gptAnalysis';

export interface RawScrapedItem {
  url: string;
  title: string;
  rawText: string;
  publishedAt: Date;
  imageUrl: string | null;
  author: string | null;
  tags: string[];
  wordCount: number;
}

export interface ApifyNewsItem {
  url: string;
  title: string;
  summary: string;
  publishedAt: Date;
  imageUrl: string | null;
  author: string | null;
  tags: string[];
  wordCount: number;
}

function getClient(): ApifyClient {
  const token = env.INSTAGRAM_APIFY_TOKEN;
  if (!token) throw new Error('INSTAGRAM_APIFY_TOKEN is not configured');
  return new ApifyClient({ token });
}

function parseDate(raw: unknown): Date {
  if (!raw) return new Date();
  const d = new Date(raw as string);
  return isNaN(d.getTime()) ? new Date() : d;
}

function extractTags(raw: unknown): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length < 60)
    .slice(0, 10);
}

function detectBlogPattern(p: Record<string, unknown>): boolean {
  const metadata = (p.metadata ?? {}) as Record<string, unknown>;
  const hasDate = !!(metadata.datePublished ?? metadata.date ?? metadata['article:published_time']);
  const hasTitle = String(p.title ?? metadata.title ?? '').length > 10;
  const hasBody = String(p.text ?? '').split(/\s+/).length > 100;
  return hasDate || (hasTitle && hasBody);
}

/**
 * Stage 1 — Scrapes a site via Apify and returns raw article candidates.
 * No AI is involved at this stage. The caller is responsible for filtering
 * known URLs before proceeding to enrichment.
 */
export async function scrapeNewsSite(siteUrl: string, maxPages = 15): Promise<RawScrapedItem[]> {
  const client = getClient();

  const run = await client.actor('apify/website-content-crawler').start({
    startUrls: [{ url: siteUrl }],
    maxCrawlDepth: 1,
    maxCrawlPages: maxPages,
    crawlerType: 'cheerio',
    excludeUrlGlobs: ['**/*.pdf', '**/*.zip', '**/*.doc', '**/*.docx', '**/login*', '**/subscribe*', '**/register*'],
  });

  const finished = await client.run(run.id).waitForFinish({ waitSecs: 600 });

  if (finished.status !== 'SUCCEEDED') {
    throw new Error(`Apify run ended with status: ${finished.status}`);
  }

  const { items } = await client.dataset(finished.defaultDatasetId).listItems({ limit: maxPages });

  return (items as Array<Record<string, unknown>>)
    .filter(detectBlogPattern)
    .map((p) => {
      const metadata = (p.metadata ?? {}) as Record<string, unknown>;
      const url = String(p.url ?? '');
      const title = String(p.title ?? metadata.title ?? '').trim();
      const rawText = String(p.text ?? '').trim();
      const imageUrl = (metadata.image ?? null) as string | null;
      const publishedAt = parseDate(metadata.datePublished ?? metadata.date ?? metadata['article:published_time']);
      const author = String(metadata.author ?? metadata['article:author'] ?? '').trim() || null;
      const tags = extractTags(metadata.keywords ?? metadata['article:tag']);
      const wordCount = rawText.split(/\s+/).filter(Boolean).length;

      return { url, title, rawText, imageUrl, publishedAt, author, tags, wordCount };
    })
    .filter((item) => {
      const sourcePathname = new URL(siteUrl).pathname;
      const isDifferentFromSource = item.url !== siteUrl && !item.url.endsWith(sourcePathname);
      return isDifferentFromSource && item.title.length > 10 && item.wordCount > 80;
    });
}

/**
 * Stage 2 — Enriches a list of new (unseen) raw items with an AI-generated summary.
 * Should only be called for items whose URLs are confirmed not to exist in the DB.
 * Falls back to truncated rawText if GPT is unavailable or text is too short.
 */
export async function enrichItems(items: RawScrapedItem[], language: 'pt' | 'en'): Promise<ApifyNewsItem[]> {
  const CONCURRENCY = 5;
  const results: ApifyNewsItem[] = [];

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const summaries = await Promise.all(
      batch.map(async (item) => {
        if (!env.GPT_KEY || item.rawText.length < 200) return item.rawText.slice(0, 500);
        try {
          return await summarizeArticle(item.title, item.rawText, language);
        } catch {
          return item.rawText.slice(0, 500);
        }
      }),
    );

    for (let j = 0; j < batch.length; j++) {
      const { rawText: _, ...rest } = batch[j];
      results.push({ ...rest, summary: summaries[j] });
    }
  }

  return results;
}
