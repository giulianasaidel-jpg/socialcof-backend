import { Schema, model, Document } from 'mongoose';
import { NewsCategory, NewsLanguage, NewsSpecialty } from './MedicalNews';

export type NewsMethod = 'api' | 'rss' | 'html';
export type NewsPriority = 'P1' | 'P2' | 'P3';

export interface IMedNewsSource extends Document {
  name: string;
  url: string;
  newsPageUrl?: string;
  category: NewsCategory;
  language: NewsLanguage;
  specialty: NewsSpecialty;
  priority: NewsPriority;
  method: NewsMethod;
  country: string;
  isActive: boolean;
  lastScrapedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const medNewsSourceSchema = new Schema<IMedNewsSource>(
  {
    name: { type: String, required: true },
    url: { type: String, required: true, unique: true },
    newsPageUrl: { type: String },
    category: {
      type: String,
      enum: ['education', 'government', 'journal', 'guidelines', 'research', 'global', 'news', 'society'],
      default: 'global',
    },
    specialty: {
      type: String,
      enum: ['residencia', 'clinica_medica', 'cirurgia', 'pediatria', 'preventiva', 'gineco', 'outras'],
      default: 'outras',
    },
    language: { type: String, enum: ['pt', 'en'], default: 'en' },
    priority: { type: String, enum: ['P1', 'P2', 'P3'], default: 'P2' },
    method: { type: String, enum: ['api', 'rss', 'html'], required: true },
    country: { type: String, default: 'Global' },
    isActive: { type: Boolean, default: true },
    lastScrapedAt: { type: Date },
  },
  { timestamps: true },
);

medNewsSourceSchema.index({ method: 1, isActive: 1 });
medNewsSourceSchema.index({ priority: 1, isActive: 1 });

export const MedNewsSource = model<IMedNewsSource>('MedNewsSource', medNewsSourceSchema);
