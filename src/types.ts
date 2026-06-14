/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ModelChannel {
  id: string;
  name: string;
  apiEndpoint: string;
  apiKey: string;
  modelIdentifier: string;
  type: 'openai' | 'ollama' | 'huggingface' | 'custom';
  status: 'active' | 'degraded' | 'offline';
  tags: string[];
  createdAt: string;
  updatedAt?: string;
  lastProbeAt?: string | null;
  lastOkAt?: string | null;
  description?: string;
}

export interface SLAThresholds {
  maxTtftMs: number; // Maximum Time to First Token, e.g. 800ms
  minTps: number;    // Minimum Tokens per Second, e.g. 25
  maxTotalLatencyMs: number; // Maximum total latency, e.g. 5000ms
  minSuccessRate: number;    // Minimum success rate, e.g. 99%
}

export interface DialTask {
  id: string;
  name: string;
  channelId: string;
  prompt: string;
  intervalMinutes: number; // e.g. 1, 5, 10, 30
  concurrency: number;    // e.g. 1 to 5
  status: 'running' | 'paused';
  thresholds: SLAThresholds;
  alertChannels: string[]; // Reference to AlertConfig IDs
  createdAt: string;
  updatedAt?: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
}

export interface MetricLog {
  id: string;
  taskId: string;
  taskName: string;
  channelId: string;
  channelName: string;
  timestamp: string; // ISO String
  prompt: string;
  responseText: string;
  // SLA Timings
  dnsTimeMs: number;
  tcpTimeMs: number;
  ttftMs: number;       // Time to First Token
  totalLatencyMs: number; // End to End
  tokensCount: number;
  tps: number;          // Tokens per Second
  statusCode: number;
  success: boolean;
  errorMsg?: string;
  requestPayloadJson?: Record<string, unknown>;
  responseExcerpt?: string;
  tokenCountSource?: 'provider' | 'estimated';
  trigger?: 'scheduled' | 'manual';
  sampleNo?: number;
  errorType?: string;
  // Violation flags
  violatedTtft: boolean;
  violatedTps: boolean;
  violatedExtLatency: boolean;
}

export interface AlertConfig {
  id: string;
  name: string;
  type: 'feishu' | 'dingtalk' | 'webhook' | 'email';
  webhookUrl: string;
  secret?: string;
  status: 'enabled' | 'disabled';
  createdAt: string;
  updatedAt?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  metric: 'ttft' | 'tps' | 'latency' | 'success_rate';
  operator: 'gt' | 'lt';
  value: number;
  consecutiveOccurrences: number;
}

export interface AlertNotification {
  id: string;
  timestamp: string;
  channelName: string;
  taskName: string;
  metricName: string;
  metricValue: string;
  thresholdValue: string;
  status: 'resolved' | 'firing';
  alertChannelName: string;
}

export interface ReportPushResult {
  period: 'daily' | 'weekly' | 'monthly';
  deliveredCount: number;
  failedCount: number;
  endpointNames: string[];
  errors: string[];
  attachmentSent: boolean;
  attachmentMessage?: string | null;
}

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  last_login_at?: string | null;
}

export interface AuthStatus {
  authenticated: boolean;
  user: AuthUser | null;
}

export interface ManagedUser extends AuthUser {}
