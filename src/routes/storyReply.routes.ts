import { Router } from 'express';
import { requireAuth, requireAuthOrToken } from '../middleware/auth';
import { uploadSingle } from '../middleware/upload';
import {
  listStoryReplies,
  getStoryReply,
  generateStoryReplyPost,
  updateStoryReply,
  deleteStoryReply,
  exportStoryQuestion,
  exportStoryAnswer,
  previewStoryQuestion,
  previewStoryAnswer,
  saveStoryHtml,
  suggestStoryAlternateBackgrounds,
  uploadStoryBackground,
} from '../controllers/storyReply.controller';

const router = Router();

router.get('/:id/preview/question', previewStoryQuestion);
router.get('/:id/preview/answer', previewStoryAnswer);

router.use(requireAuth);

router.get('/', listStoryReplies);
router.post('/generate', generateStoryReplyPost);
router.get('/:id', getStoryReply);
router.patch('/:id', updateStoryReply);
router.patch('/:id/html', saveStoryHtml);
router.delete('/:id', deleteStoryReply);
router.get('/:id/export/question', exportStoryQuestion);
router.get('/:id/export/answer', exportStoryAnswer);
router.post('/:id/alternate-backgrounds', suggestStoryAlternateBackgrounds);
router.post('/:id/upload-background', uploadSingle, uploadStoryBackground);

export default router;
