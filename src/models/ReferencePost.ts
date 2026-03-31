import { Schema, model, Document, Types } from 'mongoose';

export interface IReferencePost extends Document {
  productId: Types.ObjectId;
  instagramUrl: string;
  title: string;
  captionSnippet: string;
  likes: number;
  comments: number;
  savedAt: Date;
  format: string;
  slides: number;
  createdAt: Date;
}

const referencePostSchema = new Schema<IReferencePost>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    instagramUrl: { type: String, required: true },
    title: { type: String, required: true },
    captionSnippet: { type: String, default: '' },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    savedAt: { type: Date, default: Date.now },
    format: { type: String, required: true },
    slides: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

referencePostSchema.index({ productId: 1 });

export const ReferencePost = model<IReferencePost>('ReferencePost', referencePostSchema);
