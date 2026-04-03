import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  listAccounts,
  getAccount,
  getAccountStats,
  scrapeAccountProfile,
  scrapeAccountPosts,
  scrapeAccountReels,
  scrapeAccountStories,
  analyzeAccountContent,
  discoverAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  syncAccount,
  uploadProfilePic,
  updateBrandColors,
  uploadReferenceImages,
  deleteReferenceImage,
} from '../controllers/instagramAccounts.controller';
import { uploadSingle, uploadMultiple } from '../middleware/upload';

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
router.post('/:id/scrape/reels', scrapeAccountReels);
router.post('/:id/scrape/stories', scrapeAccountStories);
router.post('/:id/analyze', analyzeAccountContent);
router.post('/:id/sync', syncAccount);
router.post('/:id/branding/profile-pic', uploadSingle, uploadProfilePic);
router.patch('/:id/branding/colors', updateBrandColors);
router.post('/:id/branding/reference-images', uploadMultiple, uploadReferenceImages);
router.delete('/:id/branding/reference-images', deleteReferenceImage);

export default router;
