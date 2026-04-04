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

import { runMedicalNewsJob, runApifyBulkScrape } from './jobs/medicalNews.job';
import { runTikTokTrendsJob } from './jobs/tiktokTrends.job';
import { runInstagramSyncJob } from './jobs/instagramSync.job';
import { runMediaSyncJob } from './jobs/mediaSync.job';

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

  app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

  cron.schedule(env.NEWS_RSS_CRON_SCHEDULE, () => {
    runMedicalNewsJob().catch((err) => console.error('[medicalNews] Job error:', err));
  });

  cron.schedule(env.TIKTOK_CRON_SCHEDULE, () => {
    runTikTokTrendsJob().catch((err) => console.error('[tiktokTrends] Job error:', err));
  });

  cron.schedule('0 0 * * *', () => {
    runInstagramSyncJob().catch((err) => console.error('[instagramSync] Job error:', err));
  }, { timezone: 'America/Sao_Paulo' });

  cron.schedule(env.NEWS_APIFY_CRON_SCHEDULE, () => {
    runApifyBulkScrape(3).catch((err) => console.error('[apifyBulkScrape] Job error:', err));
  }, { timezone: 'America/Sao_Paulo' });

  cron.schedule(env.MEDIA_SYNC_CRON_SCHEDULE, () => {
    runMediaSyncJob().catch((err) => console.error('[mediaSync] Job error:', err));
  }, { timezone: 'America/Sao_Paulo' });

  const port = parseInt(env.PORT);
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
