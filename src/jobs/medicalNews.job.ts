import RSSParser from 'rss-parser';
import { MedicalNews } from '../models/MedicalNews';

const parser = new RSSParser();

const RSS_SOURCES: { source: string; url: string }[] = [
  { source: 'CFM', url: 'https://www.cfm.org.br/rss/noticias.rss' },
  { source: 'Gov.br Saúde', url: 'https://www.gov.br/saude/pt-br/assuntos/noticias/RSS' },
  { source: 'SciELO', url: 'https://preprints.scielo.org/index.php/scielo/gateway/plugin/WebFeedGatewayPlugin/rss2' },
  { source: 'Ministério da Saúde', url: 'https://www.gov.br/saude/pt-br/@@rss.xml' },
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Fetches and persists medical news from all configured RSS sources.
 * Items are deduplicated by URL and expire after 30 days via MongoDB TTL index.
 */
export async function runMedicalNewsJob(): Promise<void> {
  console.log('[medicalNews] Starting RSS fetch...');

  for (const { source, url } of RSS_SOURCES) {
    try {
      const feed = await parser.parseURL(url);

      for (const item of feed.items) {
        if (!item.link || !item.title) continue;

        const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
        const expiresAt = new Date(publishedAt.getTime() + THIRTY_DAYS_MS);
        const fetchedAt = new Date();

        await MedicalNews.updateOne(
          { url: item.link },
          {
            $setOnInsert: {
              title: item.title,
              summary: item.contentSnippet ?? item.summary ?? '',
              source,
              url: item.link,
              publishedAt,
              fetchedAt,
              expiresAt,
            },
          },
          { upsert: true },
        );
      }

      console.log(`[medicalNews] Fetched ${feed.items.length} items from ${source}`);
    } catch (err) {
      console.error(`[medicalNews] Failed to fetch ${source}:`, err);
    }
  }

  console.log('[medicalNews] Done.');
}
