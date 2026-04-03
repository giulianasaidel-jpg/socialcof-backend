import RSSParser from 'rss-parser';
import { MedicalNews, NewsCategory, NewsLanguage } from '../models/MedicalNews';
import { fetchPubMedArticles } from '../services/pubmed';
import { scrapeEbserh, scrapeEnare, scrapeResidenciaMedica } from '../services/medicalScraper';
import { broadcastNewsItem } from '../services/newsEventEmitter';

const parser = new RSSParser();

interface RSSSource {
  source: string;
  url: string;
  category: NewsCategory;
  language: NewsLanguage;
}

const RSS_SOURCES: RSSSource[] = [
  { source: 'CFM', url: 'https://www.cfm.org.br/rss/noticias.rss', category: 'government', language: 'pt' },
  { source: 'Gov.br Saúde', url: 'https://www.gov.br/saude/pt-br/assuntos/noticias/RSS', category: 'government', language: 'pt' },
  { source: 'Ministério da Saúde', url: 'https://www.gov.br/saude/pt-br/@@rss.xml', category: 'government', language: 'pt' },
  { source: 'ANVISA', url: 'https://www.gov.br/anvisa/pt-br/@@rss.xml', category: 'government', language: 'pt' },
  { source: 'FIOCRUZ', url: 'https://portal.fiocruz.br/rss.xml', category: 'research', language: 'pt' },
  { source: 'EBSERH', url: 'https://www.gov.br/ebserh/pt-br/@@rss.xml', category: 'education', language: 'pt' },
  { source: 'SciELO', url: 'https://preprints.scielo.org/index.php/scielo/gateway/plugin/WebFeedGatewayPlugin/rss2', category: 'research', language: 'pt' },
  { source: 'OPAS/OMS Brasil', url: 'https://www.paho.org/pt/rss.xml', category: 'global', language: 'pt' },

  { source: 'SBC - Cardiologia', url: 'https://www.portal.cardiol.br/rss/noticias.xml', category: 'guidelines', language: 'pt' },
  { source: 'SBEM - Endocrinologia', url: 'https://www.endocrino.org.br/feed/', category: 'guidelines', language: 'pt' },

  { source: 'NEJM', url: 'https://www.nejm.org/action/showFeed?jc=nejm&type=etoc&feed=rss', category: 'journal', language: 'en' },
  { source: 'The Lancet', url: 'https://www.thelancet.com/rssfeed/lancet_current.xml', category: 'journal', language: 'en' },
  { source: 'BMJ', url: 'https://www.bmj.com/rss/recent.xml', category: 'journal', language: 'en' },
  { source: 'JAMA', url: 'https://jamanetwork.com/rss/site_3/67.xml', category: 'journal', language: 'en' },
  { source: 'Nature Medicine', url: 'https://www.nature.com/nm.rss', category: 'journal', language: 'en' },
  { source: 'Annals of Internal Medicine', url: 'https://www.acpjournals.org/action/showFeed?type=etoc&feed=rss&jc=aim', category: 'journal', language: 'en' },

  { source: 'WHO', url: 'https://www.who.int/rss-feeds/news-english.xml', category: 'global', language: 'en' },
  { source: 'CDC', url: 'https://tools.cdc.gov/api/v2/resources/media/316422.rss', category: 'global', language: 'en' },

  { source: 'AHA - Cardiology', url: 'https://newsroom.heart.org/rss/news-releases.xml', category: 'guidelines', language: 'en' },
  { source: 'ACC - Cardiology', url: 'https://www.acc.org/rss/clinical-topics', category: 'guidelines', language: 'en' },
];

const PUBMED_QUERIES = [
  { query: 'brazil medical residency OR residencia medica', source: 'PubMed - Residência Médica', category: 'education' as NewsCategory, language: 'en' as NewsLanguage },
  { query: 'clinical guidelines 2025 2026', source: 'PubMed - Diretrizes', category: 'guidelines' as NewsCategory, language: 'en' as NewsLanguage },
  { query: 'brazil public health policy', source: 'PubMed - Saúde Pública BR', category: 'research' as NewsCategory, language: 'en' as NewsLanguage },
  { query: 'medical education assessment OSCE', source: 'PubMed - Educação Médica', category: 'education' as NewsCategory, language: 'en' as NewsLanguage },
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function upsertNews(
  title: string,
  summary: string,
  source: string,
  url: string,
  category: NewsCategory,
  language: NewsLanguage,
  publishedAt: Date,
): Promise<void> {
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
        publishedAt,
        fetchedAt: new Date(),
        expiresAt,
      },
    },
    { upsert: true },
  );

  if (result.upsertedCount > 0) {
    broadcastNewsItem({ id: result.upsertedId!.toString(), title, summary, source, url, category, language, publishedAt: publishedAt.toISOString() });
  }
}

async function fetchRSSSources(): Promise<void> {
  for (const { source, url, category, language } of RSS_SOURCES) {
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
  for (const { query, source, category, language } of PUBMED_QUERIES) {
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
    { fn: scrapeEbserh, source: 'EBSERH', category: 'education' as NewsCategory },
    { fn: scrapeEnare, source: 'ENARE/ENAMED', category: 'education' as NewsCategory },
    { fn: scrapeResidenciaMedica, source: 'Residência Médica', category: 'education' as NewsCategory },
  ];

  for (const { fn, source, category } of scrapers) {
    try {
      const items = await fn();
      for (const item of items) {
        await upsertNews(item.title, item.summary, source, item.url, category, 'pt', item.publishedAt);
      }
      console.log(`[medicalNews] Scraper ${source}: ${items.length} items`);
    } catch (err) {
      console.error(`[medicalNews] Scraper ${source} failed:`, err);
    }
  }
}

export async function runMedicalNewsJob(): Promise<void> {
  console.log('[medicalNews] Starting comprehensive fetch...');
  const start = Date.now();

  await Promise.allSettled([
    fetchRSSSources(),
    fetchPubMedSources(),
    fetchScrapedSources(),
  ]);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[medicalNews] Done in ${elapsed}s`);
}
