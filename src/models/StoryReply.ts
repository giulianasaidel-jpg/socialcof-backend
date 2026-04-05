import { Schema, model, Document, Types } from 'mongoose';

export type StoryReplyMode = 'light' | 'dark';
export type StoryFont = 'classic' | 'modern' | 'strong' | 'typewriter' | 'editor' | 'poster' | 'literature';

export interface IStoryReply extends Document {
  accountId: Types.ObjectId;
  productId: Types.ObjectId;
  createdBy: Types.ObjectId;
  mode: StoryReplyMode;
  font: StoryFont;
  textColor: string;
  highlightColor: string;
  stickerFontSize: number;
  answerFontSize: number;
  question: string;
  answer: string;
  questionHtml: string;
  answerHtml: string;
  caption: string;
  backgroundUrl: string;
  backgroundOverlayColor: string;
  imageSearchQuery: string;
  profileName: string;
  profileHandle: string;
  profileImageUrl: string;
  brandColors: string[];
  sourceTranscript: string;
  sourceCaption: string;
  sourcePostId?: Types.ObjectId;
  sourceNewsId?: Types.ObjectId;
  sourceTikTokPostId?: Types.ObjectId;
  sourceInstagramStoryId?: Types.ObjectId;
  status: 'Rascunho' | 'Aprovado' | 'Publicado';
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const STORY_FONTS = ['classic', 'modern', 'strong', 'typewriter', 'editor', 'poster', 'literature'];

const storyReplySchema = new Schema<IStoryReply>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'InstagramAccount', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mode: { type: String, enum: ['light', 'dark'], default: 'dark' },
    font: { type: String, enum: STORY_FONTS, default: 'classic' },
    textColor: { type: String, default: '#ffffff' },
    highlightColor: { type: String, default: '#FF6B2B' },
    stickerFontSize: { type: Number, default: 42 },
    answerFontSize: { type: Number, default: 44 },
    question: { type: String, required: true },
    answer: { type: String, required: true },
    questionHtml: { type: String, required: true },
    answerHtml: { type: String, required: true },
    caption: { type: String, default: '' },
    backgroundUrl: { type: String, default: '' },
    backgroundOverlayColor: { type: String, default: 'rgba(0,0,0,0.65)' },
    imageSearchQuery: { type: String, default: '' },
    profileName: { type: String, default: '' },
    profileHandle: { type: String, default: '' },
    profileImageUrl: { type: String, default: '' },
    brandColors: { type: [String], default: [] },
    sourceTranscript: { type: String, default: '' },
    sourceCaption: { type: String, default: '' },
    sourcePostId: { type: Schema.Types.ObjectId, ref: 'Post', default: null },
    sourceNewsId: { type: Schema.Types.ObjectId, ref: 'MedicalNews', default: null },
    sourceTikTokPostId: { type: Schema.Types.ObjectId, ref: 'TikTokPost', default: null },
    sourceInstagramStoryId: { type: Schema.Types.ObjectId, ref: 'InstagramStory', default: null },
    status: { type: String, enum: ['Rascunho', 'Aprovado', 'Publicado'], default: 'Rascunho' },
    generatedAt: { type: Date },
  },
  { timestamps: true },
);

storyReplySchema.index({ accountId: 1, createdAt: -1 });

export const StoryReply = model<IStoryReply>('StoryReply', storyReplySchema);
