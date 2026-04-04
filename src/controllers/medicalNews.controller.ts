import { Request, Response } from 'express';
import { MedicalNews, NewsCategory, NewsLanguage } from '../models/MedicalNews';
import { MedNewsSource } from '../models/MedNewsSource';
import { runMedicalNewsJob, runApifyBulkScrape } from '../jobs/medicalNews.job';
import { scrapeNewsSite, enrichItems } from '../services/apifyNewsScraper';
import { registerClient } from '../services/newsEventEmitter';

/**
 * GET /medical-news — Returns recent medical news with category/language filters.
 */
export async function listMedicalNews(req: Request, res: Response): Promise<void> {
  const { limit = '30', source, category, language, specialty, dateFrom, page = '1' } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};
  if (source) filter.source = source;
  if (category) filter.category = category;
  if (language) filter.language = language;
  if (specialty) filter.specialty = specialty;
  if (dateFrom) filter.publishedAt = { $gte: new Date(dateFrom) };

  const parsedLimit = Math.min(100, parseInt(limit));
  const skip = (Math.max(1, parseInt(page)) - 1) * parsedLimit;

  const [news, total] = await Promise.all([
    MedicalNews.find(filter).sort({ publishedAt: -1 }).skip(skip).limit(parsedLimit),
    MedicalNews.countDocuments(filter),
  ]);

  res.json({
    data: news.map((n) => ({
      id: n._id.toString(),
      title: n.title,
      summary: n.summary,
      source: n.source,
      url: n.url,
      category: n.category,
      language: n.language,
      specialty: n.specialty,
      author: n.author ?? null,
      tags: n.tags ?? [],
      wordCount: n.wordCount ?? null,
      publishedAt: n.publishedAt,
    })),
    total,
    page: parseInt(page),
    totalPages: Math.ceil(total / parsedLimit),
  });
}

/**
 * GET /medical-news/sources — Returns distinct sources available in the database.
 */
export async function listSources(_req: Request, res: Response): Promise<void> {
  const sources = await MedicalNews.distinct('source');
  res.json(sources.sort());
}

/**
 * POST /medical-news/refresh — Triggers an immediate fetch of all news sources.
 */
export async function refreshNews(_req: Request, res: Response): Promise<void> {
  runMedicalNewsJob().catch((err) => console.error('[medicalNews] Manual refresh error:', err));
  res.json({ message: 'Refresh started in background' });
}

/**
 * POST /medical-news/sources/scrape-all — Bulk scrapes all active html sources via Apify.
 * Runs in background with concurrency=3. Progress is streamed via GET /medical-news/stream
 * using the named SSE event `bulk-scrape`.
 */
export async function bulkScrapeNewsSources(req: Request, res: Response): Promise<void> {
  const sources = await MedNewsSource.find({ method: 'html', isActive: true });
  const total = sources.length;

  if (total === 0) {
    res.status(404).json({ message: 'No active html sources found' });
    return;
  }

  runApifyBulkScrape(3).catch((err) => console.error('[bulkScrape] Fatal error:', err));

  res.json({
    message: `Bulk scrape started for ${total} sources`,
    total,
    concurrency: 3,
    stream: 'GET /medical-news/stream (event: bulk-scrape)',
  });
}

/**
 * GET /medical-news/sources — Lists all registered scrape sources.
 */
export async function listNewsSources(_req: Request, res: Response): Promise<void> {
  const sources = await MedNewsSource.find().sort({ priority: 1, name: 1 });
  res.json(sources);
}

/**
 * POST /medical-news/sources — Creates a new scrape source.
 */
export async function createNewsSource(req: Request, res: Response): Promise<void> {
  const source = await MedNewsSource.create(req.body);
  res.status(201).json(source);
}

/**
 * PATCH /medical-news/sources/:id — Updates a source by id.
 */
export async function updateNewsSource(req: Request, res: Response): Promise<void> {
  const source = await MedNewsSource.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
  if (!source) { res.status(404).json({ message: 'Source not found' }); return; }
  res.json(source);
}

/**
 * DELETE /medical-news/sources/:id — Removes a source by id.
 */
export async function deleteNewsSource(req: Request, res: Response): Promise<void> {
  const source = await MedNewsSource.findByIdAndDelete(req.params.id);
  if (!source) { res.status(404).json({ message: 'Source not found' }); return; }
  res.status(204).send();
}

/**
 * POST /medical-news/sources/:id/scrape — Triggers an immediate Apify scrape for a single HTML source.
 */
export async function scrapeNewsSource(req: Request, res: Response): Promise<void> {
  const source = await MedNewsSource.findById(req.params.id);
  if (!source) { res.status(404).json({ message: 'Source not found' }); return; }
  if (source.method !== 'html') { res.status(400).json({ message: 'Only html-method sources can be scraped via Apify' }); return; }

  try {
    const raw = await scrapeNewsSite(source.newsPageUrl ?? source.url);
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    const scrapedUrls = raw.map((i) => i.url);
    const existing = await MedicalNews.find({ url: { $in: scrapedUrls } }).select('url').lean();
    const existingUrls = new Set(existing.map((d) => d.url));
    const newItems = raw.filter((i) => !existingUrls.has(i.url));

    const items = await enrichItems(newItems, source.language as NewsLanguage);

    let saved = 0;
    for (const item of items) {
      const expiresAt = new Date(item.publishedAt.getTime() + THIRTY_DAYS_MS);
      const result = await MedicalNews.updateOne(
        { url: item.url },
        {
          $setOnInsert: {
            title: item.title,
            summary: item.summary,
            source: source.name,
            url: item.url,
            category: source.category as NewsCategory,
            language: source.language as NewsLanguage,
            specialty: source.specialty,
            publishedAt: item.publishedAt,
            fetchedAt: new Date(),
            expiresAt,
            ...(item.imageUrl && { imageUrl: item.imageUrl }),
            ...(item.author && { author: item.author }),
            ...(item.tags?.length && { tags: item.tags }),
            ...(item.wordCount && { wordCount: item.wordCount }),
          },
        },
        { upsert: true },
      );
      if (result.upsertedCount > 0) saved++;
    }

    source.lastScrapedAt = new Date();
    await source.save();

    res.json({ scraped: raw.length, new: items.length, saved, lastScrapedAt: source.lastScrapedAt });
  } catch (err) {
    res.status(502).json({ message: 'Scrape failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

/**
 * GET /medical-news/stream — SSE endpoint that pushes new news items in real-time.
 */
export function streamNews(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(': connected\n\n');

  registerClient(res);
}
