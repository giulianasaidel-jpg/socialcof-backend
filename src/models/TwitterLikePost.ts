import { Schema, model, Document, Types } from 'mongoose';

export type DisplayMode = 'light' | 'dark';

export interface ITwitterLikePost extends Document {
  accountId: Types.ObjectId;
  productId: Types.ObjectId;
  createdBy: Types.ObjectId;
  mode: DisplayMode;
  profileName: string;
  profileHandle: string;
  profileImageUrl: string;
  bodyFontSize: number;
  slides: string[];
  slideHtmls: string[];
  caption: string;
  sourceTranscript: string;
  sourceCaption: string;
  sourceNewsId?: Types.ObjectId;
  sourceTikTokPostId?: Types.ObjectId;
  sourceInstagramStoryId?: Types.ObjectId;
  status: 'Rascunho' | 'Aprovado' | 'Publicado';
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const twitterLikePostSchema = new Schema<ITwitterLikePost>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'InstagramAccount', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mode: { type: String, enum: ['light', 'dark'], required: true, default: 'dark' },
    bodyFontSize: { type: Number, default: 20 },
    profileName: { type: String, default: '' },
    profileHandle: { type: String, default: '' },
    profileImageUrl: { type: String, default: '' },
    slides: { type: [String], required: true },
    slideHtmls: { type: [String], required: true },
    caption: { type: String, default: '' },
    sourceTranscript: { type: String, default: '' },
    sourceCaption: { type: String, default: '' },
    sourceNewsId: { type: Schema.Types.ObjectId, ref: 'MedicalNews', default: null },
    sourceTikTokPostId: { type: Schema.Types.ObjectId, ref: 'TikTokPost', default: null },
    sourceInstagramStoryId: { type: Schema.Types.ObjectId, ref: 'InstagramStory', default: null },
    status: { type: String, enum: ['Rascunho', 'Aprovado', 'Publicado'], default: 'Rascunho' },
    generatedAt: { type: Date },
  },
  { timestamps: true },
);

twitterLikePostSchema.index({ accountId: 1, createdAt: -1 });

export const TwitterLikePost = model<ITwitterLikePost>('TwitterLikePost', twitterLikePostSchema);
