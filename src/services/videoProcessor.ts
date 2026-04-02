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

const MAX_WHISPER_BYTES = 24 * 1024 * 1024;

const DOWNLOAD_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'video/mp4,video/*,*/*;q=0.8',
  'Referer': 'https://www.instagram.com/',
};

function tmpPath(ext: string): string {
  return path.join(os.tmpdir(), `reel_${crypto.randomBytes(8).toString('hex')}${ext}`);
}

/**
 * Downloads a video from a URL to a local temp file, following redirects.
 */
function downloadToFile(url: string, destPath: string, redirectsLeft = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers: DOWNLOAD_HEADERS }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        if (redirectsLeft === 0) return reject(new Error('Too many redirects'));
        return resolve(downloadToFile(res.headers.location, destPath, redirectsLeft - 1));
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

/**
 * Compresses a video file using ffmpeg targeting a size under MAX_WHISPER_BYTES.
 * Uses H.264 + AAC at reduced quality to minimise file size.
 */
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

/**
 * Transcribes the audio of a video/audio file using OpenAI Whisper.
 */
async function transcribe(filePath: string): Promise<string> {
  if (!env.GPT_KEY) throw new Error('GPT_KEY is not configured');
  const client = new OpenAI({ apiKey: env.GPT_KEY });

  const response = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file: fs.createReadStream(filePath),
    language: 'pt',
    response_format: 'text',
  });

  return (response as unknown as string).trim();
}

export interface ProcessedReel {
  s3VideoUrl: string | null;
  transcript: string;
}

/**
 * Full pipeline: downloads the video, compresses if needed, uploads to S3, and transcribes with Whisper.
 * Cleans up all temp files after completion.
 */
export async function processReel(videoUrl: string, handle: string, postId: string): Promise<ProcessedReel> {
  const rawPath = tmpPath('.mp4');
  const compressedPath = tmpPath('_compressed.mp4');

  try {
    await downloadToFile(videoUrl, rawPath);

    const rawSize = (await fs.promises.stat(rawPath)).size;
    const needsCompression = rawSize > MAX_WHISPER_BYTES;

    const videoPath = needsCompression ? compressedPath : rawPath;

    if (needsCompression) {
      await compressVideo(rawPath, compressedPath);
    }

    const [s3VideoUrl, transcript] = await Promise.all([
      uploadVideoFromFile(videoPath, `instagram/${handle}/${postId}.mp4`).catch(() => null),
      transcribe(videoPath),
    ]);

    return { s3VideoUrl, transcript };
  } finally {
    for (const p of [rawPath, compressedPath]) {
      fs.unlink(p, () => {});
    }
  }
}
