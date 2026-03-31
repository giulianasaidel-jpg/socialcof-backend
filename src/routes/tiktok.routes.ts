import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listTrends } from '../controllers/tiktok.controller';

const router = Router();

router.get('/trends', requireAuth, listTrends);

export default router;
