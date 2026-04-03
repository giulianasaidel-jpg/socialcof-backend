import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listMedicalNews, listSources, refreshNews, streamNews } from '../controllers/medicalNews.controller';

const router = Router();

router.get('/', requireAuth, listMedicalNews);
router.get('/sources', requireAuth, listSources);
router.get('/stream', requireAuth, streamNews);
router.post('/refresh', requireAuth, refreshNews);

export default router;
