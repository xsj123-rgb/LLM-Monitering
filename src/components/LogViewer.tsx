/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { MetricLog, DialTask } from '../types';
import { X, Network, Cpu, Clock, Terminal, CheckCircle2, AlertCircle, FileJson2, ChevronRight } from 'lucide-react';
import { formatBeijingTimeOnly } from '../lib/time';
import { formatProbeTrigger, getExecutionIntervalMinutes } from '../lib/logs';

interface LogViewerProps {
  log: MetricLog | null;
  onClose: () => void;
  associatedTask?: DialTask;
  allLogs?: MetricLog[];
}

export function LogViewer({ log, onClose, associatedTask, allLogs = [] }: LogViewerProps) {
  if (!log) return null;
  const executionIntervalMinutes = getExecutionIntervalMinutes(log, allLogs);

  // Breakdown values
  const total = Math.max(log.totalLatencyMs, 1);
  const dnsAndTcp = log.dnsTimeMs + log.tcpTimeMs;
  const prefill = Math.max(log.ttftMs - dnsAndTcp, 0);
  const generation = Math.max(log.totalLatencyMs - log.ttftMs, 0);

  // SLA bounds checks
  const ttftRejected = associatedTask ? log.ttftMs > associatedTask.thresholds.maxTtftMs : log.violatedTtft;
  const tpsRejected = associatedTask ? log.tps < associatedTask.thresholds.minTps : log.violatedTps;
  const latencyRejected = associatedTask ? log.totalLatencyMs > associatedTask.thresholds.maxTotalLatencyMs : log.violatedExtLatency;

  // Mock Request Payload
  const rawRequestPayload = log.requestPayloadJson || {
    model: log.id.includes('ds') ? 'deepseek-chat' : 'llama3-70b-instruct',
    messages: [{ role: 'user', content: log.prompt }],
    temperature: 0.1,
    max_tokens: 128,
    stream: true
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn" id="log-viewer-overlay">
      <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl border border-gray-100 flex flex-col max-h-[92vh]" id="log-viewer-content">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50/40 rounded-t-3xl">
          <div className="flex items-center gap-2.5">
            <Terminal className="text-slate-700 w-5 h-5" />
            <div>
              <h3 className="font-semibold text-gray-900 text-sm sm:text-base">拨测详细时序与流式报文诊断</h3>
              <p className="text-[10px] text-gray-400 font-mono">Request Reference: {log.id}</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-full transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs sm:text-sm text-gray-700">
          
          {/* Quick Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-100" id="diagnostic-quick-summary">
            <div>
              <div className="text-[10px] text-gray-400 font-medium">发起时间</div>
              <div className="font-mono text-gray-700 mt-1">
                {formatBeijingTimeOnly(log.timestamp)}
              </div>
            </div>

            <div>
              <div className="text-[10px] text-gray-400 font-medium">HTTP 状态码</div>
              <div className="mt-1 flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${log.success ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <span className="font-mono font-semibold text-gray-800">{log.statusCode}</span>
              </div>
            </div>

            <div>
              <div className="text-[10px] text-gray-400 font-medium">关联模型渠道</div>
              <div className="font-semibold text-gray-800 mt-1 truncate max-w-[120px]" title={log.channelName}>
                {log.channelName}
              </div>
            </div>

            <div>
              <div className="text-[10px] text-gray-400 font-medium">SLA 合规性评估</div>
              <div className="mt-1">
                {log.success && !ttftRejected && !tpsRejected && !latencyRejected ? (
                  <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-md font-medium text-[10px] border border-emerald-100">
                    SLA 达标 (OK)
                  </span>
                ) : (
                  <span className="bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded-md font-medium text-[10px] border border-rose-100">
                    SLA 超标 (Violation)
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-[11px] text-blue-900">
            <span className="font-semibold">执行上下文：</span>
            {formatProbeTrigger(log.trigger)}
            {executionIntervalMinutes ? `，本条日志执行时的调度周期为 ${executionIntervalMinutes} 分钟` : ''}
            {log.trigger === 'scheduled' && associatedTask && executionIntervalMinutes !== null && executionIntervalMinutes !== associatedTask.intervalMinutes
              ? '。这通常表示该日志生成于任务频率调整之前。'
              : ''}
          </div>

          {/* SLA Metrics Breakdown (Diagnostic Waterfall) */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
              <Network className="w-4 h-4 text-brand" />
              <span>毫秒级时序分解瀑布图 (Timing Waterfall)</span>
            </h4>

            {log.success ? (
              <div className="space-y-2.5 bg-slate-50 border border-slate-100 p-4 rounded-2xl font-mono text-[11px] sm:text-xs">
                
                {/* DNS / TCP Handshake */}
                <div className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-3 text-slate-500 font-semibold truncate flex items-center gap-1">
                    <span>DNS 与握手机制</span>
                  </div>
                  <div className="col-span-1 text-slate-700 font-semibold text-right">
                    {dnsAndTcp.toFixed(1)}ms
                  </div>
                  <div className="col-span-8 bg-slate-200/60 h-3.5 rounded-md overflow-hidden relative">
                    <div 
                      className="bg-purple-500 h-full" 
                      style={{ width: `${Math.max((dnsAndTcp / total) * 100, 2.5)}%` }}
                    />
                    <span className="absolute left-1.5 top-0.5 text-[9px] text-slate-400 scale-[0.85] transform origin-left">
                      DNS: {log.dnsTimeMs.toFixed(1)}ms | TCP: {log.tcpTimeMs.toFixed(1)}ms
                    </span>
                  </div>
                </div>

                {/* TTFT - Prefill */}
                <div className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-3 text-slate-500 font-semibold truncate flex items-center gap-1">
                    <span>首字上屏 (Prefill)</span>
                  </div>
                  <div className="col-span-1 text-slate-700 font-semibold text-right">
                    {log.ttftMs}ms
                  </div>
                  <div className="col-span-8 bg-slate-200/60 h-3.5 rounded-md overflow-hidden relative">
                    <div 
                      className="bg-brand h-full" 
                      style={{ 
                        marginLeft: `${(dnsAndTcp / total) * 100}%`,
                        width: `${Math.max((prefill / total) * 100, 2.5)}%` 
                      }}
                    />
                    <span className={`absolute top-0.5 text-[9px] scale-[0.85] transform origin-left ${ttftRejected ? 'text-red-500 font-bold' : 'text-slate-400'}`} style={{ left: `${(dnsAndTcp / total) * 100 + 1}%` }}>
                      首字延迟 (TTFT) {ttftRejected ? '⚠️ 违规' : '✅ 正常'}
                    </span>
                  </div>
                </div>

                {/* Generation - Decode */}
                <div className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-3 text-slate-500 font-semibold truncate flex items-center gap-1">
                    <span>流式词元吞吐 (Decode)</span>
                  </div>
                  <div className="col-span-1 text-slate-700 font-semibold text-right">
                    {generation}ms
                  </div>
                  <div className="col-span-8 bg-slate-200/60 h-3.5 rounded-md overflow-hidden relative">
                    <div 
                      className="bg-emerald-500 h-full" 
                      style={{ 
                        marginLeft: `${(log.ttftMs / total) * 100}%`,
                        width: `${Math.max((generation / total) * 100, 2.5)}%` 
                      }}
                    />
                    <span className={`absolute top-0.5 text-[9px] scale-[0.85] transform origin-left ${tpsRejected ? 'text-red-500 font-bold' : 'text-slate-400'}`} style={{ left: `${(log.ttftMs / total) * 100 + 1}%` }}>
                      {log.tps} Tokens/s {tpsRejected ? '⚠️ 吞吐低' : '✅ 正常'}
                    </span>
                  </div>
                </div>

                {/* Grand Total */}
                <div className="border-t border-slate-200/60 pt-2 mt-2 flex justify-between items-center text-xs text-gray-500 font-sans">
                  <span>总计端到端耗时 (E2E Latency)</span>
                  <span className={`font-mono font-bold text-sm ${latencyRejected ? 'text-rose-600' : 'text-teal-600'}`}>
                    {log.totalLatencyMs} ms {latencyRejected && '(⚠️ 超过 SLA 规定上限)'}
                  </span>
                </div>

              </div>
            ) : (
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-start gap-2.5 text-xs text-rose-800">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5 animate-bounce" />
                <div>
                  <h4 className="font-semibold">接口探测执行阻断 (Fatal Connection Failure)</h4>
                  <p className="text-[11px] text-rose-700 mt-1 leading-relaxed">
                    物理探测服务器未能获得大模型响应结果。可能原因包括内网 DNS 解析失败、IP 端口受防火墙隔离拒接 或 GPU 推理机显存不足 (OOM) 导致网关报错。
                  </p>
                  <p className="mt-2 font-mono bg-rose-950 text-rose-200 p-2 rounded-lg text-[10px] break-all border border-rose-900">
                    Error Log: {log.errorMsg || 'HTTP Code ' + log.statusCode + ' - Bad Gateway Internal Errors'}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* API Request JSON Body snippet */}
            <div className="space-y-1.5 flex flex-col">
              <label className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                <FileJson2 className="w-3.5 h-3.5 text-blue-500" />
                <span>拨测拨发报文载荷 JSON Request Payload</span>
              </label>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-[11px] font-mono text-gray-300 flex-1 overflow-x-auto min-h-[140px]">
                <pre>{JSON.stringify(rawRequestPayload, null, 2)}</pre>
              </div>
            </div>

            {/* Model Response Content stream simulated text */}
            <div className="space-y-1.5 flex flex-col">
              <label className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                <Cpu className="w-3.5 h-3.5 text-emerald-500" />
                <span>返回词元输出报文 Response Stream Content</span>
              </label>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-[11px] font-mono text-gray-300 flex-1 overflow-y-auto min-h-[140px] flex flex-col justify-between">
                {log.success ? (
                  <div className="space-y-2">
                    <p className="text-emerald-300">"content": "{log.responseExcerpt || log.responseText}"</p>
                    <p className="text-slate-500 text-[10px]">
                      // SSE streams closed successfully.<br />
                      // Total Tokens: {log.tokensCount} | Average Decoding Speed: {log.tps} tokens/sec.
                      <br />
                      // Token Count Source: {log.tokenCountSource || 'estimated'} | Trigger: {log.trigger || 'scheduled'}.
                    </p>
                  </div>
                ) : (
                  <p className="text-rose-400 italic">
                    // No output tokens generated. Connection terminated.
                  </p>
                )}
                {log.success && (
                  <div className="border-t border-slate-800 pt-2 mt-2 text-[9px] text-gray-500 flex justify-between">
                    <span>HTTP 200 OK</span>
                    <span>openai-protocol-v1</span>
                  </div>
                )}
              </div>
            </div>

          </div>

        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-gray-100 flex justify-end rounded-b-3xl bg-gray-50/20">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs sm:text-sm font-semibold text-white bg-slate-950 hover:bg-slate-800 rounded-xl cursor-pointer transition-colors"
          >
            关闭诊断面板
          </button>
        </div>

      </div>
    </div>
  );
}
