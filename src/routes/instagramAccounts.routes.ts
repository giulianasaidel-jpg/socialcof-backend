import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  listAccounts,
  getAccount,
  getAccountStats,
  getRelatedInterestFeed,
  getRelatedInstagramInterestFeed,
  getRelatedTikTokInterestFeed,
  getRelatedNewsInterestFeed,
  scrapeAccountProfile,
  scrapeAccountPosts,
  scrapeAccountReels,
  scrapeAccountStories,
  analyzeAccountContent,
  discoverAccount,
  bulkDiscoverAccounts,
  bulkScrapeAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  syncAccount,
  uploadProfilePic,
  updateBrandColors,
  uploadReferenceImages,
  deleteReferenceImage,
  uploadBrandPostImages,
  deleteBrandPostImage,
} from '../controllers/instagramAccounts.controller';
import { uploadSingle, uploadMultiple } from '../middleware/upload';

const router = Router();

router.use(requireAuth);

router.get('/', listAccounts);
router.post('/discover', requireAdmin, discoverAccount);
router.post('/bulk-discover', requireAdmin, bulkDiscoverAccounts);
router.post('/bulk-scrape', requireAdmin, bulkScrapeAccounts);
router.get('/:id/stats', getAccountStats);
router.get('/:id/related-feed/instagram', getRelatedInstagramInterestFeed);
router.get('/:id/related-feed/tiktok', getRelatedTikTokInterestFeed);
router.get('/:id/related-feed/news', getRelatedNewsInterestFeed);
router.get('/:id/related-feed', getRelatedInterestFeed);
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
router.post('/:id/branding/post-images', uploadMultiple, uploadBrandPostImages);
router.delete('/:id/branding/post-images', deleteBrandPostImage);

export default router;
