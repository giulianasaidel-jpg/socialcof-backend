import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listMedicalNews } from '../controllers/medicalNews.controller';

const router = Router();

router.get('/', requireAuth, listMedicalNews);

export default router;
