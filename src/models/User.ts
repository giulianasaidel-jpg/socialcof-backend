import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  role: 'admin' | 'editor' | 'viewer';
  allowedInstagramAccountIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'editor', 'viewer'], required: true },
    allowedInstagramAccountIds: [{ type: String }],
  },
  { timestamps: true },
);

export const User = model<IUser>('User', userSchema);
