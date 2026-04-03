import { Schema, model, Document, Types } from 'mongoose';

export interface ITikTokPost extends Document {
  accountId: Types.ObjectId;
  tiktokPostId: string;
  title: string;
  postedAt?: Date;
  videoUrl?: string;
  thumbnailUrl?: string;
  transcript?: string;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  postUrl: string;
  hashtags: string[];
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const tiktokPostSchema = new Schema<ITikTokPost>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'TikTokAccount', required: true },
    tiktokPostId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    postedAt: { type: Date },
    videoUrl: { type: String },
    thumbnailUrl: { type: String },
    transcript: { type: String },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    postUrl: { type: String, required: true },
    hashtags: { type: [String], default: [] },
    syncedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

tiktokPostSchema.index({ accountId: 1, postedAt: -1 });

export const TikTokPost = model<ITikTokPost>('TikTokPost', tiktokPostSchema);
