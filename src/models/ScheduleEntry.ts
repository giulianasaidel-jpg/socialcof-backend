import { Schema, model, Document, Types } from 'mongoose';

export type ScheduleStatus = 'Rascunho' | 'Em revisão' | 'Agendado' | 'Publicado' | 'Cancelado';

export interface IScheduleEntry extends Document {
  accountId: Types.ObjectId;
  date: string;
  time: string;
  theme: string;
  content: string;
  format: string;
  caption: string;
  status: ScheduleStatus;
  createdAt: Date;
  updatedAt: Date;
}

const scheduleEntrySchema = new Schema<IScheduleEntry>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'InstagramAccount', required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    theme: { type: String, required: true },
    content: { type: String, required: true },
    format: { type: String, required: true },
    caption: { type: String, default: '' },
    status: {
      type: String,
      enum: ['Rascunho', 'Em revisão', 'Agendado', 'Publicado', 'Cancelado'],
      required: true,
    },
  },
  { timestamps: true },
);

scheduleEntrySchema.index({ accountId: 1, date: 1 }, { unique: true });

export const ScheduleEntry = model<IScheduleEntry>('ScheduleEntry', scheduleEntrySchema);
