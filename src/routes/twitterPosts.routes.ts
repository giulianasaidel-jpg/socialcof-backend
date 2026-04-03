import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  listTwitterPosts,
  getTwitterPost,
  generateTwitterPost,
  updateTwitterPost,
  deleteTwitterPost,
  exportTwitterPost,
  exportTwitterSlide,
} from '../controllers/twitterPosts.controller';

const router = Router();

router.use(requireAuth);

router.get('/', listTwitterPosts);
router.post('/generate', generateTwitterPost);
router.get('/:id/export', exportTwitterPost);
router.get('/:id/slides/:index/export', exportTwitterSlide);
router.get('/:id', getTwitterPost);
router.patch('/:id', updateTwitterPost);
router.delete('/:id', deleteTwitterPost);

export default router;
