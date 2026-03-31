import mongoose from 'mongoose';
import { env } from './env';

/**
 * Connects to MongoDB using the URI from environment variables.
 */
export async function connectDatabase(): Promise<void> {
  mongoose.connection.on('connected', () => console.log('MongoDB connected'));
  mongoose.connection.on('error', (err) => console.error('MongoDB error:', err));

  await mongoose.connect(env.MONGOURI);
}
