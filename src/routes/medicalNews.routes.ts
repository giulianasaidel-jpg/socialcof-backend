import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  listMedicalNews,
  listSources,
  refreshNews,
  streamNews,
  listNewsSources,
  createNewsSource,
  updateNewsSource,
  deleteNewsSource,
  scrapeNewsSource,
  bulkScrapeNewsSources,
} from '../controllers/medicalNews.controller';

const router = Router();

router.get('/', requireAuth, listMedicalNews);
router.get('/sources/list', requireAuth, listSources);
router.get('/stream', requireAuth, streamNews);
router.post('/refresh', requireAuth, refreshNews);

router.get('/sources', requireAuth, listNewsSources);
router.post('/sources', requireAdmin, createNewsSource);
router.post('/sources/scrape-all', requireAdmin, bulkScrapeNewsSources);
router.patch('/sources/:id', requireAdmin, updateNewsSource);
router.delete('/sources/:id', requireAdmin, deleteNewsSource);
router.post('/sources/:id/scrape', requireAuth, scrapeNewsSource);

export default router;
