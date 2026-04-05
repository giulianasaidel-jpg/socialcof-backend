import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { env } from '../config/env';

export function formatUploadError(err: unknown): string {
  if (err instanceof Error) {
    const code = 'code' in err && typeof (err as NodeJS.ErrnoException).code === 'string'
      ? ` (${(err as NodeJS.ErrnoException).code})`
      : '';
    const base = err.message?.trim() || err.name || 'Error';
    return `${base}${code}`;
  }
  if (err && typeof err === 'object' && 'name' in err) {
    return String((err as { name: string }).name);
  }
  return typeof err === 'string' ? err : JSON.stringify(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let s3: S3Client | null = null;

function getClient(): S3Client {
  if (!s3) {
    s3 = new S3Client({ region: env.AWS_REGION });
  }
  return s3;
}

const DOWNLOAD_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
  'Referer': 'https://www.instagram.com/',
};

/**
 * Downloads a file from a URL and returns it as a Buffer, following up to 5 redirects.
 */
function downloadBuffer(url: string, redirectsLeft = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers: DOWNLOAD_HEADERS }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        if (redirectsLeft === 0) return reject(new Error('Too many redirects'));
        return resolve(downloadBuffer(res.headers.location, redirectsLeft - 1));
      }
      if (res.statusCode && res.statusCode >= 400) {
        return reject(new Error(`HTTP ${res.statusCode} fetching image`));
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Download timeout')); });
  });
}

/**
 * Checks whether an object already exists in S3 by key.
 */
async function exists(bucket: string, key: string): Promise<boolean> {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export interface UploadImageFromUrlOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

/**
 * Downloads an image from a URL and uploads it to S3.
 * Retries download + Put on transient failures (default 4 attempts, backoff).
 * Returns null if bucket unset or all attempts fail (does not throw).
 */
export async function uploadImageFromUrl(
  imageUrl: string,
  key: string,
  options?: UploadImageFromUrlOptions,
): Promise<string | null> {
  if (!env.AWS_S3_BUCKET) return null;

  const maxAttempts = Math.max(1, options?.maxAttempts ?? 4);
  const baseDelayMs = options?.baseDelayMs ?? 2500;

  const bucket = env.AWS_S3_BUCKET;
  const publicUrl = `https://${bucket}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;

  if (await exists(bucket, key)) return publicUrl;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const buffer = await downloadBuffer(imageUrl);
      if (buffer.length < 100) {
        throw new Error(`Image buffer too small (${buffer.length} bytes)`);
      }
      await getClient().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: 'image/jpeg',
        }),
      );
      return publicUrl;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt);
      }
    }
  }

  console.warn(`[s3] uploadImageFromUrl exhausted for ${key}:`, formatUploadError(lastErr));
  return null;
}

/**
 * Uploads a video file from disk to S3 and returns the permanent URL.
 * Returns null if AWS_S3_BUCKET is not configured.
 * Skips the upload if the key already exists.
 */
export async function uploadVideoFromFile(filePath: string, key: string): Promise<string | null> {
  if (!env.AWS_S3_BUCKET) return null;

  const bucket = env.AWS_S3_BUCKET;
  const publicUrl = `https://${bucket}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;

  if (await exists(bucket, key)) return publicUrl;

  const buffer = await fs.promises.readFile(filePath);

  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'video/mp4',
    }),
  );

  return publicUrl;
}

/**
 * Uploads a raw Buffer directly to S3 and returns the permanent URL.
 * Skips the upload if the key already exists.
 */
export async function uploadBuffer(buffer: Buffer, key: string, contentType: string): Promise<string | null> {
  if (!env.AWS_S3_BUCKET) return null;

  const bucket = env.AWS_S3_BUCKET;
  const publicUrl = `https://${bucket}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;

  if (await exists(bucket, key)) return publicUrl;

  await getClient().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }),
  );

  return publicUrl;
}

/**
 * Uploads all carousel slide images to S3 and returns the permanent URLs.
 * Slides that fail to upload are silently omitted from the result.
 */
export async function uploadCarouselImages(
  displayUrls: string[],
  handle: string,
  postId: string,
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < displayUrls.length; i++) {
    const url = await uploadImageFromUrl(
      displayUrls[i],
      `instagram/${handle}/${postId}_slide_${i}.jpg`,
    );
    if (url) out.push(url);
  }
  return out;
}
