import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  listTikTokAccounts,
  listTikTokPosts,
  getTikTokAccount,
  discoverTikTokAccount,
  deleteTikTokAccount,
  scrapeTikTokAccountPosts,
} from '../controllers/tiktokAccounts.controller';

const router = Router();

router.use(requireAuth);

router.get('/', listTikTokAccounts);
router.get('/posts', listTikTokPosts);
router.post('/discover', requireAdmin, discoverTikTokAccount);
router.get('/:id', getTikTokAccount);
router.delete('/:id', requireAdmin, deleteTikTokAccount);
router.post('/:id/scrape/posts', scrapeTikTokAccountPosts);

export default router;
