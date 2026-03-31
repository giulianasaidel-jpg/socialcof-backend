import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listCompetitors, createCompetitor, updateCompetitor, deleteCompetitor } from '../controllers/competitors.controller';

const router = Router();

router.use(requireAuth);

router.get('/', listCompetitors);
router.post('/', createCompetitor);
router.patch('/:id', updateCompetitor);
router.delete('/:id', deleteCompetitor);

export default router;
