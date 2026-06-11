/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelChannel, DialTask, MetricLog, AlertConfig, AlertNotification } from '../types';

export const INITIAL_CHANNELS: ModelChannel[] = [
  {
    id: 'ch-deepseek-v3',
    name: 'DeepSeek-V3 (Private Edge)',
    apiEndpoint: 'http://10.180.44.12:8000/v1/chat/completions',
    apiKey: 'sk-dse****************************',
    modelIdentifier: 'deepseek-chat',
    type: 'openai',
    status: 'active',
    tags: ['Core Service', 'Quantized', 'Intranet'],
    createdAt: '2026-05-01T08:00:00Z',
    description: '企业自部署 4-bit 量化高吞吐版本，挂载于 AI 加速卡集群 B。'
  },
  {
    id: 'ch-llama3-70b',
    name: 'Llama-3.1-70B-Instruct (Ollama Local)',
    apiEndpoint: 'http://10.201.12.8:11434/api/chat',
    apiKey: 'N/A (Local Auth Bypass)',
    modelIdentifier: 'llama3.1:70b',
    type: 'ollama',
    status: 'active',
    tags: ['Dev/Test', 'Ollama', 'CPU/GPU Hybrid'],
    createdAt: '2026-05-15T10:00:00Z',
    description: '内部开发测试微调实例，部署于 8x H20 闲置卡槽。'
  },
  {
    id: 'ch-qwen25-72b',
    name: 'Qwen-2.5-72B-Instruct (Standard API)',
    apiEndpoint: 'http://10.180.44.15:8000/v1/chat/completions',
    apiKey: 'sk-qw****************************',
    modelIdentifier: 'qwen2.5-72b',
    type: 'openai',
    status: 'degraded',
    tags: ['Production', 'FP16', 'GPU Cluster A'],
    createdAt: '2026-05-18T14:30:00Z',
    description: '线上生产高精度推理节点，用于复杂逻辑及多语言场景。'
  }
];

export const INITIAL_ALERTS_CONFIG: AlertConfig[] = [
  {
    id: 'al-feishu-prod',
    name: 'DevOps 飞书报警群',
    type: 'feishu',
    webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/f8a329de-3f92-491c-b565-df091b6f0012',
    status: 'enabled',
    createdAt: '2026-05-01T09:00:00Z'
  },
  {
    id: 'al-email-admin',
    name: '基础设施运维邮箱通知',
    type: 'email',
    webhookUrl: 'xiaozhang@corp-guardian.com',
    status: 'enabled',
    createdAt: '2026-05-02T10:00:00Z'
  }
];

export const INITIAL_TASKS: DialTask[] = [
  {
    id: 'task-ds-dial',
    name: 'DeepSeek-V3 核心服务健康拨测',
    channelId: 'ch-deepseek-v3',
    prompt: '请用10字以内的一句话描述分布式系统的 CAP 定理。',
    intervalMinutes: 5,
    concurrency: 2,
    status: 'running',
    thresholds: {
      maxTtftMs: 350,       // TTFT threshold
      minTps: 45,          // TPS threshold
      maxTotalLatencyMs: 2500, // E2E
      minSuccessRate: 0.99
    },
    alertChannels: ['al-feishu-prod'],
    createdAt: '2026-05-01T12:00:00Z'
  },
  {
    id: 'task-llama-dial',
    name: 'Llama3-70B 轻量测试拨测',
    channelId: 'ch-llama3-70b',
    prompt: '简述大语言模型中 TTFT 包含哪些硬件开销。',
    intervalMinutes: 5,
    concurrency: 1,
    status: 'running',
    thresholds: {
      maxTtftMs: 800,
      minTps: 20,
      maxTotalLatencyMs: 5000,
      minSuccessRate: 0.95
    },
    alertChannels: ['al-feishu-prod', 'al-email-admin'],
    createdAt: '2026-05-15T11:00:00Z'
  }
];

// Helper to generate dense mock history for the past 30 days
export function generateHistoricLogs(): MetricLog[] {
  const logs: MetricLog[] = [];
  const now = new Date();
  
  // Tasks mapping
  const tasksConfig = [
    {
      taskId: 'task-ds-dial',
      taskName: 'DeepSeek-V3 核心服务健康拨测',
      channelId: 'ch-deepseek-v3',
      channelName: 'DeepSeek-V3 (Private Edge)',
      prompt: '请用10字以内的一句话描述分布式系统的 CAP 定理。',
      successBaseRate: 0.985,
      baseTtft: 180,
      baseTps: 58,
      maxTtft: 350,
      minTps: 45,
      maxLatency: 2500
    },
    {
      taskId: 'task-llama-dial',
      taskName: 'Llama3-70B 轻量测试拨测',
      channelId: 'ch-llama3-70b',
      channelName: 'Llama-3.1-70B-Instruct (Ollama Local)',
      prompt: '简述大语言模型中 TTFT 包含哪些硬件开销。',
      successBaseRate: 0.95,
      baseTtft: 580,
      baseTps: 24,
      maxTtft: 800,
      minTps: 20,
      maxLatency: 5000
    }
  ];

  const addPointAtTime = (time: Date, config: typeof tasksConfig[0]) => {
    const timeStr = time.toISOString();
    const hour = time.getHours();
    
    // Simulate hour of day load peaks
    const isPeakHour = hour >= 14 && hour <= 16;
    const isWeekend = time.getDay() === 0 || time.getDay() === 6;
    
    // SLA violation & success modulation
    let customRate = config.successBaseRate;
    if (isPeakHour) customRate -= 0.04;
    if (isWeekend) customRate += 0.01; // less load on weekend
    
    const isSuccess = Math.random() < customRate;
    
    let ttft = 0;
    let tps = 0;
    let tokens = 0;
    let totalLatency = 0;
    
    if (isSuccess) {
      const multiplier = isPeakHour ? 1.25 : 0.95 + Math.random() * 0.1;
      ttft = config.baseTtft * (0.8 + Math.random() * 0.4) * multiplier;
      tps = config.baseTps * (0.85 + Math.random() * 0.3) / (isPeakHour ? 1.15 : 1.0);
      tokens = 40 + Math.floor(Math.random() * 40);
      
      // Calculate E2E: Prefill (TTFT) + Generation tokens cost
      totalLatency = (ttft / 1000) + (tokens / tps) + 0.06 + Math.random() * 0.12;
    } else {
      totalLatency = 0.8 + Math.random() * 1.5;
    }
    
    // SLA constraints
    const violatedTtft = isSuccess && ttft > config.maxTtft;
    const violatedTps = isSuccess && tps < config.minTps;
    const violatedExtLatency = isSuccess && (totalLatency * 1000) > config.maxLatency;
    
    logs.push({
      id: `m-gen-${config.taskId}-${time.getTime()}`,
      taskId: config.taskId,
      taskName: config.taskName,
      channelId: config.channelId,
      channelName: config.channelName,
      timestamp: timeStr,
      prompt: config.prompt,
      responseText: !isSuccess 
        ? '' 
        : config.taskId === 'task-ds-dial' 
          ? '分布式系统的 CAP 定理包含一致性、可用性、分区容错。' 
          : 'TTFT 包含：网络往返开销、硬件内存搬运、Prefill 模型开销以及 KV Cache 缓存初始化。',
      dnsTimeMs: isSuccess ? Math.round(2 + Math.random() * 4) : 0,
      tcpTimeMs: isSuccess ? Math.round(5 + Math.random() * 6) : 0,
      ttftMs: isSuccess ? Math.round(ttft) : 0,
      totalLatencyMs: Math.round(totalLatency * 1000),
      tokensCount: tokens,
      tps: isSuccess ? parseFloat(tps.toFixed(1)) : 0,
      statusCode: isSuccess ? 200 : Math.random() > 0.5 ? 504 : 500,
      success: isSuccess,
      errorMsg: isSuccess ? undefined : 'Request execution timed out',
      violatedTtft,
      violatedTps,
      violatedExtLatency
    });
  };

  // Run generation for both tasks
  for (const config of tasksConfig) {
    // Stage 1: Last 24 Hours. Fine-grained dense reporting every 15 minutes. (96 points)
    for (let i = 0; i < 96; i++) {
      const time = new Date(now.getTime() - i * 15 * 60 * 1000);
      addPointAtTime(time, config);
    }
    
    // Stage 2: Days 2 to 7 (6 days). Medium resolution reporting every 1 hour. (144 points)
    for (let d = 1; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const time = new Date(now.getTime() - (d * 24 * 60 * 60 * 1000 + h * 60 * 60 * 1000));
        addPointAtTime(time, config);
      }
    }
    
    // Stage 3: Days 8 to 30 (23 days). Lower resolution reporting every 4 hours. (138 points)
    for (let d = 7; d < 30; d++) {
      for (let h = 0; h < 24; h += 4) {
        const time = new Date(now.getTime() - (d * 24 * 60 * 60 * 1000 + h * 60 * 60 * 1000));
        addPointAtTime(time, config);
      }
    }
  }

  return logs;
}

// Generate pre-loaded alerts matching our narrative
export const INITIAL_NOTIFICATIONS: AlertNotification[] = [
  {
    id: 'n-1',
    timestamp: new Date(Date.now() - 8.2 * 60 * 60 * 1000).toISOString(), // 8.2 hours ago
    channelName: 'DeepSeek-V3 (Private Edge)',
    taskName: 'DeepSeek-V3 核心服务健康拨测',
    metricName: '首字延迟 (TTFT)',
    metricValue: '612 ms',
    thresholdValue: '< 350 ms',
    status: 'resolved',
    alertChannelName: 'DevOps 飞书报警群'
  },
  {
    id: 'n-2',
    timestamp: new Date(Date.now() - 3.8 * 60 * 60 * 1000).toISOString(), // 3.8 hours ago
    channelName: 'Llama-3.1-70B-Instruct (Ollama Local)',
    taskName: 'Llama3-70B 轻量测试拨测',
    metricName: '每秒字数 (TPS)',
    metricValue: '17.2 Tokens/s',
    thresholdValue: '>= 20 Tokens/s',
    status: 'resolved',
    alertChannelName: '基础设施运维邮箱通知'
  },
  {
    id: 'n-3',
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
    channelName: 'Llama-3.1-70B-Instruct (Ollama Local)',
    taskName: 'Llama3-70B 轻量测试拨测',
    metricName: '请求成功率',
    metricValue: '500 Internal Error',
    thresholdValue: 'SLA OK (Http 200)',
    status: 'firing',
    alertChannelName: 'DevOps 飞书报警群'
  }
];

export const DUMMY_DIAL_PROMPTS = [
  '你好！请用20字一句话总结什么是深度强化学习。',
  '解释大模型推理中的 KV Cache 技术原理是什么？',
  '什么是 ROPE (旋转位置编码)？它有什么物理意义？',
  '简述 MoE 混合专家模型的设计初衷。',
  '在大语言模型中，Prefill 阶段和 Decode 阶段的区别。'
];
