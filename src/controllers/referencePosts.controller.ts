import { Request, Response } from 'express';
import { ReferencePost } from '../models/ReferencePost';
import { Product } from '../models/Product';

/**
 * Maps a ReferencePost document to the API response shape.
 */
function toResponse(post: InstanceType<typeof ReferencePost>, productExternalId: string) {
  return {
    id: post._id.toString(),
    productId: productExternalId,
    instagramUrl: post.instagramUrl,
    title: post.title,
    captionSnippet: post.captionSnippet,
    likes: post.likes,
    comments: post.comments,
    savedAt: post.savedAt,
    format: post.format,
    slides: post.slides,
  };
}

/**
 * GET /reference-posts — Lists reference posts filtered by productId (externalId).
 */
export async function listReferencePosts(req: Request, res: Response): Promise<void> {
  const { productId } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};

  if (productId) {
    const product = await Product.findOne({ externalId: productId });
    if (product) filter.productId = product._id;
  }

  const posts = await ReferencePost.find(filter).populate<{ productId: InstanceType<typeof Product> }>('productId');
  res.json(
    posts.map((p) => {
      const product = p.productId as unknown as InstanceType<typeof Product>;
      return toResponse(p as unknown as InstanceType<typeof ReferencePost>, product?.externalId ?? '');
    }),
  );
}

/**
 * POST /reference-posts — Saves a new reference post.
 */
export async function createReferencePost(req: Request, res: Response): Promise<void> {
  const { productId, ...rest } = req.body;

  const product = await Product.findOne({ externalId: productId });
  if (!product) {
    res.status(400).json({ message: 'Product not found' });
    return;
  }

  const post = await ReferencePost.create({ ...rest, productId: product._id });
  res.status(201).json(toResponse(post, productId));
}

/**
 * DELETE /reference-posts/:id — Removes a reference post.
 */
export async function deleteReferencePost(req: Request, res: Response): Promise<void> {
  const post = await ReferencePost.findByIdAndDelete(req.params.id);
  if (!post) {
    res.status(404).json({ message: 'Reference post not found' });
    return;
  }
  res.status(204).send();
}
