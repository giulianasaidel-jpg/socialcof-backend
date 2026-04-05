import { Schema, model, Document, Types } from 'mongoose';

export type ImagePostLayout = 'static' | 'carousel' | 'panoramic';
export type ImagePostMode = 'light' | 'dark';
export type ImageStyle = 'realistic' | 'illustration-3d' | 'illustration-2d' | 'lo-fi' | 'brand';
export type ImagePostOverlayFont = 'inter' | 'montserrat' | 'playfair' | 'dm-sans' | 'lora' | 'oswald';
export type ImagePostOverlayPhase = 'preview' | 'final';
export type ImagePostBandStyle = 'solid' | 'gradient';

export interface IImagePostSlide {
  backgroundUrl: string;
  overlayHtml: string;
  overlayText: string;
}

export interface IImagePost extends Document {
  accountId: Types.ObjectId;
  productId: Types.ObjectId;
  createdBy: Types.ObjectId;
  layout: ImagePostLayout;
  mode: ImagePostMode;
  imageStyle: ImageStyle;
  slides: IImagePostSlide[];
  caption: string;
  bodyFontSize: number;
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
  overlayPhase: ImagePostOverlayPhase;
  imageSearchQuery: string;
  overlayFont: ImagePostOverlayFont;
  bandStyle: ImagePostBandStyle;
  bandColor: string;
  bandTextColor: string;
  overlayBodyColor: string;
  overlayStrongColor: string;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const imagePostSlideSchema = new Schema<IImagePostSlide>(
  {
    backgroundUrl: { type: String, required: true },
    overlayHtml: { type: String, required: true },
    overlayText: { type: String, required: true },
  },
  { _id: false },
);

const imagePostSchema = new Schema<IImagePost>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'InstagramAccount', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    layout: { type: String, enum: ['static', 'carousel', 'panoramic'], default: 'static' },
    mode: { type: String, enum: ['light', 'dark'], default: 'dark' },
    imageStyle: { type: String, enum: ['realistic', 'illustration-3d', 'illustration-2d', 'lo-fi', 'brand'], default: 'lo-fi' },
    slides: { type: [imagePostSlideSchema], required: true },
    caption: { type: String, default: '' },
    bodyFontSize: { type: Number, default: 22 },
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
    overlayPhase: { type: String, enum: ['preview', 'final'], default: 'preview' },
    imageSearchQuery: { type: String, default: '' },
    overlayFont: {
      type: String,
      enum: ['inter', 'montserrat', 'playfair', 'dm-sans', 'lora', 'oswald'],
      default: 'montserrat',
    },
    bandStyle: { type: String, enum: ['solid', 'gradient'], default: 'solid' },
    bandColor: { type: String, default: '#ffffff' },
    bandTextColor: { type: String, default: '#111111' },
    overlayBodyColor: { type: String, default: '' },
    overlayStrongColor: { type: String, default: '' },
    generatedAt: { type: Date },
  },
  { timestamps: true },
);

imagePostSchema.index({ accountId: 1, createdAt: -1 });

export const ImagePost = model<IImagePost>('ImagePost', imagePostSchema);
