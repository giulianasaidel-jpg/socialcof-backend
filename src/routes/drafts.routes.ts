import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listDrafts, getDraft, createDraft, updateDraft, deleteDraft } from '../controllers/drafts.controller';

const router = Router();

router.use(requireAuth);

router.get('/', listDrafts);
router.get('/:id', getDraft);
router.post('/', createDraft);
router.patch('/:id', updateDraft);
router.delete('/:id', deleteDraft);

export default router;
