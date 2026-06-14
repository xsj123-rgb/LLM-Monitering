const BEIJING_TIME_ZONE = 'Asia/Shanghai';

function parseDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(hasExplicitTimezone ? value : `${value}Z`);
}

export function formatBeijingTime(value: string | Date): string {
  return parseDate(value).toLocaleString('zh-CN', {
    hour12: false,
    timeZone: BEIJING_TIME_ZONE,
  });
}

export function formatBeijingTimeOnly(value: string | Date): string {
  return parseDate(value).toLocaleTimeString('zh-CN', {
    hour12: false,
    timeZone: BEIJING_TIME_ZONE,
  });
}

export function getBeijingDateParts(value: string | Date) {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = formatter.formatToParts(parseDate(value));
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: pick('year'),
    month: pick('month'),
    date: pick('day'),
    hours: pick('hour'),
    minutes: pick('minute'),
  };
}

export function getBeijingDateInputMax(now: Date = new Date()): string {
  const parts = getBeijingDateParts(now);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.date).padStart(2, '0')}`;
}
