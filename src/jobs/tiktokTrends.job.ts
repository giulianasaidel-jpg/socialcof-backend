import { TikTokTrend } from '../models/TikTokTrend';

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

/**
 * Placeholder TikTok trends job.
 * Replace the `fetchTrends` function body with your chosen integration:
 *   - Apify TikTok Actor (recommended)
 *   - RapidAPI TikTok wrapper
 *   - Puppeteer/Playwright scraper
 */
async function fetchTrends(country: string): Promise<{ rank: number; title: string; hashtag: string; volumeLabel: string; category: string }[]> {
  // TODO: implement using Apify, RapidAPI, or Playwright
  // Example Apify call:
  // const { ApifyClient } = require('apify-client');
  // const client = new ApifyClient({ token: env.TIKTOK_APIFY_TOKEN });
  // const run = await client.actor('clockworks/tiktok-scraper').call({ ...options });
  // return run.items;
  console.warn(`[tiktokTrends] No crawler configured for country=${country}. Returning empty.`);
  return [];
}

/**
 * Fetches TikTok trends and persists them in the database.
 * Old records are deleted automatically by the MongoDB TTL index on `expiresAt`.
 */
export async function runTikTokTrendsJob(): Promise<void> {
  console.log('[tiktokTrends] Starting job...');

  const country = 'BR';
  const trends = await fetchTrends(country);

  if (trends.length === 0) {
    console.log('[tiktokTrends] No trends fetched, skipping insert.');
    return;
  }

  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + FORTY_EIGHT_HOURS_MS);

  await TikTokTrend.deleteMany({ country });

  await TikTokTrend.insertMany(
    trends.map((t) => ({
      rank: t.rank,
      title: t.title,
      hashtag: t.hashtag,
      volumeLabel: t.volumeLabel,
      country,
      category: t.category,
      fetchedAt,
      expiresAt,
    })),
  );

  console.log(`[tiktokTrends] Inserted ${trends.length} trends.`);
}
