import https from 'https';

export interface PubMedArticle {
  pmid: string;
  title: string;
  abstract: string;
  journal: string;
  publishedAt: Date;
  url: string;
}

const BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function extractBetween(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim().replace(/<[^>]+>/g, '') : '';
}

function extractAllBetween(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

function extractPubDate(articleXml: string): Date {
  const year = extractBetween(articleXml, 'Year');
  const month = extractBetween(articleXml, 'Month');
  const day = extractBetween(articleXml, 'Day');
  if (!year) return new Date();
  const monthStr = month.length <= 2 ? month.padStart(2, '0') : month;
  return new Date(`${year}-${monthStr}-${day || '01'}`);
}

async function searchPubMed(query: string, maxResults = 15): Promise<string[]> {
  const url = `${BASE_URL}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&sort=date&retmode=json`;
  const raw = await httpsGet(url);
  const data = JSON.parse(raw);
  return data?.esearchresult?.idlist ?? [];
}

async function fetchArticles(pmids: string[]): Promise<PubMedArticle[]> {
  if (!pmids.length) return [];
  const url = `${BASE_URL}/efetch.fcgi?db=pubmed&id=${pmids.join(',')}&rettype=xml&retmode=xml`;
  const xml = await httpsGet(url);

  const articles = extractAllBetween(xml, 'PubmedArticle');
  return articles.map((articleXml) => {
    const pmid = extractBetween(articleXml, 'PMID');
    const title = extractBetween(articleXml, 'ArticleTitle');
    const abstract = extractBetween(articleXml, 'AbstractText');
    const journal = extractBetween(articleXml, 'Title');
    const publishedAt = extractPubDate(articleXml);

    return {
      pmid,
      title,
      abstract,
      journal,
      publishedAt,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    };
  });
}

export async function fetchPubMedArticles(query: string, maxResults = 15): Promise<PubMedArticle[]> {
  const ids = await searchPubMed(query, maxResults);
  return fetchArticles(ids);
}
