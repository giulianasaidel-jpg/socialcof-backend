import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  listImagePosts,
  getImagePost,
  generateImagePostEndpoint,
  updateImagePost,
  deleteImagePost,
  exportImageSlide,
  exportImagePost,
  previewImageSlide,
  saveImageSlideHtml,
  finalizeImagePostOverlay,
  suggestSlideAlternateBackgrounds,
  uploadSlideBackground,
} from '../controllers/imagePost.controller';
import { uploadSingle } from '../middleware/upload';

const router = Router();

router.get('/:id/slides/:index/preview', previewImageSlide);

router.use(requireAuth);

router.get('/', listImagePosts);
router.post('/generate', generateImagePostEndpoint);
router.post('/:id/finalize-overlay', finalizeImagePostOverlay);
router.post('/:id/slides/:index/alternate-backgrounds', suggestSlideAlternateBackgrounds);
router.post('/:id/slides/:index/upload-background', uploadSingle, uploadSlideBackground);
router.get('/:id/export', exportImagePost);
router.get('/:id/slides/:index/export', exportImageSlide);
router.patch('/:id/slides/:index/html', saveImageSlideHtml);
router.get('/:id', getImagePost);
router.patch('/:id', updateImagePost);
router.delete('/:id', deleteImagePost);

export default router;
