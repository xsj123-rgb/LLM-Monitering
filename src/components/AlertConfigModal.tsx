/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AlertConfig } from '../types';
import { X, Bell, Link2, Mail, Send } from 'lucide-react';

interface AlertConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (alert: Omit<AlertConfig, 'createdAt'> & { id?: string }) => void;
  onTestConnection?: (alert: Omit<AlertConfig, 'createdAt'> & { id?: string }) => Promise<void>;
  alertConfig?: AlertConfig | null; // edit mode
}

export function AlertConfigModal({ isOpen, onClose, onSave, onTestConnection, alertConfig }: AlertConfigModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'feishu' | 'dingtalk' | 'webhook' | 'email'>('feishu');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [status, setStatus] = useState<'enabled' | 'disabled'>('enabled');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);

  useEffect(() => {
    if (alertConfig) {
      setName(alertConfig.name);
      setType(alertConfig.type);
      setWebhookUrl(alertConfig.webhookUrl);
      setSecret(alertConfig.secret || '');
      setStatus(alertConfig.status);
    } else {
      setName('');
      setType('feishu');
      setWebhookUrl('');
      setSecret('');
      setStatus('enabled');
    }
    setTestResult(null);
  }, [alertConfig, isOpen]);

  const handleTestConnection = async () => {
    if (!webhookUrl.trim()) return alert('请先填写投递地址以发起连接测试！');
    setIsTesting(true);
    setTestResult(null);
    try {
      await onTestConnection?.({
        id: alertConfig?.id,
        name,
        type,
        webhookUrl,
        secret,
        status,
      });
      setTestResult('success');
    } catch (error) {
      setTestResult('fail');
    } finally {
      setIsTesting(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !webhookUrl.trim()) {
      return alert('请填写通道描述名以及推送地址参数！');
    }

    onSave({
      id: alertConfig?.id,
      name,
      type,
      webhookUrl,
      secret,
      status
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-fadeIn" id="alert-modal-overlay">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-gray-100 flex flex-col" id="alert-modal-content">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50/40 rounded-t-3xl">
          <div className="flex items-center gap-2">
            <Bell className="text-secondary w-5 h-5" />
            <h3 className="font-semibold text-gray-900 text-sm sm:text-base">
              {alertConfig ? '编辑通知告警渠道' : '新增外部告警联动通道'}
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
        <form onSubmit={handleFormSubmit} className="p-6 space-y-4">
          
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">推送渠道名称 *</label>
            <input
              type="text"
              placeholder="例如：DevOps 核心飞书机器人告警组"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none"
              required
            />
          </div>

          {/* Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">推送协议/载体类型 *</label>
            <select
              value={type}
              onChange={e => setType(e.target.value as any)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none bg-white font-sans"
            >
              <option value="feishu">企业飞书群卡片报警 (推荐)</option>
              <option value="dingtalk">钉钉自定义群机器人推送</option>
              <option value="webhook">标准 REST Webhook 推送 (JSON)</option>
              <option value="email">SMTP 电邮通知投递</option>
            </select>
          </div>

          {/* Destination URL */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
              {type === 'email' ? <Mail className="w-3.5 h-3.5 text-gray-400" /> : <Link2 className="w-3.5 h-3.5 text-gray-400" />}
              <span>{type === 'email' ? '接收邮箱地址 *' : '服务推送接入 Webhook URL *'}</span>
            </label>
            <input
              type="text"
              placeholder={type === 'email' ? 'infra-alert@corp.com' : 'https://open.feishu.cn/open-apis/...'}
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none font-mono text-xs"
              required
            />
          </div>

          {(type === 'dingtalk' || type === 'webhook') && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">签名 Secret / 自定义密钥</label>
              <input
                type="text"
                placeholder="可选，用于钉钉签名或自定义 webhook 鉴权"
                value={secret}
                onChange={e => setSecret(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none font-mono text-xs"
              />
            </div>
          )}

          {/* Trigger State */}
          <div className="flex justify-between items-center bg-gray-50 p-2.5 rounded-xl border border-gray-100">
            <div>
              <span className="text-xs font-semibold text-gray-700">启用该渠道投放通知</span>
              <p className="text-[10px] text-gray-400">关闭后探测报错将临时挂顿此渠道发送</p>
            </div>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as any)}
              className="px-2.5 py-1 text-xs border border-gray-200 bg-white rounded-lg outline-none font-medium"
            >
              <option value="enabled">启用 (Enabled)</option>
              <option value="disabled">停用 (Disabled)</option>
            </select>
          </div>

          {/* Test Link connection */}
          <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-all cursor-pointer"
            >
              <Send className="w-3 h-3" />
              <span>{isTesting ? '发送测试报文中...' : '投递通道连接测试'}</span>
            </button>

            {testResult === 'success' && (
              <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                联通测试成功
              </span>
            )}
            {testResult === 'fail' && (
              <span className="text-[11px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100">
                联通测试失败
              </span>
            )}
          </div>

        </form>

        {/* Footer Actions */}
        <div className="p-4 border-t border-gray-100 flex justify-end gap-3 bg-gray-50/20 rounded-b-3xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleFormSubmit}
            className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer transition-colors"
            id="save-alert-btn"
          >
            保存配置
          </button>
        </div>

      </div>
    </div>
  );
}
