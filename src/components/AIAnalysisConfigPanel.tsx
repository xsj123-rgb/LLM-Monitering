import React, { useEffect, useState } from 'react';
import { Bot, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';

import type { AIAnalysisConfig } from '../types';
import { AppSelect } from './AppSelect';

interface AIAnalysisConfigPanelProps {
  config: AIAnalysisConfig | null;
  isLoading: boolean;
  onSave: (payload: {
    enabled: boolean;
    providerType: 'openai-compatible';
    apiEndpoint: string;
    apiKey: string;
    modelIdentifier: string;
    scheduleMode: 'daily' | 'weekly' | 'monthly';
  }) => Promise<void>;
  onTest: (payload: {
    enabled: boolean;
    providerType: 'openai-compatible';
    apiEndpoint: string;
    apiKey: string;
    modelIdentifier: string;
    scheduleMode: 'daily' | 'weekly' | 'monthly';
  }) => Promise<void>;
}

export function AIAnalysisConfigPanel({ config, isLoading, onSave, onTest }: AIAnalysisConfigPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [providerType, setProviderType] = useState<'openai-compatible'>('openai-compatible');
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelIdentifier, setModelIdentifier] = useState('');
  const [scheduleMode, setScheduleMode] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setProviderType(config.providerType);
    setApiEndpoint(config.apiEndpoint);
    setApiKey(config.apiKey);
    setModelIdentifier(config.modelIdentifier);
    setScheduleMode(config.scheduleMode);
  }, [config]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        enabled,
        providerType,
        apiEndpoint,
        apiKey,
        modelIdentifier,
        scheduleMode,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await onTest({
        enabled,
        providerType,
        apiEndpoint,
        apiKey,
        modelIdentifier,
        scheduleMode,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="rounded-[28px] border border-gray-100 bg-white p-5 shadow-xs">
        <div className="flex flex-col gap-4 border-b border-gray-50 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
              <Bot className="h-5 w-5 text-blue-600" />
              AI 诊断配置
            </h2>
            <p className="mt-1 text-sm text-gray-500">平台统一调用第三方分析模型，按报告周期定时生成各渠道 SLA 诊断建议。</p>
          </div>
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            config?.status === 'healthy'
              ? 'bg-emerald-50 text-emerald-700'
              : config?.status === 'error'
                ? 'bg-rose-50 text-rose-700'
                : config?.status === 'running'
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-gray-100 text-gray-600'
          }`}>
            当前状态：{config?.status || 'idle'}
          </span>
        </div>

        <form onSubmit={handleSave} className="mt-5 space-y-5">
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 text-blue-600" />
              <div>
                <div className="text-sm font-semibold text-slate-900">启用平台 AI 诊断入口</div>
                <div className="text-[11px] leading-5 text-slate-500">启用后，系统会按日报、周报、月报周期自动缓存 AI 诊断建议。</div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-700">接口协议</label>
              <AppSelect
                value={providerType}
                onChange={(value) => setProviderType(value as 'openai-compatible')}
                options={[{ value: 'openai-compatible', label: 'OpenAI 兼容' }]}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-700">默认分析周期</label>
              <AppSelect
                value={scheduleMode}
                onChange={(value) => setScheduleMode(value as 'daily' | 'weekly' | 'monthly')}
                options={[
                  { value: 'daily', label: '日报缓存（24 小时）' },
                  { value: 'weekly', label: '周报缓存（7 天）' },
                  { value: 'monthly', label: '月报缓存（30 天）' },
                ]}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-700">API Endpoint</label>
            <input
              type="url"
              value={apiEndpoint}
              onChange={(event) => setApiEndpoint(event.target.value)}
              placeholder="https://api.deepseek.com/v1/chat/completions"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono outline-none focus:border-brand focus:ring-2 focus:ring-brand"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-700">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="请输入 sk-... 密钥"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono outline-none focus:border-brand focus:ring-2 focus:ring-brand"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-700">模型标识</label>
              <input
                type="text"
                value={modelIdentifier}
                onChange={(event) => setModelIdentifier(event.target.value)}
                placeholder="例如：deepseek-chat"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand"
              />
            </div>
          </div>

          <div className="grid gap-4 rounded-2xl border border-gray-100 bg-slate-50/80 p-4 text-xs text-gray-600 sm:grid-cols-3">
            <div>
              <div className="font-semibold text-gray-700">最近运行时间</div>
              <div className="mt-1">{config?.lastRunAt || '暂无'}</div>
            </div>
            <div>
              <div className="font-semibold text-gray-700">最近成功时间</div>
              <div className="mt-1">{config?.lastSuccessAt || '暂无'}</div>
            </div>
            <div>
              <div className="font-semibold text-gray-700">最近错误信息</div>
              <div className="mt-1 break-all">{config?.lastError || '无'}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={testing || isLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} />
              连通性测试
            </button>
            <button
              type="submit"
              disabled={saving || isLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldCheck className="h-4 w-4" />
              {saving ? '保存中...' : '保存配置'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
