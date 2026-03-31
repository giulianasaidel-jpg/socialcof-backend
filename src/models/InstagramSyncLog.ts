import { Schema, model, Document, Types } from 'mongoose';

export interface IInstagramSyncLog extends Document {
  accountId: Types.ObjectId;
  at: Date;
  level: 'ok' | 'aviso' | 'erro';
  message: string;
}

const instagramSyncLogSchema = new Schema<IInstagramSyncLog>({
  accountId: { type: Schema.Types.ObjectId, ref: 'InstagramAccount', required: true, index: true },
  at: { type: Date, required: true, default: Date.now },
  level: { type: String, enum: ['ok', 'aviso', 'erro'], required: true },
  message: { type: String, required: true },
});

instagramSyncLogSchema.index({ accountId: 1, at: -1 });

export const InstagramSyncLog = model<IInstagramSyncLog>('InstagramSyncLog', instagramSyncLogSchema);
