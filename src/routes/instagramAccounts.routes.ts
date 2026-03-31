import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  syncAccount,
} from '../controllers/instagramAccounts.controller';

const router = Router();

router.use(requireAuth);

router.get('/', listAccounts);
router.get('/:id', getAccount);
router.post('/', requireAdmin, createAccount);
router.patch('/:id', updateAccount);
router.delete('/:id', requireAdmin, deleteAccount);
router.post('/:id/sync', syncAccount);

export default router;
