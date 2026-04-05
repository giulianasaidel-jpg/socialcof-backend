export const CRON_STAGGER_TIMEZONE = 'America/Sao_Paulo';

const MINUTES_PER_DAY = 1440;

export function getTimezoneMinuteOfDay(timeZone: string, now: Date = new Date()): number {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(now);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return h * 60 + m;
}

export function dailyMinuteSlot(entityId: string, salt: string): number {
  const s = `${salt}\0${entityId}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % MINUTES_PER_DAY;
}
