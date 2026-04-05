import '../config/env';
import { connectDatabase } from '../config/mongoose';
import { runInstagramScrapeRoundRobinTick } from '../jobs/instagramScrapeRoundRobin.job';
import { runApifyNewsRoundRobinTick } from '../jobs/medicalNews.job';

const which = (process.env.SCRAPE_TICK_WHICH ?? 'all').toLowerCase();

async function main(): Promise<void> {
  await connectDatabase();

  if (which === 'ig' || which === 'instagram') {
    await runInstagramScrapeRoundRobinTick();
    return;
  }

  if (which === 'news' || which === 'apify') {
    await runApifyNewsRoundRobinTick();
    return;
  }

  await runInstagramScrapeRoundRobinTick();
  await runApifyNewsRoundRobinTick();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
