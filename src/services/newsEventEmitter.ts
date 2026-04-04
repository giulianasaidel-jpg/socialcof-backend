import { Response } from 'express';
import { NewsCategory, NewsLanguage } from '../models/MedicalNews';

export interface NewsEvent {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  category: NewsCategory;
  language: NewsLanguage;
  publishedAt: string;
}

export interface BulkScrapeProgressEvent {
  source: string;
  status: 'running' | 'done' | 'skipped' | 'error' | 'complete';
  scraped?: number;
  newItems?: number;
  saved?: number;
  error?: string;
  totalSources?: number;
  completedSources?: number;
  totalNew?: number;
}

const clients = new Set<Response>();

/**
 * Registers an SSE client response and removes it when the connection closes.
 */
export function registerClient(res: Response): void {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

/**
 * Broadcasts a new medical news item to all connected SSE clients.
 */
export function broadcastNewsItem(item: NewsEvent): void {
  if (clients.size === 0) return;
  const payload = `data: ${JSON.stringify(item)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

/**
 * Broadcasts a bulk scrape progress event to all connected SSE clients.
 * Uses a named event type so the frontend can distinguish from news items.
 */
export function broadcastBulkProgress(event: BulkScrapeProgressEvent): void {
  if (clients.size === 0) return;
  const payload = `event: bulk-scrape\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}
