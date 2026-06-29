import type {
  AIAnalysisConfig,
  AIAnalysisTestResult,
  AlertConfig,
  AlertNotification,
  AuthStatus,
  DialTask,
  ManagedUser,
  MetricLog,
  ModelChannel,
  AuditAdviceResponse,
  ReportPushResult,
  ModelDiscoveryResult,
} from '../types';

const RAW_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const IS_BROWSER = typeof window !== 'undefined';

function shouldUseConfiguredApiBase(): boolean {
  if (!RAW_API_BASE_URL || !IS_BROWSER) {
    return Boolean(RAW_API_BASE_URL);
  }
  try {
    const configured = new URL(RAW_API_BASE_URL, window.location.origin);
    return configured.origin === window.location.origin;
  } catch {
    return false;
  }
}

// In LAN dev mode we prefer same-origin `/api` via Vite proxy, otherwise browsers may
// reject or fail to persist the session cookie between `:3000` and `:8000`.
const API_BASE_URL = shouldUseConfiguredApiBase() ? RAW_API_BASE_URL : '';

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function buildUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildUrl(path), {
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
    listUsers: () => request<ManagedUser[]>('/api/auth/users'),
    createUser: (payload: { username: string; password: string; role: 'admin' | 'user'; is_active: boolean }) =>
      request<ManagedUser>('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateUser: (id: string, payload: { is_active?: boolean }) =>
      request<ManagedUser>(`/api/auth/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    deleteUser: (id: string) =>
      request<{ ok: boolean }>(`/api/auth/users/${id}`, {
        method: 'DELETE',
      }),
    resetUserPassword: (id: string, newPassword: string) =>
      request<ManagedUser>(`/api/auth/users/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ new_password: newPassword }),
      }),
  },
  channels: {
    list: () => request<ModelChannel[]>('/api/channels'),
    create: (channel: Omit<ModelChannel, 'id' | 'createdAt'>) =>
      request<ModelChannel>('/api/channels', { method: 'POST', body: JSON.stringify(channel) }),
    update: (id: string, channel: Partial<ModelChannel>) =>
      request<ModelChannel>(`/api/channels/${id}`, { method: 'PATCH', body: JSON.stringify(channel) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/channels/${id}`, { method: 'DELETE' }),
    discoverModels: (payload: { apiEndpoint: string; apiKey?: string; type: ModelChannel['type'] }) =>
      request<ModelDiscoveryResult>('/api/channels/discover-models', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
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
  reports: {
    push: (period: 'daily' | 'weekly' | 'monthly') =>
      request<ReportPushResult>(`/api/reports/push?period=${period}`, { method: 'POST' }),
    auditAdvices: (period: 'daily' | 'weekly' | 'monthly') =>
      request<AuditAdviceResponse>(`/api/reports/audit-advices?period=${period}`),
  },
  system: {
    getAIAnalysisConfig: () => request<AIAnalysisConfig>('/api/system/ai-analysis'),
    updateAIAnalysisConfig: (payload: {
      enabled: boolean;
      providerType: 'openai-compatible';
      apiEndpoint: string;
      apiKey: string;
      modelIdentifier: string;
      scheduleMode: 'daily' | 'weekly' | 'monthly';
    }) =>
      request<AIAnalysisConfig>('/api/system/ai-analysis', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    testAIAnalysisConfig: (payload?: {
      enabled: boolean;
      providerType: 'openai-compatible';
      apiEndpoint: string;
      apiKey: string;
      modelIdentifier: string;
      scheduleMode: 'daily' | 'weekly' | 'monthly';
    }) =>
      request<AIAnalysisTestResult>('/api/system/ai-analysis/test', {
        method: 'POST',
        body: payload ? JSON.stringify(payload) : undefined,
      }),
  },
};

export { ApiError };
