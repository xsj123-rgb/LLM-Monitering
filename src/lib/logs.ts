import type { MetricLog } from '../types';

function readProbeContextInterval(log: MetricLog): number | null {
  const payload = log.requestPayloadJson;
  if (!payload || typeof payload !== 'object') return null;
  const probeContext = payload._probeContext;
  if (!probeContext || typeof probeContext !== 'object') return null;
  const intervalValue = (probeContext as Record<string, unknown>).intervalMinutes;
  return typeof intervalValue === 'number' && Number.isFinite(intervalValue) ? intervalValue : null;
}

function inferScheduledInterval(log: MetricLog, allLogs: MetricLog[]): number | null {
  if (log.trigger !== 'scheduled') return null;
  const scheduledLogs = allLogs
    .filter((item) => item.taskId === log.taskId && item.trigger === 'scheduled')
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const index = scheduledLogs.findIndex((item) => item.id === log.id);
  if (index === -1) return null;

  const candidates = [scheduledLogs[index - 1], scheduledLogs[index + 1]].filter(Boolean) as MetricLog[];
  for (const neighbor of candidates) {
    const deltaMs = Math.abs(new Date(log.timestamp).getTime() - new Date(neighbor.timestamp).getTime());
    const deltaMinutes = Math.round(deltaMs / 60000);
    if (deltaMinutes >= 1 && deltaMinutes <= 1440) {
      return deltaMinutes;
    }
  }
  return null;
}

export function getExecutionIntervalMinutes(log: MetricLog, allLogs: MetricLog[]): number | null {
  return readProbeContextInterval(log) ?? inferScheduledInterval(log, allLogs);
}

export function formatProbeTrigger(trigger?: MetricLog['trigger']): string {
  if (trigger === 'manual') return '手动拨测';
  if (trigger === 'scheduled') return '定时拨测';
  return '未知触发';
}
