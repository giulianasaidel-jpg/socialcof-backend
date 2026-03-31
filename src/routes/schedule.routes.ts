import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listSchedule, upsertScheduleEntry, deleteScheduleEntry } from '../controllers/schedule.controller';

const router = Router();

router.use(requireAuth);

router.get('/', listSchedule);
router.put('/:accountId/:date', upsertScheduleEntry);
router.delete('/:accountId/:date', deleteScheduleEntry);

export default router;
