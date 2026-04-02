import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  listAccounts,
  getAccount,
  getAccountStats,
  scrapeAccountProfile,
  scrapeAccountPosts,
  analyzeAccountContent,
  discoverAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  syncAccount,
} from '../controllers/instagramAccounts.controller';

const router = Router();

router.use(requireAuth);

router.get('/', listAccounts);
router.post('/discover', requireAdmin, discoverAccount);
router.get('/:id/stats', getAccountStats);
router.get('/:id', getAccount);
router.post('/', requireAdmin, createAccount);
router.patch('/:id', updateAccount);
router.delete('/:id', requireAdmin, deleteAccount);
router.post('/:id/scrape/profile', scrapeAccountProfile);
router.post('/:id/scrape/posts', scrapeAccountPosts);
router.post('/:id/analyze', analyzeAccountContent);
router.post('/:id/sync', syncAccount);

export default router;
