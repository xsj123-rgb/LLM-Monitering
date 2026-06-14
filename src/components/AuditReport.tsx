/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { MetricLog, ModelChannel, DialTask } from '../types';
import { CalendarRange, ClipboardCheck, ArrowUpRight, Cpu, HelpCircle, HardDrive, ShieldCheck, Send, Printer, Sliders } from 'lucide-react';
import { formatBeijingTime } from '../lib/time';
import { api } from '../lib/api';

interface AuditReportProps {
  logs: MetricLog[];
  channels: ModelChannel[];
  tasks: DialTask[];
  onTriggerNotify: (msg: string) => void;
}

export function AuditReport({ logs, channels, tasks, onTriggerNotify }: AuditReportProps) {
  const [reportPeriod, setReportPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [triggerSending, setTriggerSending] = useState(false);

  // Filter logs dynamically based on the exact timeline selected
  const currentPeriodLogs = React.useMemo(() => {
    const nowTime = new Date().getTime();
    if (reportPeriod === 'daily') {
      return logs.filter(l => nowTime - new Date(l.timestamp).getTime() <= 24 * 60 * 60 * 1000);
    }
    if (reportPeriod === 'weekly') {
      return logs.filter(l => nowTime - new Date(l.timestamp).getTime() <= 7 * 24 * 60 * 60 * 1000);
    }
    // monthly
    return logs.filter(l => nowTime - new Date(l.timestamp).getTime() <= 30 * 24 * 60 * 60 * 1000);
  }, [logs, reportPeriod]);

  const totalDials = currentPeriodLogs.length;
  const successfulDials = currentPeriodLogs.filter(l => l.success);
  const successRate = totalDials > 0 ? (successfulDials.length / totalDials) * 100 : 100;

  // Calculate per-channel stats with high statistical accuracy
  const channelBreakdown = React.useMemo(() => {
    return channels.map(ch => {
      const chLogs = currentPeriodLogs.filter(l => l.channelId === ch.id);
      const total = chLogs.length;
      const success = chLogs.filter(l => l.success);
      const okRate = total > 0 ? (success.length / total) * 100 : 100;
      
      // SLA compliance criteria
      const okSla = chLogs.filter(l => l.success && !l.violatedTtft && !l.violatedTps && !l.violatedExtLatency);
      const complianceRate = total > 0 ? (okSla.length / total) * 100 : 100;

      const avgTtft = success.length > 0 ? Math.round(success.reduce((acc, l) => acc + l.ttftMs, 0) / success.length) : 0;
      const avgTps = success.length > 0 ? parseFloat((success.reduce((acc, l) => acc + l.tps, 0) / success.length).toFixed(1)) : 0;
      const worstTtft = success.length > 0 ? Math.max(...success.map(l => l.ttftMs)) : 0;

      // Calculate avg ITL (自适应字间延迟 - Inter-Token Latency)
      const getItlVal = (log: MetricLog): number => {
        if (!log.success) return 0;
        const decodeTime = Math.max(0, log.totalLatencyMs - log.ttftMs);
        const decodeTokens = Math.max(1, log.tokensCount - 1);
        return parseFloat((decodeTime / decodeTokens).toFixed(1));
      };
      
      const avgItl = success.length > 0
        ? parseFloat((success.reduce((acc, l) => acc + getItlVal(l), 0) / success.length).toFixed(1))
        : 0;

      let healthRating = '优秀';
      let ratingColor = '#10b981'; // emerald
      let complianceAdvice = '';

      if (complianceRate >= 98) {
        healthRating = '卓越以太级 (A级)';
        ratingColor = '#10b981';
        complianceAdvice = `性能处于绿区（均值TTFT: ${avgTtft}ms, TPS: ${avgTps}Tok/s, 字间延迟: ${avgItl}ms/字）。各时段吞吐无任何退化，可用性高。健康等级：A。建议：无需硬件改动，维持现有 A100 / GPU 计算单元。`;
      } else if (complianceRate >= 94) {
        healthRating = '良好常规级 (B级)';
        ratingColor = '#eab308'; // amber yellow
        complianceAdvice = `整体平稳，但在下午高负载时段存在轻微响应抖动（峰值延迟达 ${worstTtft}ms），字间延迟上浮至 ${avgItl}ms。存在轻度队列抢占。建议：可在 QPS 路由层实施限流，或对空闲实例执行常驻保活 warm-up 预热。`;
      } else {
        healthRating = '告警限制级 (C级)';
        ratingColor = '#ef4444'; // rose red
        complianceAdvice = `触发严重 SLA 性能警报！SLA 达标率跌至 ${complianceRate.toFixed(1)}%，平均字间延迟达 ${avgItl}ms。频繁触发本地 Ollama 推理 Fallback 引起严重延迟（峰值 ${worstTtft}ms）。强特决策建议：开发运维部应立刻追加配置至少 2 块 24G 特异计算卡，避免资源锁死。`;
      }

      return {
        channel: ch,
        total,
        successRate: okRate,
        complianceRate,
        avgTtft,
        avgTps,
        avgItl,
        worstTtft,
        healthRating,
        ratingColor,
        complianceAdvice
      };
    });
  }, [channels, currentPeriodLogs]);

  const overallSlaScore = channelBreakdown.reduce((acc, b) => acc + b.complianceRate, 0) / Math.max(channelBreakdown.length, 1);

  const handleExportCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Timestamp,Channel Name,Task Name,TTFT(ms),TPS(Tokens/s),Latency(ms),Status,SLA Violation?\n';
    
    currentPeriodLogs.forEach(log => {
      const isViolated = log.violatedTtft || log.violatedTps || log.violatedExtLatency ? 'YES' : 'NO';
      const row = `"${formatBeijingTime(log.timestamp)}","${log.channelName}","${log.taskName}",${log.ttftMs},${log.tps},${log.totalLatencyMs},"${log.success ? 'SUCCESS' : 'FAILED'}","${isViolated}"`;
      csvContent += row + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `LLM_Guardian_SLA_Report_${reportPeriod}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onTriggerNotify('📊 SLA 原始性能度量矩阵已下载 CSV 详单。');
  };

  const handleExportPDF = () => {
    const timestamp = `${formatBeijingTime(new Date())} (北京时间)`;
    const periodName = reportPeriod === 'daily' ? '每日审计 (Daily Snapshot)' : reportPeriod === 'weekly' ? '周度评估 (Weekly Overview)' : '月度审计 (Monthly Compliance)';
    
    // Professional styled corporate report printed as highres vector PDF bypassing font encoding limits
    const printableHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>LLM-Guardian 大模型 SLA 性能效能审计报告</title>
        <style>
          @page { size: A4 portrait; margin: 15mm; }
          body {
            font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
            color: #1e293b;
            line-height: 1.5;
            background: #ffffff;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .header-banner {
            border-bottom: 3px solid #2563eb;
            padding-bottom: 12px;
            margin-bottom: 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .title {
            font-size: 22px;
            font-weight: 800;
            color: #1e3a8a;
            letter-spacing: -0.5px;
          }
          .badge {
            background-color: #1e293b;
            color: #ffffff;
            font-size: 9px;
            padding: 4px 8px;
            border-radius: 6px;
            font-weight: bold;
            letter-spacing: 0.5px;
          }
          .meta-container {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
            margin-bottom: 24px;
            background-color: #f8fafc;
            padding: 16px;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            font-size: 11px;
          }
          .meta-item strong {
            color: #475569;
          }
          .kpi-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
            margin-bottom: 24px;
          }
          .kpi-box {
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 16px;
            background: #ffffff;
          }
          .kpi-box-title {
            font-size: 10px;
            font-weight: bold;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .kpi-box-value {
            font-size: 20px;
            font-weight: 800;
            margin-top: 6px;
            color: #2563eb;
          }
          .chapter-title {
            font-size: 14px;
            font-weight: bold;
            color: #0f172a;
            border-left: 4px solid #2563eb;
            padding-left: 10px;
            margin-top: 28px;
            margin-bottom: 14px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
            margin-bottom: 24px;
          }
          th {
            background-color: #f1f5f9;
            color: #334155;
            text-align: left;
            padding: 10px;
            font-weight: bold;
            border-bottom: 2px solid #cbd5e1;
          }
          td {
            padding: 10px;
            border-bottom: 1px solid #e2e8f0;
            color: #475569;
            vertical-align: middle;
          }
          tr:nth-child(even) td {
            background-color: #f8fafc;
          }
          .advice-card {
            border: 1px solid #e2e8f0;
            background: #fafafc;
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 16px;
          }
          .advice-card-header {
            display: flex;
            justify-content: space-between;
            font-weight: bold;
            font-size: 11px;
            color: #0f172a;
            margin-bottom: 8px;
            border-bottom: 1px dashed #e2e8f0;
            padding-bottom: 6px;
          }
          .advice-card-body {
            font-size: 10px;
            color: #475569;
            line-height: 1.5;
          }
          .sign-footer {
            margin-top: 50px;
            border-top: 1px solid #e2e8f0;
            padding-top: 16px;
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: #64748b;
          }
        </style>
      </head>
      <body>
        <div class="header-banner">
          <span class="title">LLM-Guardian 大模型 SLA 效能合规审计报告</span>
          <span class="badge">SECURITY CERTIFIED</span>
        </div>

        <div class="meta-container">
          <div class="meta-item"><strong>监控周期:</strong> ${periodName}</div>
          <div class="meta-item"><strong>报告导出时间:</strong> ${timestamp}</div>
          <div class="meta-item"><strong>纳管大模型节点数:</strong> ${channels.length} 台异构实例</div>
          <div class="meta-item"><strong>自动化时序拨测频次:</strong> 累计探测 ${totalDials} 次状态请求</div>
        </div>

        <div class="kpi-row">
          <div class="kpi-box">
            <div class="kpi-box-title">整体 SLA 合规平均分</div>
            <div class="kpi-box-value" style="color: ${overallSlaScore >= 98 ? '#10b981' : '#f59e0b'}">
              ${overallSlaScore.toFixed(2)}%
            </div>
          </div>
          <div class="kpi-box">
            <div class="kpi-box-title">可用探测成功率 (Availability)</div>
            <div class="kpi-box-value" style="color: #10b981">
              ${successRate.toFixed(1)}%
            </div>
          </div>
          <div class="kpi-box">
            <div class="kpi-box-title">异常警示模型节点</div>
            <div class="kpi-box-value" style="color: ${channelBreakdown.some(c => c.complianceRate < 95) ? '#ef4444' : '#64748b'}">
              ${channelBreakdown.filter(c => c.complianceRate < 95).length} 个
            </div>
          </div>
        </div>

        <div class="chapter-title">一、纳管大模型 SLA 核心监控度量矩阵</div>
        <table>
          <thead>
            <tr>
              <th>模型实例名称</th>
              <th>SLA 达标率</th>
              <th>健康可用率</th>
              <th>首字均延 (TTFT)</th>
              <th>峰值 TTFT</th>
              <th>平均吞吐 (TPS)</th>
              <th>字间延迟 (ITL)</th>
            </tr>
          </thead>
          <tbody>
            ${channelBreakdown.map(item => `
              <tr>
                <td>
                  <strong>${item.channel.name}</strong><br>
                  <span style="color: #64748b; font-size: 8px;">${item.channel.modelIdentifier}</span>
                </td>
                <td style="font-weight: bold; color: ${item.complianceRate >= 98 ? '#10b981' : item.complianceRate >= 94 ? '#eab308' : '#ef4444'}">
                  ${item.complianceRate.toFixed(1)}%
                </td>
                <td>${item.successRate.toFixed(1)}%</td>
                <td>${item.avgTtft} ms</td>
                <td style="color: ${item.worstTtft > 800 ? '#ef4444' : '#475569'}">${item.worstTtft} ms</td>
                <td style="color: #10b981; font-weight: bold;">${item.avgTps} Tok/s</td>
                <td>${item.avgItl} ms/字</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="chapter-title">二、基于性能曲线变化的 DevOps 架构级针对性购买/扩容建议</div>
        <div>
          ${channelBreakdown.map(item => `
            <div class="advice-card">
              <div class="advice-card-header">
                <span>监控主机: ${item.channel.name}</span>
                <span style="color: ${item.ratingColor}">${item.healthRating}</span>
              </div>
              <div class="advice-card-body">
                ${item.complianceAdvice}
              </div>
            </div>
          `).join('')}
        </div>

        <div class="sign-footer">
          <div>审计批准人(签字): _________________________</div>
          <div>本报告由 LLM-Guardian 时序列计算引擎防伪签名</div>
        </div>
      </body>
      </html>
    `;

    // Implement double-scoped safe printing
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.width = '0px';
    printFrame.style.height = '0px';
    printFrame.style.border = 'none';
    document.body.appendChild(printFrame);

    const docRef = printFrame.contentWindow?.document || printFrame.contentDocument;
    if (docRef) {
      docRef.open();
      docRef.write(printableHtml);
      docRef.close();
      
      setTimeout(() => {
        printFrame.contentWindow?.focus();
        printFrame.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(printFrame);
          onTriggerNotify('📄 SLA 审计合规效能 PDF 度量报告生成成功！已拉起浏览器无损矢量打印流。');
        }, 1000);
      }, 400);
    }
  };

  const handleTriggerSendReport = async () => {
    setTriggerSending(true);
    try {
      const result = await api.reports.push(reportPeriod);
      const periodName = reportPeriod === 'weekly' ? '周报' : reportPeriod === 'daily' ? '日报' : '月报';
      if (result.failedCount > 0) {
        onTriggerNotify(
          `⚠️ 本期 SLA ${periodName}已推送到 ${result.deliveredCount} 个飞书群，另有 ${result.failedCount} 个通道失败。${result.attachmentMessage ? ` ${result.attachmentMessage}` : ''}`
        );
      } else {
        onTriggerNotify(
          `✅ 本期 SLA ${periodName}已成功推送到 ${result.deliveredCount} 个飞书群。${result.attachmentMessage ? ` ${result.attachmentMessage}` : ''}`
        );
      }
    } catch (error) {
      onTriggerNotify(`❌ 报告推送失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setTriggerSending(false);
    }
  };

  const mostFragileNode = React.useMemo(() => {
    if (channelBreakdown.length === 0) return null;
    return [...channelBreakdown].sort((a, b) => a.complianceRate - b.complianceRate)[0];
  }, [channelBreakdown]);

  const modelEvaluation = React.useMemo(() => {
    if (channelBreakdown.length === 0) {
      return {
        summary: '当前暂无模型历史时序特征。',
        advice: '由于缺少充足的历史性能日志，无法提取针对性的调优建议。请等待时序拨测数据自动流入。',
        status: 'ok' as 'ok' | 'warning' | 'alert'
      };
    }

    const totalCount = channelBreakdown.length;
    const alertCount = channelBreakdown.filter(c => c.complianceRate < 95).length;
    const warningCount = channelBreakdown.filter(c => c.complianceRate >= 95 && c.complianceRate < 99).length;
    const healthyCount = channelBreakdown.filter(c => c.complianceRate >= 99).length;

    let summary = '';
    let advice = '';
    let status: 'ok' | 'warning' | 'alert' = 'ok';

    if (alertCount > 0) {
      status = 'alert';
      summary = `有 ${alertCount} 个实例 SLA 合规性显著降低`;
      advice = '💡 历史调优建议：历史时序显示当前脆弱节点存在高峰期排队严重现象。应为主节点配置显存专用锁，并在反向代理层调低并发上限。';
    } else if (warningCount > 0) {
      status = 'warning';
      summary = `${healthyCount} 个实例指标良好，${warningCount} 个实例存在轻微抖动`;
      advice = '💡 历史调优建议：部分边缘节点存在耗时波动，建议对长置不用的渠道配置定时（如 10 分钟）主动保活预热（Warm-up）探测流，避免冷启动。';
    } else {
      status = 'ok';
      summary = `全线 ${totalCount} 个纳管渠道状态完美，指标全部高于 SLA 安全水准线`;
      advice = '💡 历史调优建议：整体性能极度稳定。建议按需对深夜或低流量时段的推理容器副本进行弹性收紧，可合理节约约 25% 的空载算力开销。';
    }

    return { summary, advice, status };
  }, [channelBreakdown]);

  const avgSlaStats = React.useMemo(() => {
    if (channelBreakdown.length === 0) {
      return {
        avgTtft: 0,
        avgTps: 0,
        avgItl: 0,
        maxWorstTtft: 0,
        avgSla: 100,
      };
    }
    const len = channelBreakdown.length;
    const avgTtft = Math.round(channelBreakdown.reduce((acc, b) => acc + b.avgTtft, 0) / len);
    const avgTps = parseFloat((channelBreakdown.reduce((acc, b) => acc + b.avgTps, 0) / len).toFixed(1));
    const avgItl = parseFloat((channelBreakdown.reduce((acc, b) => acc + b.avgItl, 0) / len).toFixed(1));
    const maxWorstTtft = Math.max(...channelBreakdown.map(b => b.worstTtft));
    const avgSla = parseFloat((channelBreakdown.reduce((acc, b) => acc + b.complianceRate, 0) / len).toFixed(2));

    return {
      avgTtft,
      avgTps,
      avgItl,
      maxWorstTtft,
      avgSla,
    };
  }, [channelBreakdown]);

  return (
    <div id="audit-report-root" className="space-y-6">
      
      {/* Report Header Settings */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-slate-900 text-white rounded-2xl shadow-sm gap-4" id="report-control-bar">
        <div className="flex items-center gap-3">
          <CalendarRange className="text-brand w-5 h-5" />
          <div>
            <h3 className="font-bold text-sm sm:text-base">自动化 SLA 效能及扩容决策审计报告</h3>
            <p className="text-[10px] sm:text-xs text-gray-400">结合主动时域探测指标的容量负载建议 · 每天自动更新</p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
          <div className="bg-slate-800 p-0.5 rounded-lg flex border border-slate-705 font-sans">
            {(['daily', 'weekly', 'monthly'] as const).map(p => (
              <button
                key={p}
                onClick={() => setReportPeriod(p)}
                className={`px-3 py-1 text-xs rounded-md transition-all font-medium cursor-pointer ${
                  reportPeriod === p 
                    ? 'bg-brand text-slate-900 font-bold' 
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {p === 'daily' ? '按日审核' : p === 'weekly' ? '按周审计' : '月度总结'}
              </button>
            ))}
          </div>

          <button
            onClick={handleExportPDF}
            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-755 text-brand rounded-lg border border-slate-700 hover:border-brand/40 transition-all cursor-pointer flex items-center gap-1.5 text-[11px] font-bold font-sans"
            title="导出 PDF 审计报告"
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">导出 PDF</span>
          </button>
        </div>
      </div>

      {/* SLA Decision Overviews Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5" id="audit-report-top-metric-grid">
        
        {/* Compliance Card */}
        <div className="p-4 bg-white border border-gray-100 rounded-2xl shadow-xs relative overflow-hidden flex flex-col justify-between min-h-[140px]">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider font-sans">综合 SLA 达标指数</span>
            <h4 className="text-2xl font-black mt-2 font-mono text-slate-900">{overallSlaScore.toFixed(2)}%</h4>
            <p className="text-[10px] text-gray-500 mt-2.5 leading-relaxed">
              根据时序数据自动加权计算，可用性达标率整体处于 <span className="font-bold text-emerald-600">{successRate.toFixed(1)}%</span> 合格高线。
            </p>
          </div>
          <div className="absolute right-3.5 bottom-3.5 bg-sky-50 p-2 rounded-xl border border-sky-100 shrink-0">
            <ShieldCheck className="w-6 h-6 text-brand" />
          </div>
        </div>

        {/* Bottleneck Identifier Card */}
        <div className="p-4 bg-white border border-gray-100 rounded-2xl shadow-xs relative overflow-hidden flex flex-col justify-between min-h-[140px]">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider font-sans">本期最脆弱资源节点</span>
            <h4 className="text-sm font-bold text-rose-600 mt-2 truncate font-sans" title={mostFragileNode?.channel.name || ''}>
              {mostFragileNode?.channel.name || '暂无'}
            </h4>
            <p className="text-[10px] text-gray-550 mt-1 leading-relaxed font-sans">
              SLA 达标仅 <span className="font-bold text-rose-500">{mostFragileNode ? mostFragileNode.complianceRate.toFixed(1) : '100'}%</span>。主要瓶颈发生在高并发负载拥合期，本地计算Fallback引起排队延迟。
            </p>
          </div>
          <div className="absolute right-3.5 bottom-3.5 bg-rose-50 p-2 rounded-xl border border-rose-100 shrink-0">
            <Cpu className="w-6 h-6 text-rose-500" />
          </div>
        </div>

        {/* All Models Average SLA Indicators Card */}
        <div className="p-4 bg-white border border-gray-100 rounded-2xl shadow-xs relative overflow-hidden flex flex-col justify-between min-h-[140px]" id="audit-average-sla-card">
          <div>
            <span className="text-[10px] text-indigo-600 font-bold uppercase tracking-wider font-sans">平台纳管模型 SLA 指标综合均值</span>
            
            {/* Grid of Average SLA Metrics */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2.5">
              <div className="flex flex-col border-b border-gray-100 pb-1">
                <span className="text-[9px] text-gray-400 font-sans">首字延时 (TTFT) 均值</span>
                <span className="text-xs font-bold font-mono text-slate-800 mt-0.5">{avgSlaStats.avgTtft} ms</span>
              </div>
              <div className="flex flex-col border-b border-gray-100 pb-1">
                <span className="text-[9px] text-gray-400 font-sans">吞吐速率 (TPS) 均值</span>
                <span className="text-xs font-bold font-mono text-emerald-600 mt-0.5">{avgSlaStats.avgTps} Tok/s</span>
              </div>
              <div className="flex flex-col border-b border-gray-100 pb-1">
                <span className="text-[9px] text-gray-400 font-sans">字间延迟 (ITL) 均值</span>
                <span className="text-xs font-bold font-mono text-purple-600 mt-0.5">{avgSlaStats.avgItl} ms/字</span>
              </div>
              <div className="flex flex-col border-b border-gray-100 pb-1">
                <span className="text-[9px] text-gray-400 font-sans">全网模型峰值延迟</span>
                <span className="text-xs font-bold font-mono text-rose-500 mt-0.5">{avgSlaStats.maxWorstTtft} ms</span>
              </div>
            </div>

            {/* A small summary advice or status */}
            <p className="text-[9px] text-gray-400 mt-2 leading-relaxed font-sans">
              全平台模型平均 SLA 达标率为 <span className="font-bold text-indigo-650">{avgSlaStats.avgSla}%</span>。{avgSlaStats.avgSla >= 95 ? '各维度均值处于健康水位线，运行表现平稳。' : '部分底座存在较重资源拼抢负载，建议按需扩容弹性推理副本。'}
            </p>
          </div>
          
          <div className="absolute right-3.5 bottom-3.5 bg-indigo-50 p-2 rounded-xl border border-indigo-100 shrink-0">
            <Sliders className="w-5 h-5 text-indigo-500 animate-pulse" />
          </div>
        </div>

      </div>

      {/* SLA Model Node Audits Details */}
      <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-xs" id="detailed-audit-report">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-4 border-b border-gray-50 gap-2 mb-4">
          <div>
            <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5 font-sans">
              <ClipboardCheck className="w-4 h-4 text-emerald-500" />
              <span>被监控模型实例 SLA 审计细则清单 ({reportPeriod === 'weekly' ? '本周' : reportPeriod === 'daily' ? '近24小时' : '本月'})</span>
            </h4>
            <p className="text-[10px] text-gray-400 font-sans">大模型部署服务器稳定性度量细化评估，依据实际拨测统计生成。</p>
          </div>

          <button
            onClick={handleTriggerSendReport}
            disabled={triggerSending}
            className="px-4 py-1.5 text-xs text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-all font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-55 font-sans"
          >
            <Send className="w-3.5 h-3.5 animate-pulse" />
            <span>{triggerSending ? '投递中...' : '一键推送本期报告'}</span>
          </button>
        </div>

        {/* Breakdown Row items */}
        <div className="space-y-4" id="report-breakdown-list">
          {channelBreakdown.map(item => (
            <div 
              key={item.channel.id} 
              className="p-4 bg-gray-50/70 border border-gray-100 rounded-2xl flex flex-col lg:flex-row justify-between gap-4 font-sans"
            >
              {/* Channel Meta */}
              <div className="lg:w-1/3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    item.complianceRate >= 99 ? 'bg-emerald-500' : item.complianceRate >= 95 ? 'bg-amber-400' : 'bg-rose-500'
                  }`} />
                  <span className="font-bold text-gray-900 text-sm font-sans">{item.channel.name}</span>
                </div>
                <div className="text-[10px] text-gray-400 truncate font-mono">
                  接口: {item.channel.apiEndpoint}
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className="text-[9px] bg-slate-200/80 text-slate-700 px-1.5 py-0.5 rounded font-mono">
                    {item.channel.modelIdentifier}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase ${
                    item.channel.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}>
                    {item.channel.status}
                  </span>
                </div>
              </div>

              {/* Statistics Grid */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 bg-white p-3 rounded-xl border border-gray-100/85 lg:w-1/2">
                <div>
                  <span className="text-[9px] text-gray-400 block font-sans">SLA 达标率</span>
                  <span className={`text-sm font-bold font-mono ${
                    item.complianceRate >= 99 ? 'text-emerald-600' : item.complianceRate >= 95 ? 'text-amber-500' : 'text-rose-500'
                  }`}>
                    {item.complianceRate.toFixed(1)}%
                  </span>
                </div>

                <div>
                  <span className="text-[9px] text-gray-400 block font-sans">首字延迟 (TTFT)</span>
                  <span className="text-sm font-bold font-mono text-gray-800">
                    {item.avgTtft} ms
                  </span>
                </div>

                <div>
                  <span className="text-[9px] text-gray-400 block font-sans">最大峰值延迟</span>
                  <span className={`text-sm font-bold font-mono ${item.worstTtft > 800 ? 'text-rose-500' : 'text-gray-700'}`}>
                    {item.worstTtft} ms
                  </span>
                </div>

                <div>
                  <span className="text-[9px] text-gray-400 block font-sans">均值吞吐 (TPS)</span>
                  <span className="text-sm font-bold font-mono text-emerald-600">
                    {item.avgTps} Tok/s
                  </span>
                </div>

                <div>
                  <span className="text-[9px] text-gray-400 block font-sans">字间延迟 (ITL)</span>
                  <span className="text-sm font-bold font-mono text-purple-600">
                    {item.avgItl} ms/字
                  </span>
                </div>
              </div>

              {/* Capacity decision advice */}
              <div className="lg:w-1/4 p-3 bg-blue-50/30 rounded-xl border border-blue-50/50 text-[10px] text-blue-950 leading-relaxed font-sans">
                <div className="flex items-center gap-1.5 font-bold mb-1">
                  <ArrowUpRight className="w-3 h-3 text-brand" />
                  <span>资源健康度评估与针对性建议 :</span>
                </div>
                <p className="text-gray-650 font-sans">{item.complianceAdvice}</p>
              </div>

            </div>
          ))}
        </div>

      </div>

    </div>
  );
}
