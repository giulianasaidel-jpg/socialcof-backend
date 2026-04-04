/**
 * Migration — sets the `newsPageUrl` field on all existing MedNewsSource documents
 * that have a known dedicated news/blog page.
 *
 * The scraper uses `newsPageUrl` when set, falling back to `url` (homepage).
 * Sources without a dedicated news page are left without `newsPageUrl`.
 *
 * Safe to re-run: idempotent ($set).
 *
 * Run:
 *   pnpm ts-node-dev --transpile-only --no-notify --watch "" src/scripts/migrateNewsPageUrl.ts
 */

import mongoose from 'mongoose';
import { env } from '../config/env';
import { MedNewsSource } from '../models/MedNewsSource';

const URL_NEWS_PAGE_MAP: Record<string, string> = {
  'https://www.guidelinecentral.com':                       'https://www.guidelinecentral.com/news/',
  'https://www.mdlinx.com':                                 'https://www.mdlinx.com/news',
  'https://www.endpts.com':                                 'https://www.endpts.com/news/',
  'https://www.ahrq.gov':                                   'https://www.ahrq.gov/news/index.html',
  'https://www.uspreventiveservicestaskforce.org':          'https://www.uspreventiveservicestaskforce.org/uspstf/announcements',
  'https://www.idsociety.org/practice-guideline/idsa-guidelines': 'https://www.idsociety.org/news--publications-new/articles/',
  'https://www.acc.org/guidelines':                         'https://www.acc.org/latest-in-cardiology/articles/',
  'https://www.escardio.org/Guidelines':                    'https://www.escardio.org/The-ESC/Press-Office/Press-releases',
  'https://www.gov.br/conitec':                             'https://www.gov.br/conitec/pt-br/noticias',
  'https://www.portal.cardiol.br':                          'https://portal.cardiol.br/noticias',
  'https://infectologia.org.br':                            'https://infectologia.org.br/noticias',
  'https://sbim.org.br':                                    'https://sbim.org.br/noticias',
  'https://www.sbp.com.br':                                 'https://www.sbp.com.br/noticias/',
  'https://www.febrasgo.org.br':                            'https://www.febrasgo.org.br/noticias',
  'https://www.sbmfc.org.br':                               'https://www.sbmfc.org.br/noticias',
  'https://med.estrategia.com/portal':                      'https://med.estrategia.com/portal/blog',
  'https://www.sanarmed.com':                               'https://www.sanarmed.com/blog',
  'https://jaleko.com.br':                                  'https://jaleko.com.br/blog',
  'https://www.hc.fm.usp.br':                              'https://www.hc.fm.usp.br/hc/noticias',
  'https://www.unifesp.br':                                 'https://www.unifesp.br/noticias-anteriores',
  'https://www.unicamp.br':                                 'https://www.unicamp.br/unicamp/noticias',
  'https://ufrj.br':                                        'https://ufrj.br/noticias',
  'https://ufmg.br':                                        'https://ufmg.br/comunicacao/noticias',
  'https://www.ufrgs.br':                                   'https://www.ufrgs.br/noticias',
  'https://www.fmrp.usp.br':                                'https://www.fmrp.usp.br/noticias/',
  'https://www.ufpr.br':                                    'https://www.ufpr.br/portalufpr/noticias/',
  'https://ufsc.br':                                        'https://noticias.ufsc.br/',
  'https://www.ufpe.br':                                    'https://www.ufpe.br/noticias',
};

async function main(): Promise<void> {
  await mongoose.connect(env.MONGOURI);
  console.log('[migrateNewsPageUrl] Connected to MongoDB');

  let updated = 0;

  for (const [url, newsPageUrl] of Object.entries(URL_NEWS_PAGE_MAP)) {
    const result = await MedNewsSource.updateMany(
      { url, newsPageUrl: { $exists: false } },
      { $set: { newsPageUrl } },
    );
    if (result.modifiedCount > 0) {
      console.log(`  ✓ ${url}`);
      console.log(`    → ${newsPageUrl}`);
      updated += result.modifiedCount;
    }
  }

  console.log(`\n[migrateNewsPageUrl] Done. ${updated} documents updated.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[migrateNewsPageUrl] Fatal error:', err);
  process.exit(1);
});
