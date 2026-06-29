/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ModelChannel } from '../types';
import { X, Cpu, Key, Link2, Tag, Percent, ServerCog, RefreshCw, ListChecks } from 'lucide-react';
import { AppSelect } from './AppSelect';
import { api, ApiError } from '../lib/api';

interface ChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (channel: Omit<ModelChannel, 'createdAt'> & { id?: string }) => void;
  channel?: ModelChannel | null; // edit mode
}

export function ChannelModal({ isOpen, onClose, onSave, channel }: ChannelModalProps) {
  const [name, setName] = useState('');
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelIdentifier, setModelIdentifier] = useState('');
  const [type, setType] = useState<'openai' | 'ollama' | 'huggingface' | 'custom'>('openai');
  const [status, setStatus] = useState<'active' | 'degraded' | 'offline'>('active');
  const [tagsInput, setTagsInput] = useState('');
  const [description, setDescription] = useState('');
  const [deploymentMode, setDeploymentMode] = useState<'k8s' | 'docker' | 'bare_metal' | 'other'>('docker');
  const [deploymentConfig, setDeploymentConfig] = useState('');
  const [deploymentEnv, setDeploymentEnv] = useState('');
  const [deploymentArgs, setDeploymentArgs] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discoverySourceUrl, setDiscoverySourceUrl] = useState<string | null>(null);
  const [discoveringModels, setDiscoveringModels] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  // Initial state load
  useEffect(() => {
    if (channel) {
      setName(channel.name);
      setApiEndpoint(channel.apiEndpoint);
      setApiKey(channel.apiKey);
      setModelIdentifier(channel.modelIdentifier);
      setType(channel.type);
      setStatus(channel.status);
      setTagsInput(channel.tags.join(', '));
      setDescription(channel.description || '');
      setDeploymentMode(channel.deploymentMode || 'docker');
      setDeploymentConfig(channel.deploymentConfig || '');
      setDeploymentEnv(channel.deploymentEnv || '');
      setDeploymentArgs(channel.deploymentArgs || '');
      setDiscoveredModels(channel.modelIdentifier ? [channel.modelIdentifier] : []);
      setDiscoverySourceUrl(null);
      setDiscoveryError(null);
    } else {
      setName('');
      setApiEndpoint('');
      setApiKey('');
      setModelIdentifier('');
      setType('openai');
      setStatus('active');
      setTagsInput('Core, Quantized');
      setDescription('');
      setDeploymentMode('docker');
      setDeploymentConfig('');
      setDeploymentEnv('');
      setDeploymentArgs('');
      setDiscoveredModels([]);
      setDiscoverySourceUrl(null);
      setDiscoveryError(null);
    }
  }, [channel, isOpen]);

  // Handle typing prefill values
  const handleTypeChange = (newType: 'openai' | 'ollama' | 'huggingface' | 'custom') => {
    setType(newType);
    setDiscoveredModels([]);
    setDiscoverySourceUrl(null);
    setDiscoveryError(null);
    if (!apiEndpoint) {
      if (newType === 'openai') {
        setApiEndpoint('https://api.openai.com/v1/chat/completions');
      } else if (newType === 'ollama') {
        setApiEndpoint('http://localhost:11434/api/chat');
      } else if (newType === 'custom') {
        setApiEndpoint('http://localhost:1234/api/v1/chat');
      } else if (newType === 'huggingface') {
        setApiEndpoint('https://api-inference.huggingface.co/models/');
      }
    }
  };

  const handleDiscoverModels = async () => {
    if (!apiEndpoint.trim()) {
      setDiscoveryError('请先填写 API 服务端点，再获取模型列表。');
      return;
    }
    setDiscoveringModels(true);
    setDiscoveryError(null);
    try {
      const result = await api.channels.discoverModels({
        apiEndpoint: apiEndpoint.trim(),
        apiKey: apiKey.trim(),
        type,
      });
      setDiscoveredModels(result.models);
      setDiscoverySourceUrl(result.sourceUrl ?? null);
      if (result.models.length === 1) {
        setModelIdentifier(result.models[0]);
        if (!name.trim()) {
          setName(result.models[0]);
        }
      }
    } catch (error) {
      setDiscoveredModels([]);
      setDiscoverySourceUrl(null);
      setDiscoveryError(error instanceof ApiError ? error.message : '获取模型列表失败，请稍后重试。');
    } finally {
      setDiscoveringModels(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !apiEndpoint.trim() || !modelIdentifier.trim()) {
      return alert('请填写模型通道名称、API 端点及模型服务标识！');
    }

    const tags = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    onSave({
      id: channel?.id,
      name,
      apiEndpoint,
      apiKey,
      modelIdentifier,
      type,
      status,
      tags,
      description,
      deploymentMode,
      deploymentConfig,
      deploymentEnv,
      deploymentArgs,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-fadeIn" id="channel-modal-overlay">
      <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl border border-gray-100 flex flex-col max-h-[90vh]" id="channel-modal-content">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-50 bg-gray-50/40 rounded-t-3xl">
          <div className="flex items-center gap-2">
            <Cpu className="text-brand w-5 h-5" />
            <h3 className="font-semibold text-gray-900 text-base">
              {channel ? '编辑大模型接入渠道' : '录入新大模型监测渠道'}
            </h3>
          </div>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-full transition-colors"
            id="close-channel-modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleFormSubmit} className="p-6 overflow-y-auto space-y-4 flex-1">
          
          <div className="grid grid-cols-2 gap-4">
            {/* Model Name */}
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-gray-700 mb-1">渠道/实例别名 *</label>
              <input
                type="text"
                placeholder="例如：DeepSeek-V3 (Private Edge)"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none"
                required
              />
            </div>

            {/* Model Target ID */}
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-gray-700 mb-1">模型服务标识码 (Model Target) *</label>
              <input
                type="text"
                placeholder="例如：deepseek-chat 或 llama3.1"
                value={modelIdentifier}
                onChange={e => setModelIdentifier(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Provider Type */}
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-gray-700 mb-1">端点接口协议规范 *</label>
              <AppSelect
                value={type}
                onChange={handleTypeChange}
                options={[
                  { value: 'openai', label: 'OpenAI 兼容规范 (/v1/chat/completions)' },
                  { value: 'ollama', label: 'Ollama 接口规范 (/api/chat)' },
                  { value: 'huggingface', label: 'Hugging Face 推理 API' },
                  { value: 'custom', label: 'Custom / 自定义私有流式协议' },
                ]}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl"
              />
            </div>

            {/* Status */}
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-gray-700 mb-1">当前初始化运行状态</label>
              <AppSelect
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'active', label: '运行正常 (Active)' },
                  { value: 'degraded', label: '降级波动 (Degraded)' },
                  { value: 'offline', label: '暂时离线 (Offline)' },
                ]}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl"
              />
            </div>
          </div>

          {/* API Endpoint */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
              <Link2 className="w-3 h-3 text-gray-400" /> API 服务端点 (Endpoint URL) *
            </label>
            <input
              type="url"
              placeholder="http://10.x.x.x:8000/v1/chat/completions"
              value={apiEndpoint}
              onChange={e => {
                setApiEndpoint(e.target.value);
                setDiscoveredModels([]);
                setDiscoverySourceUrl(null);
                setDiscoveryError(null);
              }}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none font-mono text-xs"
              required
            />
            <p className="text-[10px] text-gray-400 mt-1">
              请确保大模型监控平台能够访问该私有网络或公网的端口地址。
            </p>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
              <Key className="w-3 h-3 text-gray-400" /> 授权访问凭证密匙 (API Key)
            </label>
            <input
              type="password"
              placeholder="请输入sk-... 格式密钥，无鉴权可不填"
              value={apiKey}
              onChange={e => {
                setApiKey(e.target.value);
                setDiscoveredModels([]);
                setDiscoverySourceUrl(null);
                setDiscoveryError(null);
              }}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none font-mono"
            />
          </div>

          <div className="rounded-2xl border border-blue-100 bg-linear-to-br from-blue-50/70 to-white p-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ListChecks className="h-4 w-4 text-blue-600" />
                获取可用模型列表
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                {discoveredModels.length > 0 ? (
                  <div className="inline-flex min-w-[96px] items-center justify-between rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs">
                    <span className="font-medium text-slate-500">模型数量</span>
                    <span className="ml-3 text-base font-bold text-slate-900">{discoveredModels.length}</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleDiscoverModels()}
                  disabled={discoveringModels}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-xs font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${discoveringModels ? 'animate-spin' : ''}`} />
                  {discoveringModels ? '获取中...' : '获取模型列表'}
                </button>
              </div>
            </div>

            {discoveredModels.length > 0 ? (
              <div className="rounded-xl border border-white/80 bg-white/90 p-3 shadow-[0_8px_24px_rgba(59,130,246,0.08)]">
                <label className="mb-2 block text-xs font-semibold text-gray-700">选择纳管模型</label>
                <AppSelect
                  value={modelIdentifier || discoveredModels[0]}
                  onChange={(value) => {
                    setModelIdentifier(value);
                    if (!name.trim()) {
                      setName(value);
                    }
                  }}
                  options={discoveredModels.map((model) => ({ value: model, label: model }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </div>
            ) : null}

            {discoverySourceUrl ? (
              <p className="text-[10px] text-slate-500">
                列表来源：<span className="font-mono">{discoverySourceUrl}</span>
              </p>
            ) : null}

            {discoveryError ? (
              <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {discoveryError}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Tags */}
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                <Tag className="w-3 h-3 text-gray-400" /> 标识分类标签 (英文逗号隔开)
              </label>
              <input
                type="text"
                placeholder="Core, FP16, Edge"
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none"
              />
            </div>

            {/* Description placeholder */}
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-gray-700 mb-1">物理服务器/GPU集群挂载描述</label>
              <input
                type="text"
                placeholder="例如：挂载于 A100x8 训练机房"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-slate-50/70 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <ServerCog className="w-4 h-4 text-brand" />
              <div>
                <p className="text-sm font-semibold text-slate-900">本地私有化部署信息</p>
                <p className="text-[11px] text-slate-500">用于 SLA 合规审计阶段生成更准确的性能总结与部署建议。</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-semibold text-gray-700 mb-1">部署方式</label>
                <AppSelect
                  value={deploymentMode}
                  onChange={value => setDeploymentMode(value as 'k8s' | 'docker' | 'bare_metal' | 'other')}
                  options={[
                    { value: 'k8s', label: 'Kubernetes / k8s' },
                    { value: 'docker', label: 'Docker / Compose' },
                    { value: 'bare_metal', label: '物理机 / 裸机' },
                    { value: 'other', label: '其他方式' },
                  ]}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">部署配置</label>
              <textarea
                value={deploymentConfig}
                onChange={e => setDeploymentConfig(e.target.value)}
                placeholder="例如：副本数、资源限制、GPU 类型、PVC、Service/Ingress、亲和性策略等"
                className="w-full min-h-[92px] px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-semibold text-gray-700 mb-1">部署环境变量</label>
                <textarea
                  value={deploymentEnv}
                  onChange={e => setDeploymentEnv(e.target.value)}
                  placeholder="例如：CUDA_VISIBLE_DEVICES=0,1&#10;OLLAMA_NUM_PARALLEL=4"
                  className="w-full min-h-[110px] px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none font-mono"
                />
              </div>

              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-semibold text-gray-700 mb-1">部署参数</label>
                <textarea
                  value={deploymentArgs}
                  onChange={e => setDeploymentArgs(e.target.value)}
                  placeholder="例如：--tensor-parallel-size 2&#10;--gpu-memory-utilization 0.92"
                  className="w-full min-h-[110px] px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none font-mono"
                />
              </div>
            </div>
          </div>

          {/* SLA Standard Notice (Helper info) */}
          <div className="p-3 bg-blue-50/50 rounded-2xl border border-blue-100 flex gap-2.5 items-start text-xs text-blue-800">
            <Percent className="w-4 h-4 text-brand shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">SLA 拨测自动联动说明</p>
              <p className="text-[10px] text-blue-700 mt-0.5">
                渠道保存后，您可为其创建拨测探测，优先设置最低吞吐量(TPS)，并结合首字延迟(TTFT)限制，异常时自动触发机器人告警。
              </p>
            </div>
          </div>

        </form>

        {/* Footer Actions */}
        <div className="p-4 border-t border-gray-50 flex justify-end gap-3 rounded-b-3xl bg-gray-50/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleFormSubmit}
            className="px-5 py-2 text-sm font-medium text-white bg-brand hover:opacity-90 rounded-xl cursor-pointer transition-opacity"
            id="save-channel-btn"
          >
            {channel ? '更新配置' : '确定录入'}
          </button>
        </div>

      </div>
    </div>
  );
}
