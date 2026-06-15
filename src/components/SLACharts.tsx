/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { MetricLog, SLAThresholds } from '../types';
import { formatBeijingTime, getBeijingDateInputMax, getBeijingDateParts } from '../lib/time';

interface SLAChartsProps {
  logs: MetricLog[];
  channelId?: string;
  thresholds?: SLAThresholds;
}

export function SLACharts({ logs, channelId, thresholds }: SLAChartsProps) {
  // --- States for customization ---
  const [selectedMetrics, setSelectedMetrics] = useState<('ttft' | 'tps' | 'itl' | 'e2e')[]>(['tps', 'ttft']);
  const [timeRange, setTimeRange] = useState<'2h' | '24h' | '7d' | '30d' | 'custom'>('24h');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [smooth, setSmooth] = useState(true);

  // --- Hover Interaction ---
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  // Resize monitor for responsive SVG
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setWidth(entry.contentRect.width || 600);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // --- Filtering by channel and selected time period ---
  const channelFilteredLogs = channelId 
    ? logs.filter(l => l.channelId === channelId) 
    : logs;

  const now = new Date();
  const timeFilteredLogs = channelFilteredLogs.filter(log => {
    const logTime = new Date(log.timestamp).getTime();
    if (timeRange === '2h') {
      return now.getTime() - logTime <= 2 * 60 * 60 * 1000;
    }
    if (timeRange === '24h') {
      return now.getTime() - logTime <= 24 * 60 * 60 * 1000;
    }
    if (timeRange === '7d') {
      return now.getTime() - logTime <= 7 * 24 * 60 * 60 * 1000;
    }
    if (timeRange === '30d') {
      return now.getTime() - logTime <= 30 * 24 * 60 * 60 * 1000;
    }
    if (timeRange === 'custom') {
      if (!customStart) return true;
      const startMs = new Date(customStart + 'T00:00:00').getTime();
      const endMs = customEnd 
        ? new Date(customEnd + 'T23:59:59').getTime() 
        : now.getTime();
      return logTime >= startMs && logTime <= endMs;
    }
    return true;
  });

  // Sort chronological for charting
  const sortedLogs = [...timeFilteredLogs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Helper calculation for ITL (自适应字间延迟, Inter-Token Latency)
  const getItlVal = (log: MetricLog): number => {
    if (!log.success) return 0;
    const decodeTime = Math.max(0, log.totalLatencyMs - log.ttftMs);
    const decodeTokens = Math.max(1, log.tokensCount - 1);
    return parseFloat((decodeTime / decodeTokens).toFixed(1));
  };

  // KPI Calculations
  const totalCount = timeFilteredLogs.length;
  const successLogs = timeFilteredLogs.filter(l => l.success);
  const successRate = totalCount > 0 ? (successLogs.length / totalCount) * 100 : 100;
  
  const slaComplianceLogs = timeFilteredLogs.filter(
    l => l.success && !l.violatedTtft && !l.violatedTps && !l.violatedExtLatency
  );
  const slaComplianceRate = totalCount > 0 ? (slaComplianceLogs.length / totalCount) * 100 : 100;

  const avgTtft = successLogs.length > 0
    ? Math.round(successLogs.reduce((acc, l) => acc + l.ttftMs, 0) / successLogs.length)
    : 0;
  
  const avgTps = successLogs.length > 0
    ? parseFloat((successLogs.reduce((acc, l) => acc + l.tps, 0) / successLogs.length).toFixed(1))
    : 0;

  const avgItl = successLogs.length > 0
    ? parseFloat((successLogs.reduce((acc, l) => acc + getItlVal(l), 0) / successLogs.length).toFixed(1))
    : 0;

  const avgE2E = successLogs.length > 0
    ? Math.round(successLogs.reduce((acc, l) => acc + l.totalLatencyMs, 0) / successLogs.length)
    : 0;

  // --- Visual Downsampling for line chart density control ---
  const getSampledLogs = (allSorted: MetricLog[], maxPoints = 35) => {
    if (allSorted.length <= maxPoints) return allSorted;
    const sampled: MetricLog[] = [];
    const step = allSorted.length / maxPoints;
    for (let i = 0; i < maxPoints; i++) {
      const index = Math.floor(i * step);
      sampled.push(allSorted[index]);
    }
    // Safeguard last element
    if (sampled[sampled.length - 1] !== allSorted[allSorted.length - 1]) {
      sampled[sampled.length - 1] = allSorted[allSorted.length - 1];
    }
    return sampled;
  };

  const chartLogs = getSampledLogs(sortedLogs, 35);

  if (sortedLogs.length === 0) {
    return (
      <div className="space-y-6">
        {/* Render selection header anyway so they can change time range if 0 values */}
        {renderControlPanel()}
        <div className="flex flex-col items-center justify-center h-72 border border-dashed border-gray-200 rounded-2xl bg-gray-50/50">
          <p className="text-sm text-gray-500 font-medium">所选时间范围内暂无探测数据</p>
          <p className="text-xs text-gray-400 mt-1">请尝试放宽探测筛选器或调大时间范围</p>
        </div>
      </div>
    );
  }

  // --- Plotting helpers ---
  const height = 150;
  const paddingLeft = 45;
  const paddingRight = 15;
  const paddingTop = 15;
  const paddingBottom = 22;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const getX = (index: number) => {
    if (chartLogs.length <= 1) return paddingLeft;
    return paddingLeft + (index / (chartLogs.length - 1)) * chartWidth;
  };

  const getY = (val: number, max: number) => {
    const scaleMax = max * 1.15 || 10;
    return paddingTop + chartHeight - (val / scaleMax) * chartHeight;
  };

  // Straight lines path
  const buildPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return '';
    return points.reduce((path, pt, idx) => {
      return idx === 0 ? `M ${pt.x} ${pt.y}` : `${path} L ${pt.x} ${pt.y}`;
    }, '');
  };

  // Smoothed Monotone Tension Bezier Curves
  const buildSmoothPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let d = `M ${points[0].x} ${points[0].y}`;
    
    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      
      // Control points calculated to provide flat tension without overshoot
      const cpX1 = curr.x + (next.x - curr.x) / 3;
      const cpY1 = curr.y;
      const cpX2 = curr.x + 2 * (next.x - curr.x) / 3;
      const cpY2 = next.y;
      
      d += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${next.x} ${next.y}`;
    }
    return d;
  };

  const buildAreaPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return '';
    const startX = points[0].x;
    const endX = points[points.length - 1].x;
    const baseLineY = paddingTop + chartHeight;
    const linePath = smooth ? buildSmoothPath(points) : buildPath(points);
    return `${linePath} L ${endX} ${baseLineY} L ${startX} ${baseLineY} Z`;
  };

  // Coordinates mapping logic per metric
  const metricConfigs = {
    ttft: {
      key: 'ttft' as const,
      label: '首字响应延迟 (TTFT)',
      unit: 'ms',
      description: '大模型首流式 Token 输出时间，属于核心响应速度指标（Prefill）/ 毫秒。',
      color: '#3b82f6', // Bright Blue
      lightColor: '#eff6ff',
      gradientId: 'ttftGradient',
      getValue: (l: MetricLog) => l.ttftMs,
      getSlaThreshold: () => thresholds?.maxTtftMs,
      isViolation: (l: MetricLog) => l.violatedTtft,
      maxDefaultLimit: 300
    },
    tps: {
      key: 'tps' as const,
      label: '文本吞吐速率 (TPS)',
      unit: 'Tok/s',
      description: '模型处于推理生成阶段平均每秒产生的词元数量（Decode）/ Tokens每秒。',
      color: '#10b981', // Emerald
      lightColor: '#ecfdf5',
      gradientId: 'tpsGradient',
      getValue: (l: MetricLog) => l.tps,
      getSlaThreshold: () => thresholds?.minTps,
      isViolation: (l: MetricLog) => l.violatedTps,
      isBelowLimit: true, // TPS is violated when lower
      maxDefaultLimit: 25
    },
    itl: {
      key: 'itl' as const,
      label: '自适应字间延迟 (ITL)',
      unit: 'ms/Tok',
      description: '流式流失传输时，相邻字符/词元输出包之间的平均物理时差 / 毫秒每字。',
      color: '#8b5cf6', // Violet Purple
      lightColor: '#f5f3ff',
      gradientId: 'itlGradient',
      getValue: getItlVal,
      getSlaThreshold: () => thresholds ? Math.round((thresholds.maxTotalLatencyMs - thresholds.maxTtftMs) / 35) : 80,
      isViolation: (l: MetricLog) => {
        const threshold = thresholds ? (thresholds.maxTotalLatencyMs - thresholds.maxTtftMs) / 35 : 80;
        return l.success && getItlVal(l) > threshold;
      },
      maxDefaultLimit: 60
    },
    e2e: {
      key: 'e2e' as const,
      label: '端到端接口总延迟 (E2E)',
      unit: 'ms',
      description: '调用 API 请求开始到流式全部返回接收结束的总绝对时延 / 毫秒。',
      color: '#ec4899', // Pink rose
      lightColor: '#fdf2f8',
      gradientId: 'e2eGradient',
      getValue: (l: MetricLog) => l.totalLatencyMs,
      getSlaThreshold: () => thresholds?.maxTotalLatencyMs,
      isViolation: (l: MetricLog) => l.violatedExtLatency,
      maxDefaultLimit: 2200
    }
  };

  // Synchronized hover listener on SVG
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!containerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < chartLogs.length; i++) {
      const ptX = getX(i);
      const diff = Math.abs(ptX - clientX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    setHoveredIndex(closestIdx);
  };

  const activeLog = hoveredIndex !== null ? chartLogs[hoveredIndex] : null;

  // Spaced chronological timestamp labels
  const renderXLabels = () => {
    if (chartLogs.length < 2) return null;
    const labelsCount = width < 500 ? 3 : 5;
    const items: React.ReactNode[] = [];
    
    for (let i = 0; i < labelsCount; i++) {
      const idx = Math.round((i / (labelsCount - 1)) * (chartLogs.length - 1));
      const log = chartLogs[idx];
      if (!log) continue;
      const bjObj = getBeijingDateParts(log.timestamp);
      
      // format label depending on timeRange
      let labelStr = '';
      if (timeRange === '2h') {
        labelStr = `${String(bjObj.hours).padStart(2, '0')}:${String(bjObj.minutes).padStart(2, '0')}`;
      } else if (timeRange === '24h') {
        labelStr = `${String(bjObj.hours).padStart(2, '0')}:${String(bjObj.minutes).padStart(2, '0')}`;
      } else {
        labelStr = `${bjObj.month}/${bjObj.date} ${String(bjObj.hours).padStart(2, '0')}:00`;
      }
      
      items.push(
        <text 
          key={`lbl-x-${i}`} 
          x={getX(idx)} 
          y={height - 5} 
          textAnchor="middle" 
          className="text-[9px] fill-gray-400 font-mono"
        >
          {labelStr}
        </text>
      );
    }
    return items;
  };

  const activeLogBreakdown = activeLog ? {
    network: ((activeLog.dnsTimeMs + activeLog.tcpTimeMs) / Math.max(activeLog.totalLatencyMs, 10)) * 100,
    ttft: (Math.max(activeLog.ttftMs - (activeLog.dnsTimeMs + activeLog.tcpTimeMs), 0) / Math.max(activeLog.totalLatencyMs, 10)) * 100,
    decode: (Math.max(activeLog.totalLatencyMs - activeLog.ttftMs, 0) / Math.max(activeLog.totalLatencyMs, 10)) * 100
  } : null;

  return (
    <div ref={containerRef} className="w-full space-y-6">
      
      {/* Customization Controls Panel */}
      {renderControlPanel()}

      {/* KPI Cards Summary Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" id="sla-summary-cards">
        <div className="p-4 bg-white border border-gray-100 rounded-2xl shadow-xs transition-all hover:shadow-sm">
          <div className="text-xs text-gray-400 font-medium font-sans">文本吞吐速率 (TPS) 均值</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-bold tracking-tight text-gray-900 font-mono text-emerald-600">{avgTps}</span>
            <span className="text-xs text-gray-400 font-mono">Tok/s</span>
          </div>
          <div className="mt-2 text-[10px] text-gray-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>流式推理渲染速度越大越流畅</span>
          </div>
        </div>

        <div className="p-4 bg-white border border-gray-100 rounded-2xl shadow-xs transition-all hover:shadow-sm">
          <div className="text-xs text-gray-400 font-medium font-sans">首字延迟 (TTFT) 均值</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-bold tracking-tight text-gray-900 font-mono">{avgTtft}</span>
            <span className="text-xs text-gray-400 font-mono">ms</span>
          </div>
          <div className="mt-2 text-[10px] text-gray-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            <span>核心体验流畅性阈值</span>
          </div>
        </div>

        <div className="p-4 bg-white border border-gray-100 rounded-2xl shadow-xs transition-all hover:shadow-sm">
          <div className="text-xs text-gray-400 font-medium font-sans">自适应字间延迟 (ITL) 均值</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-bold tracking-tight text-gray-900 font-mono text-purple-600">{avgItl}</span>
            <span className="text-xs text-gray-400 font-mono">ms/字</span>
          </div>
          <div className="mt-2 text-[10px] text-gray-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
            <span>流式分词体验评测阈值</span>
          </div>
        </div>

        <div className="p-4 bg-white border border-gray-100 rounded-2xl shadow-xs transition-all hover:shadow-sm">
          <div className="text-xs text-gray-400 font-medium font-sans">指标区段 SLA 达标率</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className={`text-2xl font-bold tracking-tight font-mono ${slaComplianceRate >= 99 ? 'text-emerald-600' : slaComplianceRate >= 95 ? 'text-amber-500' : 'text-rose-500'}`}>
              {slaComplianceRate.toFixed(1)}%
            </span>
          </div>
          <div className="mt-2 text-[10px] text-gray-400 flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${slaComplianceRate >= 99 ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
            <span>总探测成功且非违约比例</span>
          </div>
        </div>
      </div>

      {/* Vertical Stack of Active Plotted Charts with Shared Horizontal Timeline */}
      <div className="flex flex-col gap-5" id="sla-dynamic-metric-charts">
        {selectedMetrics.map(metricKey => {
          const config = metricConfigs[metricKey];
          
          // Calculate max value for this metric map
          const maxVal = Math.max(
            ...chartLogs.map(l => config.getValue(l)),
            config.getSlaThreshold() || 0,
            config.maxDefaultLimit
          );

          const points = chartLogs.map((log, idx) => ({
            x: getX(idx),
            y: getY(config.getValue(log), maxVal),
            log,
            idx
          }));

          const successPoints = points.filter(p => p.log.success);
          const limitY = config.getSlaThreshold() ? getY(config.getSlaThreshold()!, maxVal) : null;

          return (
            <div 
              key={metricKey} 
              className="bg-white p-5 border border-gray-100 rounded-2xl shadow-xs hover:border-gray-200 transition-all"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: config.color }}></span>
                    <span>{config.label}</span>
                  </h4>
                  <p className="text-[10px] text-gray-400 mt-1">{config.description}</p>
                </div>
                {config.getSlaThreshold() && (
                  <span className="text-[9px] font-bold border rounded-lg px-2 py-0.5 tracking-wider bg-slate-50 text-gray-500 font-mono border-gray-100">
                    SLA 阈值: {config.getSlaThreshold()}{config.unit}
                  </span>
                )}
              </div>

              <div className="relative">
                <svg
                  width="100%"
                  height={height}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className="overflow-visible select-none cursor-crosshair"
                >
                  <defs>
                    <linearGradient id={config.gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={config.color} stopOpacity="0.18" />
                      <stop offset="100%" stopColor={config.color} stopOpacity="0.01" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Grids (4 steps) */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                    const yVal = ratio * maxVal * 1.15;
                    const posY = getY(yVal, maxVal);
                    return (
                      <g key={`grid-y-${metricKey}-${idx}`} className="opacity-40">
                        <line
                          x1={paddingLeft}
                          y1={posY}
                          x2={width - paddingRight}
                          y2={posY}
                          stroke="#edf2f7"
                          strokeWidth={0.8}
                          strokeDasharray="2,2"
                        />
                        <text
                          x={paddingLeft - 8}
                          y={posY + 3}
                          className="text-[8px] fill-gray-400 text-right font-mono"
                          textAnchor="end"
                        >
                          {Math.round(yVal)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Limit Reference Line */}
                  {limitY !== null && limitY > paddingTop && limitY < height - paddingBottom && (
                    <line
                      x1={paddingLeft}
                      y1={limitY}
                      x2={width - paddingRight}
                      y2={limitY}
                      stroke="#f87171"
                      strokeWidth={1.2}
                      strokeDasharray="4,2"
                      className="opacity-70"
                    />
                  )}

                  {/* Baseline X */}
                  <line
                    x1={paddingLeft}
                    y1={height - paddingBottom}
                    x2={width - paddingRight}
                    y2={height - paddingBottom}
                    stroke="#e2e8f0"
                    strokeWidth={1}
                  />

                  {/* Area fill */}
                  {successPoints.length > 0 && (
                    <path
                      d={buildAreaPath(successPoints)}
                      fill={`url(#${config.gradientId})`}
                    />
                  )}

                  {/* Smoothed or standard line stroke */}
                  {successPoints.length > 0 && (
                    <path
                      d={smooth ? buildSmoothPath(successPoints) : buildPath(successPoints)}
                      fill="none"
                      stroke={config.color}
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Dynamic failure marks */}
                  {points.map((pt, idx) => {
                    if (pt.log.success) return null;
                    return (
                      <g key={`err-${metricKey}-${idx}`} transform={`translate(${pt.x}, ${height - paddingBottom})`}>
                        <line x1={-3.5} y1={-3.5} x2={3.5} y2={3.5} stroke="#f43f5e" strokeWidth={1.5} />
                        <line x1={-3.5} y1={3.5} x2={3.5} y2={-3.5} stroke="#f43f5e" strokeWidth={1.5} />
                        <circle r={6} stroke="#f43f5e" strokeOpacity={0.25} fill="none" strokeWidth={2} />
                      </g>
                    );
                  })}

                  {/* X Axis Time Labels */}
                  {renderXLabels()}

                  {/* Value Data Nodes & Violation indicators */}
                  {points.map((pt, idx) => {
                    if (!pt.log.success) return null;
                    const val = config.getValue(pt.log);
                    const isViolated = config.isViolation(pt.log);
                    
                    return (
                      <circle
                        key={`node-${metricKey}-${idx}`}
                        cx={pt.x}
                        cy={pt.y}
                        r={hoveredIndex === idx ? 4.5 : isViolated ? 3 : 1.8}
                        fill={isViolated ? '#ef4444' : config.color}
                        stroke={hoveredIndex === idx ? '#ffffff' : 'none'}
                        strokeWidth={1.5}
                        className="transition-all"
                      />
                    );
                  })}

                  {/* Hover Guideline Tracker */}
                  {hoveredIndex !== null && (
                    <line
                      x1={getX(hoveredIndex)}
                      y1={paddingTop}
                      x2={getX(hoveredIndex)}
                      y2={height - paddingBottom}
                      stroke="#94a3b8"
                      strokeWidth={1}
                      strokeDasharray="2,2"
                    />
                  )}
                </svg>
              </div>
            </div>
          );
        })}
      </div>

      {/* Interactive Tooltip Card matching all active graphs */}
      {hoveredIndex !== null && activeLog && (
        <div 
          className="bg-slate-900 border border-slate-800 text-white p-3.5 rounded-2xl shadow-md space-y-2.5 max-w-full animate-fade-in"
          id="charts-hover-tooltip"
        >
          <div className="flex justify-between items-center border-b border-slate-800 pb-2 text-xs">
            <div className="flex items-center gap-2 font-semibold">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
              <span className="font-mono text-gray-300">
                时间点: {formatBeijingTime(activeLog.timestamp)}
              </span>
            </div>
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
              activeLog.success ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-400/20' : 'bg-rose-500/10 text-rose-300 border border-rose-400/20'
            }`}>
              {activeLog.success ? '探测成功' : '探测故障'}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
            <div>
              <span className="text-gray-400 block text-[10px]">1. 吞吐效率 (TPS) :</span>
              <span className={`font-bold ${activeLog.violatedTps ? 'text-red-400' : 'text-emerald-300'}`}>
                {activeLog.tps} Tok/s
              </span>
            </div>

            <div>
              <span className="text-gray-400 block text-[10px]">2. 首字延迟 (TTFT) :</span>
              <span className={`font-bold ${activeLog.violatedTtft ? 'text-red-400' : 'text-blue-300'}`}>
                {activeLog.ttftMs} ms
              </span>
            </div>

            <div>
              <span className="text-gray-400 block text-[10px]">3. 自适应字间延迟 (ITL) :</span>
              <span className="font-bold text-purple-300">
                {getItlVal(activeLog)} ms/字
              </span>
            </div>

            <div>
              <span className="text-gray-400 block text-[10px]">4. 端到端总消耗 (E2E) :</span>
              <span className={`font-bold ${activeLog.violatedExtLatency ? 'text-red-400' : 'text-pink-300'}`}>
                {activeLog.totalLatencyMs} ms
              </span>
            </div>
          </div>

          {activeLog.success ? (
            <div className="pt-1.5 border-t border-slate-800.5">
              <div className="text-[10px] text-gray-400 mb-1 flex justify-between">
                <span>流式分段时序耗时微观分解:</span>
                <span className="font-mono text-[9px] text-gray-500">
                  返回词元数: {activeLog.tokensCount} | 状态: OK
                </span>
              </div>
              
              {activeLogBreakdown && (
                <div className="flex h-2 w-full bg-slate-850 rounded-full overflow-hidden">
                  <div 
                    className="bg-[#c084fc] h-full" 
                    style={{ width: `${activeLogBreakdown.network}%` }}
                    title={`TCP握手网络耗时: ${(activeLog.dnsTimeMs + activeLog.tcpTimeMs)}ms`}
                  />
                  <div 
                    className="bg-[#3b82f6] h-full border-l border-slate-900" 
                    style={{ width: `${activeLogBreakdown.ttft}%` }}
                    title={`模型首字Prefill耗时: ${activeLog.ttftMs}ms`}
                  />
                  <div 
                    className="bg-[#10b981] h-full border-l border-slate-900" 
                    style={{ width: `${activeLogBreakdown.decode}%` }}
                    title={`模型文本推理输出耗时: ${activeLog.totalLatencyMs - activeLog.ttftMs}ms`}
                  />
                </div>
              )}
              
              <div className="flex gap-4 text-[9px] text-gray-400 font-mono mt-1.5">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-[#c084fc]"></span>网络就绪</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-[#3b82f6]"></span>Prefill 延迟(TTFT)</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-[#10b981]"></span>流式生成解码(Decode)</span>
              </div>
            </div>
          ) : (
            <div className="text-[10px] text-red-300 bg-red-950/20 p-2 rounded-lg border border-red-900/40">
              <span className="font-bold">监控熔断错误:</span> {activeLog.errorMsg || 'HTTP Status ' + activeLog.statusCode}
            </div>
          )}
        </div>
      )}

    </div>
  );

  // Selector Widget Controls for Metrics & Ranges
  function renderControlPanel() {
    return (
      <div className="p-4 bg-gray-50 border border-gray-200/80 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 font-sans text-xs">
        
        {/* Dynamic Metric Indicator Checkboxes */}
        <div className="space-y-2">
          <span className="font-bold text-gray-700 block">1. 监控展示指标配置 :</span>
          <div className="flex flex-wrap gap-3">
            {[
              { id: 'tps' as const, label: '吞吐速率 (TPS)', color: 'border-emerald-500 checked:bg-emerald-500' },
              { id: 'ttft' as const, label: '首字延迟 (TTFT)', color: 'border-blue-500 checked:bg-blue-500' },
              { id: 'itl' as const, label: '字间延迟 (ITL)', color: 'border-purple-500 checked:bg-purple-500' },
              { id: 'e2e' as const, label: '端到端总时延 (E2E)', color: 'border-pink-500 checked:bg-pink-500' }
            ].map(item => (
              <label key={item.id} className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedMetrics.includes(item.id)}
                  onChange={() => {
                    if (selectedMetrics.includes(item.id)) {
                      if (selectedMetrics.length > 1) {
                        setSelectedMetrics(selectedMetrics.filter(m => m !== item.id));
                      }
                    } else {
                      setSelectedMetrics([...selectedMetrics, item.id]);
                    }
                  }}
                  className={`w-3.5 h-3.5 rounded border border-gray-300 text-blue-600 focus:ring-0 cursor-pointer`}
                />
                <span className={`text-[11px] font-semibold ${selectedMetrics.includes(item.id) ? 'text-gray-900' : 'text-gray-500'}`}>
                  {item.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Time period select options */}
        <div className="space-y-2 md:text-right shrink-0">
          <span className="font-bold text-gray-700 block md:text-left">2. 数据监控探测时序范围：</span>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: '2h' as const, label: '2小时' },
              { id: '24h' as const, label: '24小时' },
              { id: '7d' as const, label: '一周' },
              { id: '30d' as const, label: '一个月' },
              { id: 'custom' as const, label: '自定义...' }
            ].map(opt => (
              <button
                key={opt.id}
                onClick={() => setTimeRange(opt.id)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                  timeRange === opt.id
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white hover:bg-gray-100 border border-gray-200 text-gray-600'
                }`}
              >
                {opt.label}
              </button>
            ))}

            {/* Micro Spline Smooth Switch */}
            <button
              onClick={() => setSmooth(!smooth)}
              className={`ml-2 px-2.5 py-1 text-[11px] font-bold border rounded-lg transition-all flex items-center gap-1 ${
                smooth 
                  ? 'bg-purple-50 text-purple-700 border-purple-200 font-extrabold' 
                  : 'bg-white text-gray-500 border-gray-200'
              }`}
              title="切换平滑的贝塞尔曲线插值"
            >
              <span>{smooth ? '✦ 曲线已平滑' : '☈ 折线过渡'}</span>
            </button>
          </div>

          {/* Render Calendar range controls if custom is selected */}
          {timeRange === 'custom' && (
            <div className="mt-2.5 flex items-center justify-end gap-2 text-[11px] text-gray-600 font-mono animate-fade-in">
              <input
                type="date"
                value={customStart}
                max={getBeijingDateInputMax(now)}
                onChange={e => setCustomStart(e.target.value)}
                className="px-2 py-1 bg-white border border-gray-200 rounded-md outline-none"
              />
              <span>至</span>
              <input
                type="date"
                value={customEnd}
                max={getBeijingDateInputMax(now)}
                onChange={e => setCustomEnd(e.target.value)}
                className="px-2 py-1 bg-white border border-gray-200 rounded-md outline-none"
              />
            </div>
          )}
        </div>

      </div>
    );
  }
}
