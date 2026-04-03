import { Request, Response } from 'express';
import { MedicalNews } from '../models/MedicalNews';
import { runMedicalNewsJob } from '../jobs/medicalNews.job';
import { registerClient } from '../services/newsEventEmitter';

/**
 * GET /medical-news — Returns recent medical news with category/language filters.
 */
export async function listMedicalNews(req: Request, res: Response): Promise<void> {
  const { limit = '30', source, category, language, dateFrom, page = '1' } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};
  if (source) filter.source = source;
  if (category) filter.category = category;
  if (language) filter.language = language;
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
