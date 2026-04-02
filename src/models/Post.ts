import { Schema, model, Document, Types } from 'mongoose';

export interface IPost extends Document {
  accountId: Types.ObjectId;
  instagramPostId?: string;
  title: string;
  postedAt: Date;
  format: 'Reels' | 'Carrossel' | 'Estático';
  likes: number;
  comments: number;
  saves: number;
  reposts: number;
  forwards: number;
  reach: number;
  impressions: number;
  postUrl?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  transcript?: string;
  carouselImages: string[];
  syncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const postSchema = new Schema<IPost>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'InstagramAccount', required: true },
    instagramPostId: { type: String },
    title: { type: String, required: true },
    postedAt: { type: Date, required: true },
    format: { type: String, enum: ['Reels', 'Carrossel', 'Estático'], required: true },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    saves: { type: Number, default: 0 },
    reposts: { type: Number, default: 0 },
    forwards: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    postUrl: { type: String },
    thumbnailUrl: { type: String },
    videoUrl: { type: String },
    transcript: { type: String },
    carouselImages: { type: [String], default: [] },
    syncedAt: { type: Date },
  },
  { timestamps: true },
);

postSchema.index({ accountId: 1, postedAt: -1 });
postSchema.index({ format: 1 });

export const Post = model<IPost>('Post', postSchema);
