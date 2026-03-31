import { Request, Response } from 'express';
import { MedicalNews } from '../models/MedicalNews';

/**
 * GET /medical-news — Returns recent medical news from the database (populated by cron job).
 */
export async function listMedicalNews(req: Request, res: Response): Promise<void> {
  const { limit = '20', source, dateFrom } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};
  if (source) filter.source = source;
  if (dateFrom) filter.publishedAt = { $gte: new Date(dateFrom) };

  const news = await MedicalNews.find(filter)
    .sort({ publishedAt: -1 })
    .limit(Math.min(100, parseInt(limit)));

  res.json(
    news.map((n) => ({
      id: n._id.toString(),
      title: n.title,
      summary: n.summary,
      source: n.source,
      url: n.url,
      publishedAt: n.publishedAt,
    })),
  );
}
