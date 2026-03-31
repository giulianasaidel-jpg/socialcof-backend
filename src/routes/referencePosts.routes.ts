import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listReferencePosts, createReferencePost, deleteReferencePost } from '../controllers/referencePosts.controller';

const router = Router();

router.use(requireAuth);

router.get('/', listReferencePosts);
router.post('/', createReferencePost);
router.delete('/:id', deleteReferencePost);

export default router;
