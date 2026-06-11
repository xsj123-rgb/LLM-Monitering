import type {
  AlertConfig,
  AlertNotification,
  AuthStatus,
  DialTask,
  MetricLog,
  ModelChannel,
} from '../types';

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  let payload: any = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload?.detail
        ? payload.detail
        : typeof payload === 'string'
          ? payload
          : `Request failed: ${response.status}`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export const api = {
  auth: {
    me: () => request<AuthStatus>('/api/auth/me'),
    login: (username: string, password: string) =>
      request<AuthStatus>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: boolean }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      }),
  },
  channels: {
    list: () => request<ModelChannel[]>('/api/channels'),
    create: (channel: Omit<ModelChannel, 'id' | 'createdAt'>) =>
      request<ModelChannel>('/api/channels', { method: 'POST', body: JSON.stringify(channel) }),
    update: (id: string, channel: Partial<ModelChannel>) =>
      request<ModelChannel>(`/api/channels/${id}`, { method: 'PATCH', body: JSON.stringify(channel) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/channels/${id}`, { method: 'DELETE' }),
  },
  tasks: {
    list: () => request<DialTask[]>('/api/tasks'),
    create: (task: Omit<DialTask, 'id' | 'createdAt'>) =>
      request<DialTask>('/api/tasks', { method: 'POST', body: JSON.stringify(task) }),
    update: (id: string, task: Partial<DialTask>) =>
      request<DialTask>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(task) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' }),
    probe: (id: string) => request<MetricLog>(`/api/tasks/${id}/probe`, { method: 'POST' }),
  },
  alerts: {
    list: () => request<AlertConfig[]>('/api/alerts'),
    create: (alert: Omit<AlertConfig, 'id' | 'createdAt'>) =>
      request<AlertConfig>('/api/alerts', { method: 'POST', body: JSON.stringify(alert) }),
    update: (id: string, alert: Partial<AlertConfig>) =>
      request<AlertConfig>(`/api/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(alert) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/alerts/${id}`, { method: 'DELETE' }),
    test: (id: string) => request<{ ok: boolean }>(`/api/alerts/${id}/test`, { method: 'POST' }),
  },
  logs: {
    list: (params: { channelId?: string; status?: string; range?: string; limit?: number }) => {
      const search = new URLSearchParams();
      if (params.channelId) search.set('channel_id', params.channelId);
      if (params.status) search.set('status', params.status);
      if (params.range) search.set('range', params.range);
      if (params.limit) search.set('limit', String(params.limit));
      return request<MetricLog[]>(`/api/logs?${search.toString()}`);
    },
  },
  notifications: {
    list: () => request<AlertNotification[]>('/api/notifications'),
    resolve: (id: string) => request<AlertNotification>(`/api/notifications/${id}`, { method: 'PATCH' }),
  },
};

export { ApiError };
