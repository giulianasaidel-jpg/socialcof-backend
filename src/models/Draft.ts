import { Schema, model, Document, Types } from 'mongoose';

export type DraftStatus = 'Rascunho' | 'Em revisão' | 'Aprovado';

export interface IDraft extends Document {
  productId: Types.ObjectId;
  accountId: Types.ObjectId;
  title: string;
  type: 'Post' | 'Carrossel';
  basedOnUrl?: string;
  caption: string;
  status: DraftStatus;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const draftSchema = new Schema<IDraft>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'InstagramAccount', required: true },
    title: { type: String, required: true },
    type: { type: String, enum: ['Post', 'Carrossel'], required: true },
    basedOnUrl: { type: String },
    caption: { type: String, default: '' },
    status: { type: String, enum: ['Rascunho', 'Em revisão', 'Aprovado'], default: 'Rascunho' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

draftSchema.index({ productId: 1 });
draftSchema.index({ status: 1 });
draftSchema.index({ accountId: 1 });

export const Draft = model<IDraft>('Draft', draftSchema);
