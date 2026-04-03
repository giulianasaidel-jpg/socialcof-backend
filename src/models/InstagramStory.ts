import { Schema, model, Document, Types } from 'mongoose';

export interface IInstagramStory extends Document {
  accountId: Types.ObjectId;
  storyId: string;
  handle: string;
  mediaType: 'image' | 'video';
  thumbnailUrl?: string;
  videoUrl?: string;
  transcript?: string;
  postedAt?: Date;
  syncedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const instagramStorySchema = new Schema<IInstagramStory>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'InstagramAccount', required: true },
    storyId: { type: String, required: true, unique: true },
    handle: { type: String, required: true },
    mediaType: { type: String, enum: ['image', 'video'], required: true },
    thumbnailUrl: { type: String },
    videoUrl: { type: String },
    transcript: { type: String },
    postedAt: { type: Date },
    syncedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

instagramStorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
instagramStorySchema.index({ accountId: 1, syncedAt: -1 });

export const InstagramStory = model<IInstagramStory>('InstagramStory', instagramStorySchema);
