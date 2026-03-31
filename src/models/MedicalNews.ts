import { Schema, model, Document } from 'mongoose';

export interface IMedicalNews extends Document {
  title: string;
  summary: string;
  source: string;
  url: string;
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
    publishedAt: { type: Date, required: true },
    fetchedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

medicalNewsSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
medicalNewsSchema.index({ publishedAt: -1 });
medicalNewsSchema.index({ url: 1 }, { unique: true });

export const MedicalNews = model<IMedicalNews>('MedicalNews', medicalNewsSchema);
