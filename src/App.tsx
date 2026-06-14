import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  ChevronRight,
  Clock,
  Cpu,
  Edit,
  FileText,
  HeartPulse,
  LoaderCircle,
  LogOut,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Terminal,
  Trash2,
  UserRound,
} from 'lucide-react';

import { api, ApiError } from './lib/api';
import { formatProbeTrigger, getExecutionIntervalMinutes } from './lib/logs';
import { formatBeijingTime } from './lib/time';
import type {
  AlertConfig,
  AlertNotification,
  AuthUser,
  DialTask,
  ManagedUser,
  MetricLog,
  ModelChannel,
} from './types';
import { LoginPage } from './components/LoginPage';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { SLACharts } from './components/SLACharts';
import { ChannelModal } from './components/ChannelModal';
import { TaskModal } from './components/TaskModal';
import { AlertConfigModal } from './components/AlertConfigModal';
import { LogViewer } from './components/LogViewer';
import { AuditReport } from './components/AuditReport';
import { UserManagementPanel } from './components/UserManagementPanel';
import { ConfirmDialog } from './components/ConfirmDialog';
import { AppSelect } from './components/AppSelect';

type ActiveTab = 'dashboard' | 'channels' | 'tasks' | 'logs' | 'alerts' | 'report' | 'users';
type Toast = {
  id: string;
  title: string;
  message: string;
  category: 'info' | 'success' | 'warn' | 'error';
};

type PendingConfirmation =
  | { kind: 'channel'; id: string; name: string }
  | { kind: 'task'; id: string; name: string }
  | { kind: 'alert'; id: string; name: string }
  | { kind: 'user'; id: string; name: string };

function buildToast(title: string, message: string, category: Toast['category']): Toast {
  return {
    id: Math.random().toString(36).slice(2, 10),
    title,
    message,
    category,
  };
}

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [channels, setChannels] = useState<ModelChannel[]>([]);
  const [tasks, setTasks] = useState<DialTask[]>([]);
  const [alerts, setAlerts] = useState<AlertConfig[]>([]);
  const [logs, setLogs] = useState<MetricLog[]>([]);
  const [notifications, setNotifications] = useState<AlertNotification[]>([]);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedDiagnosticLog, setSelectedDiagnosticLog] = useState<MetricLog | null>(null);

  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<ModelChannel | null>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<DialTask | null>(null);
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<AlertConfig | null>(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  const [channelsSearch, setChannelsSearch] = useState('');
  const [dashboardChannelId, setDashboardChannelId] = useState('');
  const [logsFilterChannel, setLogsFilterChannel] = useState('');
  const [logsFilterStatus, setLogsFilterStatus] = useState<'all' | 'success' | 'fail' | 'violation'>('all');
  const [logsFilterTimeRange, setLogsFilterTimeRange] = useState<'all' | '1h' | '6h' | '24h' | '7d'>('all');
  const [probeLoadingTaskId, setProbeLoadingTaskId] = useState<string | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const isAdmin = user?.role === 'admin';

  const addToast = (title: string, message: string, category: Toast['category'] = 'info') => {
    const toast = buildToast(title, message, category);
    setToasts((current) => [...current, toast]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== toast.id));
    }, 4200);
  };

  const loadData = async () => {
    setLoadingData(true);
    try {
      const [nextChannels, nextTasks, nextAlerts, nextLogs, nextNotifications] = await Promise.all([
        api.channels.list(),
        api.tasks.list(),
        api.alerts.list(),
        api.logs.list({ limit: 500 }),
        api.notifications.list(),
      ]);
      setChannels(nextChannels);
      setTasks(nextTasks);
      setAlerts(nextAlerts);
      setLogs(nextLogs);
      setNotifications(nextNotifications);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        return;
      }
      addToast('数据加载失败', error instanceof Error ? error.message : '未知错误', 'error');
    } finally {
      setLoadingData(false);
    }
  };

  const loadUsers = async (role: AuthUser['role'] | null = user?.role ?? null) => {
    if (role !== 'admin') {
      setManagedUsers([]);
      return;
    }
    setLoadingUsers(true);
    try {
      const nextUsers = await api.auth.listUsers();
      setManagedUsers(nextUsers);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setManagedUsers([]);
        return;
      }
      addToast('账号加载失败', error instanceof Error ? error.message : '未知错误', 'error');
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const auth = await api.auth.me();
        if (cancelled) return;
        if (auth.authenticated && auth.user) {
          setUser(auth.user);
          await loadData();
          await loadUsers(auth.user.role);
        }
      } catch (error) {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const source = new EventSource('/api/events/stream', { withCredentials: true });
    const refresh = () => {
      void loadData();
    };
    source.addEventListener('probe_run.created', refresh);
    source.addEventListener('incident.fired', refresh);
    source.addEventListener('incident.resolved', refresh);
    source.onerror = () => {
      source.close();
      window.setTimeout(() => {
        if (user) void loadData();
      }, 3000);
    };
    return () => {
      source.close();
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void loadUsers(user.role);
  }, [user]);

  const handleLogin = async (username: string, password: string) => {
    setLoginSubmitting(true);
    setLoginError(null);
    try {
      const auth = await api.auth.login(username, password);
      if (!auth.authenticated || !auth.user) {
        setLoginError('登录失败，请检查用户名和密码。');
        return;
      }
      setUser(auth.user);
      await loadData();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : '登录失败');
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.auth.logout();
    } catch {
      // ignore logout failures and clear local state anyway
    }
    setUser(null);
    setChannels([]);
    setTasks([]);
    setAlerts([]);
    setLogs([]);
    setNotifications([]);
    setSelectedDiagnosticLog(null);
    setManagedUsers([]);
  };

  const handleChangePassword = async (currentPassword: string, newPassword: string) => {
    setChangingPassword(true);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      addToast('密码已更新', '当前会话已失效，请使用新密码重新登录。', 'success');
      setIsPasswordModalOpen(false);
      await handleLogout();
    } catch (error) {
      addToast('修改失败', error instanceof Error ? error.message : '修改密码失败', 'error');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleCreateUser = async (payload: { username: string; password: string; role: 'admin' | 'user'; is_active: boolean }) => {
    try {
      await api.auth.createUser(payload);
      addToast('账号已创建', `账号「${payload.username}」已创建。`, 'success');
      await loadUsers('admin');
    } catch (error) {
      addToast('创建失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  };

  const handleToggleUserStatus = async (managedUser: ManagedUser) => {
    try {
      await api.auth.updateUser(managedUser.id, { is_active: !managedUser.is_active });
      addToast('账号状态已更新', `账号「${managedUser.username}」已${managedUser.is_active ? '停用' : '启用'}。`, 'info');
      await loadUsers('admin');
    } catch (error) {
      addToast('更新失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  };

  const handleResetUserPassword = async (managedUser: ManagedUser, newPassword: string) => {
    try {
      await api.auth.resetUserPassword(managedUser.id, newPassword);
      addToast('密码已重置', `账号「${managedUser.username}」的新密码已保存。`, 'success');
      await loadUsers('admin');
    } catch (error) {
      addToast('重置失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  };

  const handleDeleteUser = async (managedUser: ManagedUser) => {
    setPendingConfirmation({ kind: 'user', id: managedUser.id, name: managedUser.username });
  };

  const handleConfirmedDeleteUser = async (managedUser: { id: string; name: string }) => {
    try {
      await api.auth.deleteUser(managedUser.id);
      addToast('账号已删除', `账号「${managedUser.name}」已移除。`, 'warn');
      await loadUsers('admin');
    } catch (error) {
      addToast('删除失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  };

  const handleSaveChannel = async (payload: Omit<ModelChannel, 'createdAt'> & { id?: string }) => {
    try {
      if (payload.id) {
        await api.channels.update(payload.id, payload);
        addToast('更新成功', `模型渠道「${payload.name}」已保存。`, 'success');
      } else {
        await api.channels.create(payload);
        addToast('录入成功', `模型渠道「${payload.name}」已创建。`, 'success');
      }
      await loadData();
    } catch (error) {
      addToast('渠道保存失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  };

  const handleDeleteChannel = async (channel: ModelChannel) => {
    setPendingConfirmation({ kind: 'channel', id: channel.id, name: channel.name });
  };

  const handleConfirmedDeleteChannel = async (channel: { id: string; name: string }) => {
    try {
      await api.channels.remove(channel.id);
      addToast('渠道已删除', `「${channel.name}」及其关联任务已移除。`, 'warn');
      await loadData();
    } catch (error) {
      addToast('删除失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  };

  const handleSaveTask = async (payload: Omit<DialTask, 'createdAt'> & { id?: string }) => {
    try {
      if (payload.id) {
        await api.tasks.update(payload.id, payload);
        addToast('策略已更新', `拨测策略「${payload.name}」已保存，并已立即执行一次拨测。`, 'success');
      } else {
        await api.tasks.create(payload);
        addToast('策略已创建', `拨测策略「${payload.name}」已开始运行，并已立即执行首次拨测。`, 'success');
      }
      await loadData();
    } catch (error) {
      addToast('策略保存失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  };

  const handleDeleteTask = async (task: DialTask) => {
    setPendingConfirmation({ kind: 'task', id: task.id, name: task.name });
  };

  const handleConfirmedDeleteTask = async (task: { id: string; name: string }) => {
    try {
      await api.tasks.remove(task.id);
      addToast('策略已删除', `「${task.name}」已从调度器移除。`, 'warn');
      await loadData();
    } catch (error) {
      addToast('删除失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  };

  const handleToggleTask = async (task: DialTask) => {
    try {
      await api.tasks.update(task.id, { status: task.status === 'running' ? 'paused' : 'running' });
      addToast(
        '策略状态已更新',
        task.status === 'running'
          ? `「${task.name}」已暂停。`
          : `「${task.name}」已恢复，并已立即执行一次拨测。`,
        'info'
      );
      await loadData();
    } catch (error) {
      addToast('状态更新失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  };

  const handleManualProbe = async (task: DialTask) => {
    setProbeLoadingTaskId(task.id);
    try {
      const log = await api.tasks.probe(task.id);
      addToast('现场拨测完成', `模型渠道「${log.channelName}」已写入最新时序日志。`, 'success');
      await loadData();
      setSelectedDiagnosticLog(log);
      setActiveTab('logs');
    } catch (error) {
      addToast('现场拨测失败', error instanceof Error ? error.message : '未知错误', 'error');
    } finally {
      setProbeLoadingTaskId(null);
    }
  };

  const handleSaveAlert = async (payload: Omit<AlertConfig, 'createdAt'> & { id?: string }) => {
    try {
      if (payload.id) {
        await api.alerts.update(payload.id, payload);
        addToast('告警通道已更新', `「${payload.name}」配置已保存。`, 'success');
      } else {
        await api.alerts.create(payload);
        addToast('告警通道已创建', `「${payload.name}」已可接收告警。`, 'success');
      }
      await loadData();
    } catch (error) {
      addToast('保存失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  };

  const handleDeleteAlert = async (alert: AlertConfig) => {
    setPendingConfirmation({ kind: 'alert', id: alert.id, name: alert.name });
  };

  const handleConfirmedDeleteAlert = async (alert: { id: string; name: string }) => {
    try {
      await api.alerts.remove(alert.id);
      addToast('告警通道已删除', `「${alert.name}」已移除。`, 'warn');
      await loadData();
    } catch (error) {
      addToast('删除失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  };

  const handleConfirmAction = async () => {
    if (!pendingConfirmation) return;
    setConfirmSubmitting(true);
    try {
      if (pendingConfirmation.kind === 'channel') {
        await handleConfirmedDeleteChannel(pendingConfirmation);
      } else if (pendingConfirmation.kind === 'task') {
        await handleConfirmedDeleteTask(pendingConfirmation);
      } else if (pendingConfirmation.kind === 'user') {
        await handleConfirmedDeleteUser(pendingConfirmation);
      } else {
        await handleConfirmedDeleteAlert(pendingConfirmation);
      }
      setPendingConfirmation(null);
    } finally {
      setConfirmSubmitting(false);
    }
  };

  const handleTestAlertConnection = async (alert: Omit<AlertConfig, 'createdAt'> & { id?: string }) => {
    if (!alert.id) {
      addToast('无法测试', '请先保存告警通道，再执行连通性测试。', 'warn');
      throw new Error('Alert must be saved before testing');
    }
    await api.alerts.test(alert.id);
    addToast('测试成功', `「${alert.name}」连通性正常。`, 'success');
  };

  const handleResolveNotification = async (notification: AlertNotification) => {
    try {
      await api.notifications.resolve(notification.id);
      addToast('通知已标记恢复', `「${notification.metricName}」已标记为 resolved。`, 'success');
      await loadData();
    } catch (error) {
      addToast('更新失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (logsFilterChannel && log.channelId !== logsFilterChannel) return false;
      if (logsFilterStatus === 'success' && !log.success) return false;
      if (logsFilterStatus === 'fail' && log.success) return false;
      if (
        logsFilterStatus === 'violation' &&
        !(log.success && (log.violatedTtft || log.violatedTps || log.violatedExtLatency))
      ) {
        return false;
      }
      if (logsFilterTimeRange !== 'all') {
        const now = Date.now();
        const diffMs = now - new Date(log.timestamp).getTime();
        const rangeMap = {
          '1h': 60 * 60 * 1000,
          '6h': 6 * 60 * 60 * 1000,
          '24h': 24 * 60 * 60 * 1000,
          '7d': 7 * 24 * 60 * 60 * 1000,
        };
        if (diffMs > rangeMap[logsFilterTimeRange]) return false;
      }
      return true;
    });
  }, [logs, logsFilterChannel, logsFilterStatus, logsFilterTimeRange]);

  const filteredChannels = useMemo(() => {
    const keyword = channelsSearch.trim().toLowerCase();
    if (!keyword) return channels;
    return channels.filter(
      (channel) =>
        channel.name.toLowerCase().includes(keyword) ||
        channel.modelIdentifier.toLowerCase().includes(keyword) ||
        channel.tags.some((tag) => tag.toLowerCase().includes(keyword)),
    );
  }, [channels, channelsSearch]);

  const recentLogs = logs.slice(0, 5);
  const firingCount = notifications.filter((item) => item.status === 'firing').length;
  const successRate =
    logs.length > 0 ? ((logs.filter((log) => log.success).length / logs.length) * 100).toFixed(1) : '100.0';

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F3F4F6]">
        <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 shadow-sm">
          <LoaderCircle className="h-5 w-5 animate-spin text-blue-600" />
          <span className="text-sm font-medium text-gray-700">正在初始化控制台...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onSubmit={handleLogin} isSubmitting={loginSubmitting} error={loginError} />;
  }

  return (
    <div className="h-screen overflow-hidden bg-[#F3F4F6] text-[#1F2937] antialiased">
      <div className="fixed right-4 top-4 z-[80] space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`w-[320px] rounded-2xl border px-4 py-3 shadow-lg ${
              toast.category === 'success'
                ? 'border-emerald-100 bg-emerald-50'
                : toast.category === 'error'
                  ? 'border-rose-100 bg-rose-50'
                  : toast.category === 'warn'
                    ? 'border-amber-100 bg-amber-50'
                    : 'border-blue-100 bg-blue-50'
            }`}
          >
            <div className="text-sm font-semibold text-gray-900">{toast.title}</div>
            <div className="mt-1 text-xs leading-5 text-gray-600">{toast.message}</div>
          </div>
        ))}
      </div>

      <div className="flex h-full flex-col">
        <nav className="z-40 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
              <HeartPulse className="h-5 w-5" />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-display text-lg font-bold tracking-tight text-gray-900">LLM-Guardian</span>
              <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-600">
                Enterprise
              </span>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div className="hidden items-center gap-2 text-xs text-gray-500 font-mono sm:flex">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span>节点状态: 正常运行 | 时区: 北京时间 (UTC+8)</span>
            </div>
            <button
              className="relative rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              onClick={() => setActiveTab('alerts')}
            >
              <Bell className="h-5 w-5" />
              {firingCount > 0 ? (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full border border-white bg-rose-500" />
              ) : null}
            </button>
            <button
              className="hidden rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 sm:flex"
              onClick={() => void loadData()}
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loadingData ? 'animate-spin' : ''}`} />
              刷新
            </button>
            <div className="flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-bold text-blue-600 shadow-sm">
                {user.username.slice(0, 2).toUpperCase()}
              </div>
              <div className="hidden sm:block">
                <div className="text-xs font-semibold text-gray-900">{user.username}</div>
                <div className="text-[10px] text-gray-500">{isAdmin ? '管理员' : '普通用户'}</div>
              </div>
              <button
                className="hidden rounded-lg px-2 py-1 text-[11px] font-semibold text-gray-500 transition hover:bg-white sm:block"
                onClick={() => setIsPasswordModalOpen(true)}
              >
                改密码
              </button>
              <button
                className="rounded-lg p-1.5 text-gray-500 transition hover:bg-white hover:text-gray-700"
                onClick={handleLogout}
                title="退出登录"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </nav>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-64 shrink-0 flex-col border-r border-gray-200 bg-white p-6 md:flex">
            <SidebarNav activeTab={activeTab} firingCount={firingCount} isAdmin={isAdmin} onChange={setActiveTab} />
            <div className="mt-auto border-t border-gray-100 pt-4">
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">今日探测概览</div>
                <div className="mt-3 text-lg font-bold text-gray-900">{logs.length.toLocaleString()} 次</div>
                <div className="mt-1 text-xs text-gray-500">成功率 {successRate}%</div>
              </div>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex gap-2 overflow-x-auto border-b border-gray-200 bg-white px-4 py-2 md:hidden">
              <MobileTab label="实时大盘" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
              <MobileTab label="渠道管理" active={activeTab === 'channels'} onClick={() => setActiveTab('channels')} />
              <MobileTab label="拨测配置" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
              <MobileTab label="时序日志" active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} />
              <MobileTab label="告警终端" active={activeTab === 'alerts'} onClick={() => setActiveTab('alerts')} />
              <MobileTab label="合规审计" active={activeTab === 'report'} onClick={() => setActiveTab('report')} />
              {isAdmin ? <MobileTab label="账号管理" active={activeTab === 'users'} onClick={() => setActiveTab('users')} /> : null}
            </div>

            <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
              {activeTab === 'dashboard' ? (
                <section className="space-y-6">
                  <div className="grid gap-4 lg:grid-cols-4">
                    <SummaryCard title="纳管模型渠道" value={String(channels.length)} hint="当前在监控范围内的模型端点" />
                    <SummaryCard title="运行中拨测任务" value={String(tasks.filter((task) => task.status === 'running').length)} hint="已注册到调度器的任务数" />
                    <SummaryCard title="24h 日志数量" value={String(logs.filter((log) => Date.now() - new Date(log.timestamp).getTime() <= 24 * 60 * 60 * 1000).length)} hint="最近 24 小时主动拨测条数" />
                    <SummaryCard title="未恢复告警" value={String(firingCount)} hint="当前仍处于 firing 状态的事件" tone={firingCount > 0 ? 'warn' : 'success'} />
                  </div>

                  <div className="rounded-[28px] border border-gray-100 bg-white p-5 shadow-xs">
                    <div className="mb-4 flex flex-col gap-4 border-b border-gray-50 pb-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
                          <Activity className="h-4 w-4 text-blue-600" />
                          大模型主动拨测 SLA 监控大盘
                        </h3>
                        <p className="mt-1 text-[11px] text-gray-400">聚合 TTFT、TPS、ITL 与 E2E 的时序拨测结果。</p>
                      </div>
                      <AppSelect
                        value={dashboardChannelId}
                        onChange={setDashboardChannelId}
                        options={[
                          { value: '', label: '-- 所有渠道合并分析 --' },
                          ...channels.map((channel) => ({ value: channel.id, label: channel.name })),
                        ]}
                        className="rounded-xl border border-gray-200 px-3 py-2 text-xs"
                      />
                    </div>

                    <SLACharts
                      logs={logs}
                      channelId={dashboardChannelId || undefined}
                      thresholds={dashboardChannelId ? tasks.find((task) => task.channelId === dashboardChannelId)?.thresholds : undefined}
                    />
                  </div>

                  <div className="grid gap-6 lg:grid-cols-3">
                    <div className="rounded-[28px] border border-gray-100 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between border-b border-gray-50 pb-3">
                        <h4 className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                          <Cpu className="h-4 w-4 text-blue-600" />
                          渠道健康概览
                        </h4>
                        <button className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-blue-600" onClick={() => setActiveTab('channels')}>
                          管理 <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="space-y-3">
                        {channels.length === 0 ? <EmptyBlock label="暂无模型渠道，请先创建监控端点。" /> : null}
                        {channels.map((channel) => {
                          const channelLogs = logs.filter((log) => log.channelId === channel.id);
                          const availability = channelLogs.length
                            ? ((channelLogs.filter((log) => log.success).length / channelLogs.length) * 100).toFixed(1)
                            : '100.0';
                          return (
                            <div key={channel.id} className="flex items-center justify-between rounded-2xl border border-gray-100 bg-gray-50 px-3 py-3 text-xs">
                              <div className="min-w-0">
                                <div className="truncate font-bold text-gray-800">{channel.name}</div>
                                <div className="mt-1 truncate font-mono text-[11px] text-gray-500">{channel.modelIdentifier}</div>
                                <div className="mt-1 text-[10px] text-gray-400">可用率 {availability}%</div>
                              </div>
                              <StatusBadge status={channel.status} />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-gray-100 bg-white p-5 shadow-sm lg:col-span-2">
                      <div className="mb-4 flex items-center justify-between border-b border-gray-50 pb-3">
                        <h4 className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                          <Terminal className="h-4 w-4 text-gray-700" />
                          最近拨测日志
                        </h4>
                        <button className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-blue-600" onClick={() => setActiveTab('logs')}>
                          完整日志 <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {recentLogs.length === 0 ? <EmptyBlock label="暂无拨测日志，任务启动后这里会自动出现。" /> : null}
                        {recentLogs.map((log) => {
                          const hasViolation = log.success && (log.violatedTtft || log.violatedTps || log.violatedExtLatency);
                          const executionIntervalMinutes = getExecutionIntervalMinutes(log, logs);
                          return (
                            <button
                              key={log.id}
                              className="flex w-full items-center justify-between gap-4 px-1 py-3 text-left transition hover:rounded-xl hover:bg-gray-50"
                              onClick={() => setSelectedDiagnosticLog(log)}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${!log.success ? 'bg-rose-500' : hasViolation ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                                  <span className="truncate text-sm font-semibold text-gray-900">{log.channelName}</span>
                                  <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-800">{log.tps} Tok/s</span>
                                </div>
                                <div className="mt-1 truncate text-xs text-gray-500">{log.prompt}</div>
                                <div className="mt-1 text-[10px] text-gray-400">
                                  {formatProbeTrigger(log.trigger)}
                                  {executionIntervalMinutes ? ` / 执行时频率 ${executionIntervalMinutes} 分钟` : ''}
                                </div>
                              </div>
                              <div className="shrink-0 text-right text-[11px] font-mono font-semibold text-gray-800">
                                <div>首字 {log.ttftMs}ms</div>
                                <div className="mt-1 text-gray-400">总时 {log.totalLatencyMs}ms</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              {activeTab === 'channels' ? (
                <section className="space-y-6">
                  <PageHeader
                    title="渠道管理"
                    description="录入、维护和查看被监控的大模型服务端点。"
                    actionLabel={isAdmin ? '新增渠道' : undefined}
                    onAction={isAdmin ? () => {
                      setEditingChannel(null);
                      setIsChannelModalOpen(true);
                    } : undefined}
                  />

                  <div className="flex items-center gap-3 rounded-[24px] border border-gray-100 bg-white px-4 py-3 shadow-xs">
                    <Search className="h-4 w-4 text-gray-400" />
                    <input
                      value={channelsSearch}
                      onChange={(event) => setChannelsSearch(event.target.value)}
                      className="w-full bg-transparent text-sm outline-none"
                      placeholder="按名称、模型标识、标签搜索"
                    />
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    {filteredChannels.length === 0 ? <EmptyBlock label="没有匹配的渠道。" /> : null}
                    {filteredChannels.map((channel) => (
                      <div key={channel.id} className="rounded-[26px] border border-gray-100 bg-white p-5 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="truncate text-sm font-bold text-gray-900">{channel.name}</h3>
                              <StatusBadge status={channel.status} />
                            </div>
                            <div className="mt-1 font-mono text-[11px] text-gray-500">{channel.modelIdentifier}</div>
                            <div className="mt-3 break-all rounded-xl bg-gray-50 px-3 py-2 font-mono text-[11px] text-gray-600">
                              {channel.apiEndpoint}
                            </div>
                          </div>
                          {isAdmin ? (
                            <div className="flex shrink-0 items-center gap-1">
                              <IconButton
                                title="编辑"
                                onClick={() => {
                                  setEditingChannel(channel);
                                  setIsChannelModalOpen(true);
                                }}
                              >
                                <Edit className="h-4 w-4" />
                              </IconButton>
                              <IconButton title="删除" onClick={() => void handleDeleteChannel(channel)}>
                                <Trash2 className="h-4 w-4" />
                              </IconButton>
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {channel.tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                              {tag}
                            </span>
                          ))}
                        </div>

                        <div className="mt-4 grid gap-3 text-xs text-gray-500 sm:grid-cols-2">
                          <div>
                            <span className="font-semibold text-gray-700">类型</span>
                            <div className="mt-1">{channel.type}</div>
                          </div>
                          <div>
                            <span className="font-semibold text-gray-700">最近拨测</span>
                            <div className="mt-1">{channel.lastProbeAt ? formatBeijingTime(channel.lastProbeAt) : '暂无'}</div>
                          </div>
                        </div>
                        {channel.description ? <div className="mt-4 text-xs leading-6 text-gray-500">{channel.description}</div> : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {activeTab === 'tasks' ? (
                <section className="space-y-6">
                  <PageHeader
                    title="拨测配置"
                    description="为指定模型渠道配置定时主动拨测任务、SLA 阈值和告警联动。"
                    actionLabel={isAdmin ? '新增任务' : undefined}
                    onAction={isAdmin ? () => {
                      setEditingTask(null);
                      setIsTaskModalOpen(true);
                    } : undefined}
                  />

                  <div className="space-y-4">
                    {tasks.length === 0 ? <EmptyBlock label="暂无拨测任务，请先创建任务。" /> : null}
                    {tasks.map((task) => {
                      const channel = channels.find((item) => item.id === task.channelId);
                      return (
                        <div key={task.id} className="rounded-[26px] border border-gray-100 bg-white p-5 shadow-sm">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-bold text-gray-900">{task.name}</h3>
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${task.status === 'running' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                                  {task.status === 'running' ? 'RUNNING' : 'PAUSED'}
                                </span>
                              </div>
                              <div className="mt-2 text-xs text-gray-500">关联渠道：{channel?.name || '未知渠道'}</div>
                              <div className="mt-2 rounded-2xl bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-600">{task.prompt}</div>
                            </div>

                            {isAdmin ? (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                                  onClick={() => void handleToggleTask(task)}
                                >
                                  {task.status === 'running' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                                  {task.status === 'running' ? '暂停' : '恢复'}
                                </button>
                                <button
                                  className="flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"
                                  onClick={() => void handleManualProbe(task)}
                                  disabled={probeLoadingTaskId === task.id}
                                >
                                  {probeLoadingTaskId === task.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                  现场拨测
                                </button>
                                <IconButton
                                  title="编辑"
                                  onClick={() => {
                                    setEditingTask(task);
                                    setIsTaskModalOpen(true);
                                  }}
                                >
                                  <Edit className="h-4 w-4" />
                                </IconButton>
                                <IconButton title="删除" onClick={() => void handleDeleteTask(task)}>
                                  <Trash2 className="h-4 w-4" />
                                </IconButton>
                              </div>
                            ) : null}
                          </div>

                          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                            <MetricChip label="频率" value={`${task.intervalMinutes} 分钟`} />
                            <MetricChip label="并发数" value={`${task.concurrency}`} />
                            <MetricChip label="TTFT 上限" value={`${task.thresholds.maxTtftMs} ms`} />
                            <MetricChip label="TPS 下限" value={`${task.thresholds.minTps} Tok/s`} />
                            <MetricChip label="E2E 上限" value={`${task.thresholds.maxTotalLatencyMs} ms`} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {activeTab === 'logs' ? (
                <section className="space-y-6">
                  <PageHeader title="时序测试日志" description="查看主动拨测原始日志，支持按渠道、状态和时间窗口过滤。" />
                  <div className="grid gap-3 rounded-[24px] border border-gray-100 bg-white p-4 shadow-xs lg:grid-cols-4">
                    <AppSelect
                      value={logsFilterChannel}
                      onChange={setLogsFilterChannel}
                      options={[
                        { value: '', label: '所有渠道' },
                        ...channels.map((channel) => ({ value: channel.id, label: channel.name })),
                      ]}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    />
                    <AppSelect
                      value={logsFilterStatus}
                      onChange={setLogsFilterStatus}
                      options={[
                        { value: 'all', label: '全部状态' },
                        { value: 'success', label: '成功' },
                        { value: 'fail', label: '失败' },
                        { value: 'violation', label: 'Violation' },
                      ]}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    />
                    <AppSelect
                      value={logsFilterTimeRange}
                      onChange={setLogsFilterTimeRange}
                      options={[
                        { value: 'all', label: '全量' },
                        { value: '1h', label: '近 1 小时' },
                        { value: '6h', label: '近 6 小时' },
                        { value: '24h', label: '近 24 小时' },
                        { value: '7d', label: '近 7 天' },
                      ]}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    />
                    <button
                      className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
                      onClick={() => {
                        setLogsFilterChannel('');
                        setLogsFilterStatus('all');
                        setLogsFilterTimeRange('all');
                      }}
                    >
                      <RefreshCw className="h-4 w-4" />
                      重置过滤器
                    </button>
                  </div>

                  <div className="space-y-3">
                    {filteredLogs.length === 0 ? <EmptyBlock label="所选条件下暂无日志。" /> : null}
                    {filteredLogs.map((log) => {
                      const hasViolation = log.success && (log.violatedTtft || log.violatedTps || log.violatedExtLatency);
                      const executionIntervalMinutes = getExecutionIntervalMinutes(log, logs);
                      const task = tasks.find((item) => item.id === log.taskId);
                      const intervalMismatch =
                        log.trigger === 'scheduled' &&
                        executionIntervalMinutes !== null &&
                        task &&
                        executionIntervalMinutes !== task.intervalMinutes;
                      return (
                        <button
                          key={log.id}
                          className="flex w-full flex-col gap-3 rounded-[24px] border border-gray-100 bg-white px-5 py-4 text-left shadow-sm transition hover:border-blue-100 hover:bg-blue-50/40 sm:flex-row sm:items-center sm:justify-between"
                          onClick={() => setSelectedDiagnosticLog(log)}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`h-2 w-2 rounded-full ${!log.success ? 'bg-rose-500' : hasViolation ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                              <span className="text-sm font-bold text-gray-900">{log.channelName}</span>
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{log.taskName}</span>
                            </div>
                            <div className="mt-2 truncate text-sm text-gray-600">{log.prompt}</div>
                            <div className="mt-2 text-[11px] text-gray-400">{formatBeijingTime(log.timestamp)}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">{formatProbeTrigger(log.trigger)}</span>
                              {executionIntervalMinutes !== null ? (
                                <span className={`rounded-full px-2 py-0.5 font-medium ${intervalMismatch ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                                  执行时频率 {executionIntervalMinutes} 分钟
                                </span>
                              ) : null}
                              {intervalMismatch ? (
                                <span className="text-amber-600">当前任务已改为 {task.intervalMinutes} 分钟，这条日志生成于旧频率下</span>
                              ) : null}
                            </div>
                          </div>
                          <div className="grid shrink-0 grid-cols-2 gap-3 text-[11px] font-mono text-gray-700 sm:grid-cols-4">
                            <MetricStat label="TTFT" value={`${log.ttftMs} ms`} alert={log.violatedTtft} />
                            <MetricStat label="TPS" value={`${log.tps} Tok/s`} alert={log.violatedTps} />
                            <MetricStat label="E2E" value={`${log.totalLatencyMs} ms`} alert={log.violatedExtLatency} />
                            <MetricStat label="状态" value={log.success ? 'OK' : `HTTP ${log.statusCode}`} alert={!log.success} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {activeTab === 'alerts' ? (
                <section className="space-y-6">
                  <PageHeader
                    title="联动告警终端"
                    description="维护飞书、钉钉、Webhook、Email 告警通道，并查看当前告警事件。"
                    actionLabel={isAdmin ? '新增告警通道' : undefined}
                    onAction={isAdmin ? () => {
                      setEditingAlert(null);
                      setIsAlertModalOpen(true);
                    } : undefined}
                  />

                  <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                    <div className="space-y-4">
                      {alerts.length === 0 ? <EmptyBlock label="暂无告警通道。" /> : null}
                      {alerts.map((alert) => (
                        <div key={alert.id} className="rounded-[24px] border border-gray-100 bg-white p-5 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="truncate text-sm font-bold text-gray-900">{alert.name}</h3>
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${alert.status === 'enabled' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                                  {alert.status === 'enabled' ? 'ENABLED' : 'DISABLED'}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-gray-500">{alert.type}</div>
                              <div className="mt-3 break-all rounded-xl bg-gray-50 px-3 py-2 font-mono text-[11px] text-gray-600">
                                {alert.webhookUrl}
                              </div>
                            </div>
                            {isAdmin ? (
                              <div className="flex items-center gap-1">
                                <button
                                  className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                                  onClick={() => void handleTestAlertConnection(alert)}
                                >
                                  测试
                                </button>
                                <IconButton
                                  title="编辑"
                                  onClick={() => {
                                    setEditingAlert(alert);
                                    setIsAlertModalOpen(true);
                                  }}
                                >
                                  <Edit className="h-4 w-4" />
                                </IconButton>
                                <IconButton title="删除" onClick={() => void handleDeleteAlert(alert)}>
                                  <Trash2 className="h-4 w-4" />
                                </IconButton>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-[28px] border border-gray-100 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between border-b border-gray-50 pb-3">
                        <h4 className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                          <ShieldAlert className="h-4 w-4 text-slate-700" />
                          告警事件流
                        </h4>
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                          firing {firingCount}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {notifications.length === 0 ? <EmptyBlock label="暂无告警事件。" /> : null}
                        {notifications.map((notification) => (
                          <div key={notification.id} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${notification.status === 'firing' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                                  <div className="truncate text-sm font-semibold text-gray-900">{notification.metricName}</div>
                                </div>
                                <div className="mt-1 text-xs text-gray-500">{notification.channelName} / {notification.taskName}</div>
                                <div className="mt-2 text-xs text-gray-600">
                                  当前值 <span className="font-semibold text-gray-900">{notification.metricValue}</span>，阈值{' '}
                                  <span className="font-semibold text-gray-900">{notification.thresholdValue}</span>
                                </div>
                                <div className="mt-2 text-[11px] text-gray-400">{formatBeijingTime(notification.timestamp)}</div>
                              </div>
                              {notification.status === 'firing' && isAdmin ? (
                                <button
                                  className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-white"
                                  onClick={() => void handleResolveNotification(notification)}
                                >
                                  标记恢复
                                </button>
                              ) : (
                                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${notification.status === 'firing' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                  {notification.status === 'firing' ? '只读查看' : 'RESOLVED'}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              {activeTab === 'report' ? (
                <section className="space-y-6">
                  <PageHeader title="SLA 合规审计" description="基于已落库拨测数据生成周期性合规视图与导出内容。" />
                  <AuditReport
                    logs={logs}
                    channels={channels}
                    tasks={tasks}
                    canManage={isAdmin}
                    onTriggerNotify={(msg) => addToast('报表操作', msg, 'info')}
                  />
                </section>
              ) : null}

              {activeTab === 'users' && isAdmin ? (
                <section className="space-y-6">
                  <PageHeader title="账号管理" description="维护管理员与普通用户账号，支持重置密码、启停账号和删除账号。" />
                  <UserManagementPanel
                    users={managedUsers}
                    currentUserId={user.id}
                    isLoading={loadingUsers}
                    onCreateUser={handleCreateUser}
                    onToggleUserStatus={handleToggleUserStatus}
                    onResetPassword={handleResetUserPassword}
                    onDeleteUser={handleDeleteUser}
                  />
                </section>
              ) : null}
            </main>
          </div>
        </div>
      </div>

      <ChannelModal
        isOpen={isChannelModalOpen}
        onClose={() => setIsChannelModalOpen(false)}
        onSave={handleSaveChannel}
        channel={editingChannel}
      />
      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        onSave={handleSaveTask}
        task={editingTask}
        channels={channels}
        alerts={alerts}
      />
      <AlertConfigModal
        isOpen={isAlertModalOpen}
        onClose={() => setIsAlertModalOpen(false)}
        onSave={handleSaveAlert}
        onTestConnection={handleTestAlertConnection}
        alertConfig={editingAlert}
      />
      <ChangePasswordModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        onSubmit={handleChangePassword}
        isSubmitting={changingPassword}
      />
      <LogViewer
        log={selectedDiagnosticLog}
        onClose={() => setSelectedDiagnosticLog(null)}
        associatedTask={selectedDiagnosticLog ? tasks.find((task) => task.id === selectedDiagnosticLog.taskId) : undefined}
        allLogs={logs}
      />
      <ConfirmDialog
        isOpen={Boolean(pendingConfirmation)}
        title="确认执行该操作"
        message={
          pendingConfirmation?.kind === 'channel'
            ? `确认删除模型渠道「${pendingConfirmation.name}」？该操作会移除其关联任务。`
            : pendingConfirmation?.kind === 'task'
              ? `确认删除拨测策略「${pendingConfirmation.name}」？该操作会将其从调度器移除。`
              : pendingConfirmation?.kind === 'alert'
                ? `确认删除告警通道「${pendingConfirmation.name}」？`
                : pendingConfirmation?.kind === 'user'
                  ? `确认删除账号「${pendingConfirmation.name}」？删除后该账号将无法再登录。`
                : ''
        }
        confirmLabel="确认删除"
        tone="danger"
        isSubmitting={confirmSubmitting}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={handleConfirmAction}
      />
    </div>
  );
}

function SidebarNav({
  activeTab,
  firingCount,
  isAdmin,
  onChange,
}: {
  activeTab: ActiveTab;
  firingCount: number;
  isAdmin: boolean;
  onChange: (tab: ActiveTab) => void;
}) {
  return (
    <>
      <div>
        <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-gray-400">监控面板</p>
        <ul className="space-y-2">
          <SidebarButton label="实时大盘" icon={<Activity className="h-4 w-4" />} active={activeTab === 'dashboard'} onClick={() => onChange('dashboard')} />
          <SidebarButton label="渠道管理" icon={<Cpu className="h-4 w-4" />} active={activeTab === 'channels'} onClick={() => onChange('channels')} />
          <SidebarButton label="拨测配置" icon={<Clock className="h-4 w-4" />} active={activeTab === 'tasks'} onClick={() => onChange('tasks')} />
        </ul>
      </div>

      <div className="mt-8">
        <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-gray-400">分析与告警</p>
        <ul className="space-y-2">
          <SidebarButton label="时序测试日志" icon={<Terminal className="h-4 w-4" />} active={activeTab === 'logs'} onClick={() => onChange('logs')} />
          <SidebarButton
            label="联动告警终端"
            icon={<Bell className="h-4 w-4" />}
            active={activeTab === 'alerts'}
            badge={firingCount > 0 ? String(firingCount) : undefined}
            onClick={() => onChange('alerts')}
          />
          <SidebarButton label="SLA 合规审计" icon={<FileText className="h-4 w-4" />} active={activeTab === 'report'} onClick={() => onChange('report')} />
        </ul>
      </div>

      {isAdmin ? (
        <div className="mt-8">
          <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-gray-400">系统设置</p>
          <ul className="space-y-2">
            <SidebarButton label="账号管理" icon={<UserRound className="h-4 w-4" />} active={activeTab === 'users'} onClick={() => onChange('users')} />
          </ul>
        </div>
      ) : null}
    </>
  );
}

function SidebarButton({
  active,
  badge,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  badge?: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-xs font-medium transition ${
          active ? 'bg-blue-50 font-bold text-blue-600' : 'text-gray-500 hover:bg-gray-50'
        }`}
      >
        {icon}
        <span className="flex-1 text-left">{label}</span>
        {badge ? <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white">{badge}</span> : null}
      </button>
    </li>
  );
}

function MobileTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        active ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:text-gray-800'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function PageHeader({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[28px] border border-gray-100 bg-white p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>
      {actionLabel && onAction ? (
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          onClick={onAction}
        >
          <Plus className="h-4 w-4" />
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  hint,
  tone = 'default',
}: {
  title: string;
  value: string;
  hint: string;
  tone?: 'default' | 'warn' | 'success';
}) {
  return (
    <div className="rounded-[24px] border border-gray-100 bg-white px-5 py-4 shadow-xs">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">{title}</div>
      <div className={`mt-3 text-2xl font-bold ${tone === 'warn' ? 'text-rose-600' : tone === 'success' ? 'text-emerald-600' : 'text-gray-900'}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-gray-500">{hint}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: ModelChannel['status'] }) {
  const style =
    status === 'active'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : status === 'degraded'
        ? 'bg-amber-50 text-amber-700 border-amber-100'
        : 'bg-rose-50 text-rose-700 border-rose-100';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${style}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'active' ? 'bg-emerald-500' : status === 'degraded' ? 'bg-amber-500' : 'bg-rose-500'}`} />
      {status}
    </span>
  );
}

function IconButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="rounded-xl border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
    >
      {children}
    </button>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">{label}</div>
      <div className="mt-2 text-sm font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function MetricStat({ label, value, alert }: { label: string; value: string; alert: boolean }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400">{label}</div>
      <div className={`mt-1 text-xs font-semibold ${alert ? 'text-rose-600' : 'text-gray-800'}`}>{value}</div>
    </div>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-500">
      {label}
    </div>
  );
}
