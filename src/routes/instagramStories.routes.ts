import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listInstagramStories } from '../controllers/instagramStories.controller';

const router = Router();

router.use(requireAuth);

router.get('/', listInstagramStories);

export default router;
