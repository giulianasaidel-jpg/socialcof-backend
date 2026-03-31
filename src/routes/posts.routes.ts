import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listPosts, getPost, createPost, updatePost, deletePost } from '../controllers/posts.controller';

const router = Router();

router.use(requireAuth);

router.get('/', listPosts);
router.get('/:id', getPost);
router.post('/', createPost);
router.patch('/:id', updatePost);
router.delete('/:id', deletePost);

export default router;
