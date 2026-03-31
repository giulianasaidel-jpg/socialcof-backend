import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { listProducts, getProduct, createProduct, updateProduct, deleteProduct } from '../controllers/products.controller';

const router = Router();

router.use(requireAuth);

router.get('/', listProducts);
router.get('/:id', getProduct);
router.post('/', requireAdmin, createProduct);
router.patch('/:id', updateProduct);
router.delete('/:id', requireAdmin, deleteProduct);

export default router;
