import { Schema, model, Document } from 'mongoose';

export interface IProduct extends Document {
  externalId: string;
  name: string;
  slug: string;
  workspace: string;
  postsThisMonth: number;
  carouselsThisMonth: number;
  avgEngagementPct: number;
  reach30d: number;
  topFormat: 'Reels' | 'Carrossel' | 'Estático';
  defaultPrompt: string;
  linkedInstagramAccountIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    externalId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    workspace: { type: String, required: true },
    postsThisMonth: { type: Number, default: 0 },
    carouselsThisMonth: { type: Number, default: 0 },
    avgEngagementPct: { type: Number, default: 0 },
    reach30d: { type: Number, default: 0 },
    topFormat: { type: String, enum: ['Reels', 'Carrossel', 'Estático'] },
    defaultPrompt: { type: String, default: '' },
    linkedInstagramAccountIds: [{ type: String }],
  },
  { timestamps: true },
);

export const Product = model<IProduct>('Product', productSchema);
