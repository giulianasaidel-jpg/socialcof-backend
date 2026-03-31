import { CorsOptions } from 'cors';
import { env } from './env';

/**
 * Builds the CORS configuration from CORS_ORIGIN environment variable.
 * Supports comma-separated list of allowed origins.
 */
export function buildCorsOptions(): CorsOptions {
  const allowedOrigins = env.FRONTEND_URL.split(',').map((o) => o.trim());

  return {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
  };
}
