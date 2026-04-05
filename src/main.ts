import './config/env';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { connectDatabase } from './config/mongoose';
import { buildCorsOptions } from './config/cors';
import { env } from './config/env';

import authRoutes from './routes/auth.routes';
import instagramAccountsRoutes from './routes/instagramAccounts.routes';
import productsRoutes from './routes/products.routes';
import postsRoutes from './routes/posts.routes';
import scheduleRoutes from './routes/schedule.routes';
import competitorsRoutes from './routes/competitors.routes';
import draftsRoutes from './routes/drafts.routes';
import referencePostsRoutes from './routes/referencePosts.routes';
import adminRoutes from './routes/admin.routes';
import tiktokRoutes from './routes/tiktok.routes';
import tiktokAccountsRoutes from './routes/tiktokAccounts.routes';
import instagramStoriesRoutes from './routes/instagramStories.routes';
import medicalNewsRoutes from './routes/medicalNews.routes';
import twitterPostsRoutes from './routes/twitterPosts.routes';
import storyReplyRoutes from './routes/storyReply.routes';
import imagePostRoutes from './routes/imagePost.routes';

import { runMedicalNewsJob, runApifyNewsRoundRobinTick } from './jobs/medicalNews.job';
import { runTikTokTrendsJob } from './jobs/tiktokTrends.job';
import { runInstagramScrapeRoundRobinTick } from './jobs/instagramScrapeRoundRobin.job';
import { runMediaSyncSlotTick } from './jobs/mediaSync.job';

const SAO_PAULO_TZ = 'America/Sao_Paulo';

async function bootstrap(): Promise<void> {
  await connectDatabase();

  const app = express();

  app.use(cors(buildCorsOptions()));
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/auth', authRoutes);
  app.use('/instagram-accounts', instagramAccountsRoutes);
  app.use('/products', productsRoutes);
  app.use('/posts', postsRoutes);
  app.use('/schedule', scheduleRoutes);
  app.use('/competitors', competitorsRoutes);
  app.use('/drafts', draftsRoutes);
  app.use('/reference-posts', referencePostsRoutes);
  app.use('/admin', adminRoutes);
  app.use('/tiktok', tiktokRoutes);
  app.use('/tiktok-accounts', tiktokAccountsRoutes);
  app.use('/instagram-stories', instagramStoriesRoutes);
  app.use('/medical-news', medicalNewsRoutes);
  app.use('/twitter-posts', twitterPostsRoutes);
  app.use('/story-replies', storyReplyRoutes);
  app.use('/image-posts', imagePostRoutes);

  app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

  cron.schedule(env.NEWS_RSS_CRON_SCHEDULE, () => {
    runMedicalNewsJob().catch((err) => console.error('[medicalNews] Job error:', err));
  });

  cron.schedule(env.TIKTOK_CRON_SCHEDULE, () => {
    runTikTokTrendsJob().catch((err) => console.error('[tiktokTrends] Job error:', err));
  });

  cron.schedule(
    env.INSTAGRAM_SCRAPE_CRON_SCHEDULE,
    () => {
      runInstagramScrapeRoundRobinTick().catch((err) => console.error('[cron] Instagram scrape tick:', err));
    },
    { timezone: SAO_PAULO_TZ },
  );

  cron.schedule(
    env.NEWS_APIFY_SCRAPE_CRON_SCHEDULE,
    () => {
      runApifyNewsRoundRobinTick().catch((err) => console.error('[cron] Apify news scrape tick:', err));
    },
    { timezone: SAO_PAULO_TZ },
  );

  cron.schedule(
    '* * * * *',
    () => {
      runMediaSyncSlotTick().catch((err) => console.error('[cron] Media sync tick:', err));
    },
    { timezone: SAO_PAULO_TZ },
  );

  const port = parseInt(env.PORT);
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
