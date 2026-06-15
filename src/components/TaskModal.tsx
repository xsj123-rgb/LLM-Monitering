/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { DialTask, ModelChannel, AlertConfig } from '../types';
import { X, Play, Clock, ShieldAlert, Wifi, MessageSquareCode } from 'lucide-react';
import { DUMMY_DIAL_PROMPTS } from '../data/mockData';
import { AppSelect } from './AppSelect';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Omit<DialTask, 'createdAt'> & { id?: string }) => void;
  task?: DialTask | null; // edit mode
  channels: ModelChannel[];
  alerts: AlertConfig[];
}

export function TaskModal({ isOpen, onClose, onSave, task, channels, alerts }: TaskModalProps) {
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState<number>(5);
  const [concurrency, setConcurrency] = useState<number>(1);
  const [maxTtftMs, setMaxTtftMs] = useState<number>(350);
  const [minTps, setMinTps] = useState<number>(45);
  const [maxTotalLatencyMs, setMaxTotalLatencyMs] = useState<number>(2500);
  const [selectedAlerts, setSelectedAlerts] = useState<string[]>([]);
  const [status, setStatus] = useState<'running' | 'paused'>('running');

  useEffect(() => {
    if (task) {
      setName(task.name);
      setChannelId(task.channelId);
      setPrompt(task.prompt);
      setIntervalMinutes(task.intervalMinutes);
      setConcurrency(task.concurrency);
      setMaxTtftMs(task.thresholds.maxTtftMs);
      setMinTps(task.thresholds.minTps);
      setMaxTotalLatencyMs(task.thresholds.maxTotalLatencyMs);
      setSelectedAlerts(task.alertChannels);
      setStatus(task.status);
    } else {
      setName('');
      setChannelId(channels[0]?.id || '');
      setPrompt(DUMMY_DIAL_PROMPTS[0]);
      setIntervalMinutes(5);
      setConcurrency(1);
      setMaxTtftMs(400);
      setMinTps(30);
      setMaxTotalLatencyMs(3500);
      setSelectedAlerts(alerts.map(a => a.id));
      setStatus('running');
    }
  }, [task, isOpen, channels, alerts]);

  const handleAlertToggle = (alertId: string) => {
    setSelectedAlerts(prev => 
      prev.includes(alertId) 
        ? prev.filter(id => id !== alertId) 
        : [...prev, alertId]
    );
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !channelId || !prompt.trim()) {
      return alert('请完整填写拨测任务名称、关联渠道及测试 Prompt！');
    }

    onSave({
      id: task?.id,
      name,
      channelId,
      prompt,
      intervalMinutes,
      concurrency,
      status,
      thresholds: {
        maxTtftMs,
        minTps,
        maxTotalLatencyMs,
        minSuccessRate: 0.95 // standard fallback
      },
      alertChannels: selectedAlerts
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-fadeIn" id="task-modal-overlay">
      <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl border border-gray-100 flex flex-col max-h-[92vh]" id="task-modal-content">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50/40 rounded-t-3xl">
          <div className="flex items-center gap-2">
            <ShieldAlert className="text-brand w-5 h-5 animate-pulse" />
            <h3 className="font-semibold text-gray-900 text-base">
              {task ? '优化拨测检测计划' : '创建大模型主动拨测监控计划'}
            </h3>
          </div>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-full transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleFormSubmit} className="p-6 overflow-y-auto space-y-5 flex-1 text-sm text-gray-700">
          
          <div className="grid grid-cols-2 gap-4">
            {/* Task Name */}
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-gray-700 mb-1">拨测策略名称 *</label>
              <input
                type="text"
                placeholder="例如：DeepSeek 核心链路 SLA 监测"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none"
                required
              />
            </div>

            {/* Target Channel */}
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-gray-700 mb-1">关联被测大模型通道 *</label>
              <AppSelect
                value={channelId}
                onChange={setChannelId}
                options={[
                  { value: '', label: '-- 请选择受监控的渠道 --' },
                  ...channels.map(ch => ({ value: ch.id, label: `${ch.name} (${ch.modelIdentifier})` })),
                ]}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl"
              />
            </div>
          </div>

          {/* Test Prompt Inputs */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                <MessageSquareCode className="w-3.5 h-3.5 text-gray-400" /> 主动拨测 Prompt 信息 *
              </label>
              <div className="flex gap-2">
                <span className="text-[10px] text-gray-400">快速套用模板:</span>
                {DUMMY_DIAL_PROMPTS.slice(0, 3).map((p, ix) => (
                  <button
                    key={ix}
                    type="button"
                    onClick={() => setPrompt(p)}
                    className="text-[10px] text-blue-600 hover:underline cursor-pointer"
                  >
                    模板{ix + 1}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              rows={2}
              placeholder="发送给大模型的探测问题，建议使用固定、可复现或简短快速回答的问题，以量化准确度。"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none font-sans"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Interval */}
            <div className="col-span-1">
              <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-gray-400" /> 探测执行频次间隔 *
              </label>
              <AppSelect
                value={intervalMinutes}
                onChange={setIntervalMinutes}
                options={[
                  { value: 1, label: '每 1 分钟 (极高频可用性验证)' },
                  { value: 5, label: '每 5 分钟 (生产级别推荐)' },
                  { value: 10, label: '每 10 分钟 (标准轮询)' },
                  { value: 30, label: '每 30 分钟 (稀疏拨测)' },
                  { value: 60, label: '每 60 分钟 (基本巡检)' },
                ]}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl"
              />
            </div>

            {/* Concurrency */}
            <div className="col-span-1">
              <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                <Wifi className="w-3.5 h-3.5 text-gray-400" /> 并发流探测数 (并发量) *
              </label>
              <input
                type="number"
                min={1}
                max={5}
                value={concurrency}
                onChange={e => setConcurrency(Math.min(5, Math.max(1, Number(e.target.value))))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none"
                required
              />
            </div>
          </div>

          {/* SLA Threshold Matrix section */}
          <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
            <h4 className="text-xs font-bold text-slate-900 mb-2.5 flex items-center gap-1.5">
              <span>📊 SLA 服务等级协定硬指标阈值定义:</span>
              <span className="text-[10px] text-slate-400 font-normal">触发此限度立即投递报警通知</span>
            </h4>
            
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Min TPS Limit</label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    value={minTps}
                    onChange={e => setMinTps(Number(e.target.value))}
                    className="w-full pl-3 pr-10 py-1.5 text-xs border border-gray-200 bg-white rounded-lg focus:ring-1 focus:ring-slate-400 outline-none font-mono"
                  />
                  <span className="absolute right-1.5 top-2 text-[9px] text-gray-400">Tok/s</span>
                </div>
                <span className="text-[9px] text-gray-400">吞吐低限</span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Max TTFT Limit</label>
                <div className="relative">
                  <input
                    type="number"
                    min={50}
                    step={10}
                    value={maxTtftMs}
                    onChange={e => setMaxTtftMs(Number(e.target.value))}
                    className="w-full pl-3 pr-8 py-1.5 text-xs border border-gray-200 bg-white rounded-lg focus:ring-1 focus:ring-slate-400 outline-none font-mono"
                  />
                  <span className="absolute right-2.5 top-2 text-[10px] text-gray-400">ms</span>
                </div>
                <span className="text-[9px] text-gray-400">首字限制</span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Max E2E Latency</label>
                <div className="relative">
                  <input
                    type="number"
                    min={200}
                    step={100}
                    value={maxTotalLatencyMs}
                    onChange={e => setMaxTotalLatencyMs(Number(e.target.value))}
                    className="w-full pl-3 pr-8 py-1.5 text-xs border border-gray-200 bg-white rounded-lg focus:ring-1 focus:ring-slate-400 outline-none font-mono"
                  />
                  <span className="absolute right-2.5 top-2 text-[10px] text-gray-400">ms</span>
                </div>
                <span className="text-[9px] text-gray-400">端到端总极限</span>
              </div>
            </div>
          </div>

          {/* Bind Alerts Notification Webhooks */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">
              🚨 联动报警投放通道 (可多选)
            </label>
            {alerts.length === 0 ? (
              <p className="text-xs text-amber-600 bg-amber-50 p-2.5 rounded-xl border border-amber-100">
                暂未配置告警群，成功率低于或触发 SLA 限期时不会进行飞书/钉钉推送。建议先前往[通知渠道设置]模块录入。
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" id="alert-list-checkbox-group">
                {alerts.map(al => (
                  <label 
                    key={al.id} 
                    className={`flex items-center gap-2.5 p-2.5 border rounded-xl cursor-pointer transition-all ${
                      selectedAlerts.includes(al.id) 
                        ? 'border-brand bg-blue-50/20 text-blue-900 font-medium' 
                        : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedAlerts.includes(al.id)}
                      onChange={() => handleAlertToggle(al.id)}
                      className="rounded border-gray-300 text-brand focus:ring-brand w-4 h-4 cursor-pointer"
                    />
                    <div className="text-xs">
                      <div>{al.name}</div>
                      <div className="text-[9px] text-gray-400 capitalize font-normal">类型: {al.type}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Task Status */}
          <div className="flex items-center justify-between border-t border-gray-100 pt-3.5">
            <div className="text-xs text-gray-500">
              策略创建后立即激活执行背景定时对齐任务。
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-600">激活运行状态:</span>
              <button
                type="button"
                onClick={() => setStatus(s => s === 'running' ? 'paused' : 'running')}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  status === 'running' ? 'bg-brand' : 'bg-gray-200'
                }`}
                id="toggle-task-status-switch"
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    status === 'running' ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

        </form>

        {/* Footer Actions */}
        <div className="p-4 border-t border-gray-100 flex justify-end gap-3 rounded-b-3xl bg-gray-50/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleFormSubmit}
            className="px-5 py-2 text-sm font-medium text-white bg-slate-950 hover:bg-slate-800 rounded-xl cursor-pointer transition-colors flex items-center gap-1.5"
            id="save-task-btn"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{task ? '保存策略' : '确定启动检测'}</span>
          </button>
        </div>

      </div>
    </div>
  );
}
