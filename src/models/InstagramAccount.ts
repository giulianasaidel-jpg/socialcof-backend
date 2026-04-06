import { Schema, model, Document, Types } from 'mongoose';

export interface IInstagramAccount extends Document {
  externalId: string;
  handle: string;
  displayName: string;
  profileUrl: string;
  followers: number;
  workspace: string;
  status: 'conectado' | 'atencao' | 'erro' | 'desconectado';
  oauthAccessToken?: string;
  oauthRefreshToken?: string;
  tokenExpiresAt?: Date;
  scopes: string[];
  ingestEnabled: boolean;
  lastSyncAt?: Date;
  profilePicS3Url?: string;
  brandColors: string[];
  referenceImages: string[];
  brandPostImages: string[];
  relatedInstagramAccountIds: Types.ObjectId[];
  relatedTikTokAccountIds: Types.ObjectId[];
  relatedMedNewsSourceIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const instagramAccountSchema = new Schema<IInstagramAccount>(
  {
    externalId: { type: String, required: true, unique: true },
    handle: { type: String, required: true },
    displayName: { type: String, required: true },
    profileUrl: { type: String, required: true },
    followers: { type: Number, default: 0 },
    workspace: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['conectado', 'atencao', 'erro', 'desconectado'],
      default: 'desconectado',
    },
    oauthAccessToken: { type: String },
    oauthRefreshToken: { type: String },
    tokenExpiresAt: { type: Date },
    scopes: [{ type: String }],
    ingestEnabled: { type: Boolean, default: true },
    lastSyncAt: { type: Date },
    profilePicS3Url: { type: String },
    brandColors: { type: [String], default: [] },
    referenceImages: { type: [String], default: [] },
    brandPostImages: { type: [String], default: [] },
    relatedInstagramAccountIds: { type: [Schema.Types.ObjectId], ref: 'InstagramAccount', default: [] },
    relatedTikTokAccountIds: { type: [Schema.Types.ObjectId], ref: 'TikTokAccount', default: [] },
    relatedMedNewsSourceIds: { type: [Schema.Types.ObjectId], ref: 'MedNewsSource', default: [] },
  },
  { timestamps: true },
);

export const InstagramAccount = model<IInstagramAccount>('InstagramAccount', instagramAccountSchema);
