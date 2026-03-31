import { Request, Response } from 'express';
import { Product } from '../models/Product';

/**
 * Maps a Product document to the API response shape.
 */
function toResponse(product: InstanceType<typeof Product>) {
  return {
    id: product.externalId,
    name: product.name,
    slug: product.slug,
    postsThisMonth: product.postsThisMonth,
    carouselsThisMonth: product.carouselsThisMonth,
    avgEngagementPct: product.avgEngagementPct,
    reach30d: product.reach30d,
    topFormat: product.topFormat,
    defaultPrompt: product.defaultPrompt,
    linkedInstagramAccountIds: product.linkedInstagramAccountIds,
  };
}

/**
 * GET /products — Lists products filtered by workspace.
 */
export async function listProducts(req: Request, res: Response): Promise<void> {
  const { workspace } = req.query;
  const filter: Record<string, unknown> = {};
  if (workspace) filter.workspace = workspace;

  const products = await Product.find(filter);
  res.json(products.map(toResponse));
}

/**
 * GET /products/:id — Returns a single product by externalId.
 */
export async function getProduct(req: Request, res: Response): Promise<void> {
  const product = await Product.findOne({ externalId: req.params.id });
  if (!product) {
    res.status(404).json({ message: 'Product not found' });
    return;
  }
  res.json(toResponse(product));
}

/**
 * POST /products — Creates a new product (admin only).
 */
export async function createProduct(req: Request, res: Response): Promise<void> {
  const product = await Product.create(req.body);
  res.status(201).json(toResponse(product));
}

/**
 * PATCH /products/:id — Updates a product by externalId.
 */
export async function updateProduct(req: Request, res: Response): Promise<void> {
  const product = await Product.findOneAndUpdate(
    { externalId: req.params.id },
    { $set: req.body },
    { new: true },
  );
  if (!product) {
    res.status(404).json({ message: 'Product not found' });
    return;
  }
  res.json(toResponse(product));
}

/**
 * DELETE /products/:id — Removes a product by externalId (admin only).
 */
export async function deleteProduct(req: Request, res: Response): Promise<void> {
  const product = await Product.findOneAndDelete({ externalId: req.params.id });
  if (!product) {
    res.status(404).json({ message: 'Product not found' });
    return;
  }
  res.status(204).send();
}
