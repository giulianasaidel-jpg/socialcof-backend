import { Schema, model, Document, Types } from 'mongoose';

export interface ICompetitor extends Document {
  productId: Types.ObjectId;
  handle: string;
  displayName: string;
  profileUrl: string;
  followers: number;
  avgLikesPerPost: number;
  engagementRatePct: number;
  publishedPostsCount: number;
  insightsToBorrow: string[];
  isManual: boolean;
  workspace: string;
  createdAt: Date;
  updatedAt: Date;
}

const competitorSchema = new Schema<ICompetitor>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    handle: { type: String, required: true },
    displayName: { type: String, required: true },
    profileUrl: { type: String, required: true },
    followers: { type: Number, default: 0 },
    avgLikesPerPost: { type: Number, default: 0 },
    engagementRatePct: { type: Number, default: 0 },
    publishedPostsCount: { type: Number, default: 0 },
    insightsToBorrow: [{ type: String }],
    isManual: { type: Boolean, default: false },
    workspace: { type: String, required: true },
  },
  { timestamps: true },
);

competitorSchema.index({ productId: 1 });
competitorSchema.index({ workspace: 1 });

export const Competitor = model<ICompetitor>('Competitor', competitorSchema);
