import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import https from 'https';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import OpenAI from 'openai';
import { env } from '../config/env';
import { uploadVideoFromFile } from './s3';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const INSTAGRAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'video/mp4,video/*,*/*;q=0.8',
  'Referer': 'https://www.instagram.com/',
};

const TIKTOK_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'video/mp4,video/*,*/*;q=0.8',
  'Referer': 'https://www.tiktok.com/',
};

export const DOWNLOAD_HEADERS_BY_PLATFORM = {
  instagram: INSTAGRAM_HEADERS,
  tiktok: TIKTOK_HEADERS,
} as const;

function tmpPath(ext: string): string {
  return path.join(os.tmpdir(), `reel_${crypto.randomBytes(8).toString('hex')}${ext}`);
}

function downloadToFile(url: string, destPath: string, headers: Record<string, string>, redirectsLeft = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        if (redirectsLeft === 0) return reject(new Error('Too many redirects'));
        return resolve(downloadToFile(res.headers.location, destPath, headers, redirectsLeft - 1));
      }
      if (res.statusCode && res.statusCode >= 400) {
        return reject(new Error(`HTTP ${res.statusCode} downloading video`));
      }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Video download timeout')); });
  });
}

function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .outputOptions(['-c:a', 'aac', '-b:a', '64k'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

function compressVideo(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',
        '-crf 32',
        '-preset veryfast',
        '-c:a aac',
        '-b:a 48k',
        '-movflags +faststart',
        '-vf scale=-2:480',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

function transcribe(filePath: string): Promise<string> {
  if (!env.GPT_KEY) throw new Error('GPT_KEY is not configured');
  const client = new OpenAI({ apiKey: env.GPT_KEY });

  return client.audio.transcriptions
    .create({ model: 'whisper-1', file: fs.createReadStream(filePath), language: 'pt', response_format: 'text' })
    .then((r) => (r as unknown as string).trim());
}

async function transcribeVideo(videoPath: string): Promise<string> {
  const audioPath = tmpPath('.m4a');
  try {
    await extractAudio(videoPath, audioPath);
    return await transcribe(audioPath);
  } catch {
    const compressedPath = tmpPath('_compressed.mp4');
    try {
      await compressVideo(videoPath, compressedPath);
      return await transcribe(compressedPath);
    } finally {
      fs.unlink(compressedPath, () => {});
    }
  } finally {
    fs.unlink(audioPath, () => {});
  }
}

export interface ProcessedReel {
  s3VideoUrl: string | null;
  transcript: string;
}

export async function processVideo(
  videoUrl: string,
  s3Key: string,
  downloadHeaders: Record<string, string> = INSTAGRAM_HEADERS,
): Promise<ProcessedReel> {
  const rawPath = tmpPath('.mp4');

  try {
    await downloadToFile(videoUrl, rawPath, downloadHeaders);

    const [s3VideoUrl, transcript] = await Promise.all([
      uploadVideoFromFile(rawPath, s3Key).catch(() => null),
      transcribeVideo(rawPath).catch(() => ''),
    ]);

    return { s3VideoUrl, transcript };
  } finally {
    fs.unlink(rawPath, () => {});
  }
}

export async function processReel(videoUrl: string, handle: string, postId: string): Promise<ProcessedReel> {
  return processVideo(videoUrl, `instagram/${handle}/${postId}.mp4`, INSTAGRAM_HEADERS);
}
