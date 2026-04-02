import { Schema, model, Document, Types } from 'mongoose';

export type DraftStatus = 'Rascunho' | 'Em revisão' | 'Aprovado';

export type TemplateType =
  | 'twitter-quote'
  | 'carousel-tips'
  | 'carousel-numbered'
  | 'carousel-before-after'
  | 'carousel-story'
  | 'static-announcement';

export type SlideType = 'cover' | 'content' | 'cta' | 'quote';
export type ColorScheme = 'primary' | 'secondary' | 'dark' | 'light' | 'accent';

export interface ISlide {
  index: number;
  type: SlideType;
  layout: TemplateType | 'carousel-cover' | 'carousel-cta';
  colorScheme: ColorScheme;
  title: string;
  subtitle?: string;
  body?: string;
  number?: string;
  beforeTitle?: string;
  beforeBody?: string;
  afterTitle?: string;
  afterBody?: string;
}

export interface IDraft extends Document {
  productId: Types.ObjectId;
  accountId: Types.ObjectId;
  title: string;
  type: 'Post' | 'Carrossel';
  templateType?: TemplateType;
  basedOnUrl?: string;
  caption: string;
  hashtags: string[];
  slides: ISlide[];
  status: DraftStatus;
  createdBy: Types.ObjectId;
  generatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const slideSchema = new Schema<ISlide>(
  {
    index: { type: Number, required: true },
    type: { type: String, enum: ['cover', 'content', 'cta', 'quote'], required: true },
    layout: { type: String, required: true },
    colorScheme: { type: String, enum: ['primary', 'secondary', 'dark', 'light', 'accent'], required: true },
    title: { type: String, required: true },
    subtitle: { type: String },
    body: { type: String },
    number: { type: String },
    beforeTitle: { type: String },
    beforeBody: { type: String },
    afterTitle: { type: String },
    afterBody: { type: String },
  },
  { _id: false },
);

const draftSchema = new Schema<IDraft>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'InstagramAccount', required: true },
    title: { type: String, required: true },
    type: { type: String, enum: ['Post', 'Carrossel'], required: true },
    templateType: { type: String },
    basedOnUrl: { type: String },
    caption: { type: String, default: '' },
    hashtags: { type: [String], default: [] },
    slides: { type: [slideSchema], default: [] },
    status: { type: String, enum: ['Rascunho', 'Em revisão', 'Aprovado'], default: 'Rascunho' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    generatedAt: { type: Date },
  },
  { timestamps: true },
);

draftSchema.index({ productId: 1 });
draftSchema.index({ status: 1 });
draftSchema.index({ accountId: 1 });

export const Draft = model<IDraft>('Draft', draftSchema);
