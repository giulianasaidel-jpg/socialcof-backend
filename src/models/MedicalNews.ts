import { Schema, model, Document } from 'mongoose';

export type NewsCategory = 'education' | 'government' | 'journal' | 'guidelines' | 'research' | 'global' | 'news' | 'society';
export type NewsLanguage = 'pt' | 'en';
export type NewsSpecialty = 'residencia' | 'clinica_medica' | 'cirurgia' | 'pediatria' | 'preventiva' | 'gineco' | 'outras';

export interface IMedicalNews extends Document {
  title: string;
  summary: string;
  source: string;
  url: string;
  category: NewsCategory;
  language: NewsLanguage;
  specialty: NewsSpecialty;
  author?: string;
  tags?: string[];
  wordCount?: number;
  imageUrl?: string;
  publishedAt: Date;
  fetchedAt: Date;
  expiresAt: Date;
  createdAt: Date;
}

const medicalNewsSchema = new Schema<IMedicalNews>(
  {
    title: { type: String, required: true },
    summary: { type: String, default: '' },
    source: { type: String, required: true },
    url: { type: String, required: true, unique: true },
    category: { type: String, enum: ['education', 'government', 'journal', 'guidelines', 'research', 'global', 'news', 'society'], default: 'journal' },
    specialty: { type: String, enum: ['residencia', 'clinica_medica', 'cirurgia', 'pediatria', 'preventiva', 'gineco', 'outras'], default: 'outras' },
    author: { type: String },
    tags: [{ type: String }],
    wordCount: { type: Number },
    imageUrl: { type: String },
    language: { type: String, enum: ['pt', 'en'], default: 'pt' },
    publishedAt: { type: Date, required: true },
    fetchedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'mednews' },
);

medicalNewsSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
medicalNewsSchema.index({ publishedAt: -1 });
medicalNewsSchema.index({ url: 1 }, { unique: true });
medicalNewsSchema.index({ category: 1, publishedAt: -1 });
medicalNewsSchema.index({ specialty: 1, publishedAt: -1 });
medicalNewsSchema.index({ language: 1 });

export const MedicalNews = model<IMedicalNews>('MedicalNews', medicalNewsSchema);
