import RSSParser from 'rss-parser';
import { MedicalNews, NewsCategory, NewsLanguage, NewsSpecialty } from '../models/MedicalNews';
import { MedNewsSource } from '../models/MedNewsSource';
import { fetchPubMedArticles } from '../services/pubmed';
import { scrapeEbserh, scrapeEnare, scrapeResidenciaMedica } from '../services/medicalScraper';
import { scrapeNewsSite, enrichItems } from '../services/apifyNewsScraper';
import { broadcastNewsItem, broadcastBulkProgress } from '../services/newsEventEmitter';
import { IMedNewsSource } from '../models/MedNewsSource';

const parser = new RSSParser();

interface RSSSource {
  source: string;
  url: string;
  category: NewsCategory;
  language: NewsLanguage;
  specialty: NewsSpecialty;
}

const RSS_SOURCES: RSSSource[] = [
  { source: 'CFM', url: 'https://www.cfm.org.br/rss/noticias.rss', category: 'government', language: 'pt', specialty: 'outras' },
  { source: 'Gov.br Saúde', url: 'https://www.gov.br/saude/pt-br/assuntos/noticias/RSS', category: 'government', language: 'pt', specialty: 'outras' },
  { source: 'Ministério da Saúde', url: 'https://www.gov.br/saude/pt-br/@@rss.xml', category: 'government', language: 'pt', specialty: 'outras' },
  { source: 'ANVISA', url: 'https://www.gov.br/anvisa/pt-br/@@rss.xml', category: 'government', language: 'pt', specialty: 'outras' },
  { source: 'FIOCRUZ', url: 'https://portal.fiocruz.br/rss.xml', category: 'research', language: 'pt', specialty: 'outras' },
  { source: 'EBSERH', url: 'https://www.gov.br/ebserh/pt-br/@@rss.xml', category: 'education', language: 'pt', specialty: 'residencia' },
  { source: 'SciELO', url: 'https://preprints.scielo.org/index.php/scielo/gateway/plugin/WebFeedGatewayPlugin/rss2', category: 'research', language: 'pt', specialty: 'outras' },
  { source: 'OPAS/OMS Brasil', url: 'https://www.paho.org/pt/rss.xml', category: 'global', language: 'pt', specialty: 'preventiva' },

  { source: 'SBC - Cardiologia', url: 'https://www.portal.cardiol.br/rss/noticias.xml', category: 'guidelines', language: 'pt', specialty: 'clinica_medica' },
  { source: 'SBEM - Endocrinologia', url: 'https://www.endocrino.org.br/feed/', category: 'guidelines', language: 'pt', specialty: 'clinica_medica' },

  { source: 'NEJM', url: 'https://www.nejm.org/action/showFeed?jc=nejm&type=etoc&feed=rss', category: 'journal', language: 'en', specialty: 'clinica_medica' },
  { source: 'The Lancet', url: 'https://www.thelancet.com/rssfeed/lancet_current.xml', category: 'journal', language: 'en', specialty: 'clinica_medica' },
  { source: 'BMJ', url: 'https://www.bmj.com/rss/recent.xml', category: 'journal', language: 'en', specialty: 'clinica_medica' },
  { source: 'JAMA', url: 'https://jamanetwork.com/rss/site_3/67.xml', category: 'journal', language: 'en', specialty: 'clinica_medica' },
  { source: 'Nature Medicine', url: 'https://www.nature.com/nm.rss', category: 'journal', language: 'en', specialty: 'outras' },
  { source: 'Annals of Internal Medicine', url: 'https://www.acpjournals.org/action/showFeed?type=etoc&feed=rss&jc=aim', category: 'journal', language: 'en', specialty: 'clinica_medica' },

  { source: 'WHO', url: 'https://www.who.int/rss-feeds/news-english.xml', category: 'global', language: 'en', specialty: 'preventiva' },
  { source: 'CDC', url: 'https://tools.cdc.gov/api/v2/resources/media/316422.rss', category: 'global', language: 'en', specialty: 'preventiva' },

  { source: 'AHA - Cardiology', url: 'https://newsroom.heart.org/rss/news-releases.xml', category: 'guidelines', language: 'en', specialty: 'clinica_medica' },
  { source: 'ACC - Cardiology', url: 'https://www.acc.org/rss/clinical-topics', category: 'guidelines', language: 'en', specialty: 'clinica_medica' },
];

const PUBMED_QUERIES = [
  { query: 'brazil medical residency OR residencia medica', source: 'PubMed - Residência Médica', category: 'education' as NewsCategory, language: 'en' as NewsLanguage, specialty: 'residencia' as NewsSpecialty },
  { query: 'clinical guidelines 2025 2026', source: 'PubMed - Diretrizes', category: 'guidelines' as NewsCategory, language: 'en' as NewsLanguage, specialty: 'clinica_medica' as NewsSpecialty },
  { query: 'brazil public health policy', source: 'PubMed - Saúde Pública BR', category: 'research' as NewsCategory, language: 'en' as NewsLanguage, specialty: 'preventiva' as NewsSpecialty },
  { query: 'medical education assessment OSCE', source: 'PubMed - Educação Médica', category: 'education' as NewsCategory, language: 'en' as NewsLanguage, specialty: 'residencia' as NewsSpecialty },
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface UpsertNewsExtras {
  imageUrl?: string | null;
  author?: string | null;
  tags?: string[];
  wordCount?: number;
}

async function upsertNews(
  title: string,
  summary: string,
  source: string,
  url: string,
  category: NewsCategory,
  language: NewsLanguage,
  specialty: NewsSpecialty,
  publishedAt: Date,
  extras: UpsertNewsExtras = {},
): Promise<boolean> {
  const expiresAt = new Date(publishedAt.getTime() + THIRTY_DAYS_MS);
  const result = await MedicalNews.updateOne(
    { url },
    {
      $setOnInsert: {
        title,
        summary,
        source,
        url,
        category,
        language,
        specialty,
        publishedAt,
        fetchedAt: new Date(),
        expiresAt,
        ...(extras.imageUrl && { imageUrl: extras.imageUrl }),
        ...(extras.author && { author: extras.author }),
        ...(extras.tags?.length && { tags: extras.tags }),
        ...(extras.wordCount && { wordCount: extras.wordCount }),
      },
    },
    { upsert: true },
  );

  if (result.upsertedCount > 0) {
    broadcastNewsItem({ id: result.upsertedId!.toString(), title, summary, source, url, category, language, publishedAt: publishedAt.toISOString() });
    return true;
  }
  return false;
}

async function fetchRSSSources(): Promise<void> {
  for (const { source, url, category, language, specialty } of RSS_SOURCES) {
    try {
      const feed = await parser.parseURL(url);
      let count = 0;
      for (const item of feed.items) {
        if (!item.link || !item.title) continue;
        const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
        await upsertNews(
          item.title,
          item.contentSnippet ?? item.summary ?? '',
          source,
          item.link,
          category,
          language,
          specialty,
          publishedAt,
        );
        count++;
      }
      console.log(`[medicalNews] RSS ${source}: ${count} items`);
    } catch (err) {
      console.error(`[medicalNews] RSS ${source} failed:`, err);
    }
  }
}

async function fetchPubMedSources(): Promise<void> {
  for (const { query, source, category, language, specialty } of PUBMED_QUERIES) {
    try {
      const articles = await fetchPubMedArticles(query, 10);
      for (const article of articles) {
        await upsertNews(
          article.title,
          article.abstract.slice(0, 500),
          source,
          article.url,
          category,
          language,
          specialty,
          article.publishedAt,
        );
      }
      console.log(`[medicalNews] PubMed "${query}": ${articles.length} items`);
    } catch (err) {
      console.error(`[medicalNews] PubMed "${query}" failed:`, err);
    }
  }
}

async function fetchScrapedSources(): Promise<void> {
  const scrapers = [
    { fn: scrapeEbserh, source: 'EBSERH', category: 'education' as NewsCategory, specialty: 'residencia' as NewsSpecialty },
    { fn: scrapeEnare, source: 'ENARE/ENAMED', category: 'education' as NewsCategory, specialty: 'residencia' as NewsSpecialty },
    { fn: scrapeResidenciaMedica, source: 'Residência Médica', category: 'education' as NewsCategory, specialty: 'residencia' as NewsSpecialty },
  ];

  for (const { fn, source, category, specialty } of scrapers) {
    try {
      const items = await fn();
      for (const item of items) {
        await upsertNews(item.title, item.summary, source, item.url, category, 'pt', specialty, item.publishedAt, {});
      }
      console.log(`[medicalNews] Scraper ${source}: ${items.length} items`);
    } catch (err) {
      console.error(`[medicalNews] Scraper ${source} failed:`, err);
    }
  }
}

interface SourceScrapeResult {
  sourceName: string;
  scraped: number;
  newItems: number;
  saved: number;
}

/**
 * Scrapes a single MedNewsSource, enriches new items with AI and persists them.
 * Broadcasts SSE progress events during execution.
 */
export async function scrapeOneSource(source: IMedNewsSource): Promise<SourceScrapeResult> {
  broadcastBulkProgress({ source: source.name, status: 'running' });

  const raw = await scrapeNewsSite(source.newsPageUrl ?? source.url);

  const scrapedUrls = raw.map((i) => i.url);
  const existing = await MedicalNews.find({ url: { $in: scrapedUrls } }).select('url').lean();
  const existingUrls = new Set(existing.map((d) => d.url));
  const newItems = raw.filter((i) => !existingUrls.has(i.url));

  if (newItems.length === 0) {
    source.lastScrapedAt = new Date();
    await source.save();
    broadcastBulkProgress({ source: source.name, status: 'skipped', scraped: raw.length, newItems: 0, saved: 0 });
    return { sourceName: source.name, scraped: raw.length, newItems: 0, saved: 0 };
  }

  const enriched = await enrichItems(newItems, source.language);
  let saved = 0;

  for (const item of enriched) {
    const result = await upsertNews(item.title, item.summary, source.name, item.url, source.category, source.language, source.specialty, item.publishedAt, {
      imageUrl: item.imageUrl,
      author: item.author,
      tags: item.tags,
      wordCount: item.wordCount,
    });
    if (result) saved++;
  }

  source.lastScrapedAt = new Date();
  await source.save();

  broadcastBulkProgress({ source: source.name, status: 'done', scraped: raw.length, newItems: enriched.length, saved });
  return { sourceName: source.name, scraped: raw.length, newItems: enriched.length, saved };
}

async function fetchApifySources(): Promise<void> {
  const sources = await MedNewsSource.find({ method: 'html', isActive: true }).sort({ priority: 1 });
  for (const source of sources) {
    try {
      const result = await scrapeOneSource(source);
      console.log(`[medicalNews] Apify ${result.sourceName}: ${result.newItems} new / ${result.scraped} scraped`);
    } catch (err) {
      console.error(`[medicalNews] Apify ${source.name} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Scrapes all active html sources in parallel with a concurrency limit.
 * Broadcasts SSE progress events for each source and a final summary.
 */
export async function runApifyBulkScrape(concurrency = 3): Promise<void> {
  const sources = await MedNewsSource.find({ method: 'html', isActive: true }).sort({ priority: 1 });
  const total = sources.length;
  let completed = 0;
  let totalNew = 0;

  console.log(`[bulkScrape] Starting — ${total} sources, concurrency=${concurrency}`);

  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency);

    const results = await Promise.allSettled(batch.map((source) => scrapeOneSource(source)));

    for (const result of results) {
      completed++;
      if (result.status === 'fulfilled') {
        totalNew += result.value.newItems;
        console.log(`[bulkScrape] ${result.value.sourceName}: ${result.value.newItems} new / ${result.value.scraped} scraped (${completed}/${total})`);
      } else {
        console.error(`[bulkScrape] failed:`, result.reason);
        broadcastBulkProgress({ source: '(unknown)', status: 'error', error: String(result.reason) });
      }
    }
  }

  broadcastBulkProgress({ source: 'ALL', status: 'complete', totalSources: total, completedSources: completed, totalNew });
  console.log(`[bulkScrape] Done — ${totalNew} new articles from ${completed} sources`);
}

export async function runMedicalNewsJob(): Promise<void> {
  console.log('[medicalNews] Starting comprehensive fetch...');
  const start = Date.now();

  await Promise.allSettled([
    fetchRSSSources(),
    fetchPubMedSources(),
    fetchScrapedSources(),
    fetchApifySources(),
  ]);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[medicalNews] Done in ${elapsed}s`);
}
