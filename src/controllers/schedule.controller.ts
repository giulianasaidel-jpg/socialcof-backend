import { Request, Response } from 'express';
import { ScheduleEntry } from '../models/ScheduleEntry';
import { InstagramAccount } from '../models/InstagramAccount';

/**
 * GET /schedule — Returns schedule entries for an account and month, keyed as "{accountId}::{YYYY-MM-DD}".
 */
export async function listSchedule(req: Request, res: Response): Promise<void> {
  const { accountId, year, month } = req.query as Record<string, string>;

  if (!accountId || !year || !month) {
    res.status(400).json({ message: 'accountId, year, and month are required' });
    return;
  }

  const account = await InstagramAccount.findOne({ externalId: accountId });
  if (!account) {
    res.json({});
    return;
  }

  const paddedMonth = month.padStart(2, '0');
  const prefix = `${year}-${paddedMonth}`;

  const entries = await ScheduleEntry.find({
    accountId: account._id,
    date: { $regex: `^${prefix}` },
  });

  const result: Record<string, unknown> = {};
  for (const entry of entries) {
    const key = `${accountId}::${entry.date}`;
    result[key] = {
      time: entry.time,
      theme: entry.theme,
      content: entry.content,
      format: entry.format,
      caption: entry.caption,
      status: entry.status,
    };
  }

  res.json(result);
}

/**
 * PUT /schedule/:accountId/:date — Creates or replaces a schedule entry for a given account and date.
 */
export async function upsertScheduleEntry(req: Request, res: Response): Promise<void> {
  const { accountId, date } = req.params;

  const account = await InstagramAccount.findOne({ externalId: accountId });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }

  const entry = await ScheduleEntry.findOneAndUpdate(
    { accountId: account._id, date },
    { $set: { ...req.body, accountId: account._id, date } },
    { upsert: true, new: true },
  );

  res.json({
    [`${accountId}::${date}`]: {
      time: entry.time,
      theme: entry.theme,
      content: entry.content,
      format: entry.format,
      caption: entry.caption,
      status: entry.status,
    },
  });
}

/**
 * DELETE /schedule/:accountId/:date — Removes a schedule entry for a given account and date.
 */
export async function deleteScheduleEntry(req: Request, res: Response): Promise<void> {
  const { accountId, date } = req.params;

  const account = await InstagramAccount.findOne({ externalId: accountId });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }

  await ScheduleEntry.findOneAndDelete({ accountId: account._id, date });
  res.status(204).send();
}
