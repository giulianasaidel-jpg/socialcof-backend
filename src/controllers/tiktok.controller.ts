import { Request, Response } from 'express';
import { TikTokTrend } from '../models/TikTokTrend';

/**
 * GET /tiktok/trends — Returns recent TikTok trends from the database (populated by cron job).
 */
export async function listTrends(req: Request, res: Response): Promise<void> {
  const { limit = '20', country = 'BR', category } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = { country };
  if (category) filter.category = category;

  const trends = await TikTokTrend.find(filter)
    .sort({ rank: 1 })
    .limit(Math.min(100, parseInt(limit)));

  res.json(
    trends.map((t) => ({
      id: t._id.toString(),
      rank: t.rank,
      title: t.title,
      hashtag: t.hashtag,
      volumeLabel: t.volumeLabel,
      fetchedAt: t.fetchedAt,
      country: t.country,
      category: t.category,
    })),
  );
}
