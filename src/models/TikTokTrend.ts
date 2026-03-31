import { Schema, model, Document } from 'mongoose';

export interface ITikTokTrend extends Document {
  rank: number;
  title: string;
  hashtag: string;
  volumeLabel: string;
  country: string;
  category: string;
  fetchedAt: Date;
  expiresAt: Date;
  createdAt: Date;
}

const tiktokTrendSchema = new Schema<ITikTokTrend>(
  {
    rank: { type: Number, required: true },
    title: { type: String, required: true },
    hashtag: { type: String, required: true },
    volumeLabel: { type: String, default: '' },
    country: { type: String, default: 'BR' },
    category: { type: String, default: '' },
    fetchedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

tiktokTrendSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
tiktokTrendSchema.index({ country: 1, rank: 1 });

export const TikTokTrend = model<ITikTokTrend>('TikTokTrend', tiktokTrendSchema);
