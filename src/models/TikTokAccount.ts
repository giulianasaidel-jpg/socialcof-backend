import { Schema, model, Document } from 'mongoose';

export interface ITikTokAccount extends Document {
  externalId: string;
  handle: string;
  displayName: string;
  profileUrl: string;
  followers: number;
  following: number;
  likesCount: number;
  workspace: string;
  isVerified: boolean;
  profilePicUrl?: string;
  lastSyncAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const tiktokAccountSchema = new Schema<ITikTokAccount>(
  {
    externalId: { type: String, required: true, unique: true },
    handle: { type: String, required: true },
    displayName: { type: String, default: '' },
    profileUrl: { type: String, required: true },
    followers: { type: Number, default: 0 },
    following: { type: Number, default: 0 },
    likesCount: { type: Number, default: 0 },
    workspace: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
    profilePicUrl: { type: String },
    lastSyncAt: { type: Date },
  },
  { timestamps: true },
);

tiktokAccountSchema.index({ workspace: 1 });

export const TikTokAccount = model<ITikTokAccount>('TikTokAccount', tiktokAccountSchema);
