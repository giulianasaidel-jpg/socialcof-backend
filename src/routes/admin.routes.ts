import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { listUsers, createUser, updateUser, deleteUser, getUserAccounts, setUserAccounts } from '../controllers/admin.controller';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/users', listUsers);
router.post('/users', createUser);
router.patch('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.get('/users/:id/accounts', getUserAccounts);
router.put('/users/:id/accounts', setUserAccounts);

export default router;
