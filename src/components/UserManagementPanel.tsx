import React, { useState } from 'react';
import { KeyRound, LoaderCircle, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';

import type { ManagedUser } from '../types';
import { formatBeijingTime } from '../lib/time';
import { AppSelect } from './AppSelect';
import { ResetUserPasswordModal } from './ResetUserPasswordModal';

interface UserManagementPanelProps {
  users: ManagedUser[];
  currentUserId: string;
  isLoading: boolean;
  onCreateUser: (payload: { username: string; password: string; role: 'admin' | 'user'; is_active: boolean }) => Promise<void>;
  onToggleUserStatus: (user: ManagedUser) => Promise<void>;
  onResetPassword: (user: ManagedUser, newPassword: string) => Promise<void>;
  onDeleteUser: (user: ManagedUser) => Promise<void>;
}

export function UserManagementPanel({
  users,
  currentUserId,
  isLoading,
  onCreateUser,
  onToggleUserStatus,
  onResetPassword,
  onDeleteUser,
}: UserManagementPanelProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [submitting, setSubmitting] = useState(false);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [resettingUser, setResettingUser] = useState<ManagedUser | null>(null);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) return;
    setSubmitting(true);
    try {
      await onCreateUser({ username: username.trim(), password, role, is_active: true });
      setUsername('');
      setPassword('');
      setRole('user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (newPassword: string) => {
    if (!resettingUser) return;
    setResettingUserId(resettingUser.id);
    try {
      await onResetPassword(resettingUser, newPassword);
      setResettingUser(null);
    } finally {
      setResettingUserId(null);
    }
  };

  return (
    <section className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[28px] border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <UserPlus className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">新增账号</h3>
              <p className="mt-1 text-xs text-gray-500">管理员可创建管理员或普通用户，普通用户登录后可自行修改密码。</p>
            </div>
          </div>

          <form className="mt-5 space-y-4" onSubmit={handleCreate}>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-700">用户名</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="例如：ops_user"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-700">初始密码</span>
              <input
                type="text"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="至少 8 位"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-700">账号角色</span>
              <AppSelect
                value={role}
                onChange={setRole}
                options={[
                  { value: 'user', label: '普通用户' },
                  { value: 'admin', label: '管理员' },
                ]}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-70"
            >
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              创建账号
            </button>
          </form>
        </div>

        <div className="rounded-[28px] border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between border-b border-gray-50 pb-3">
          <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">账号列表</h3>
                <p className="mt-1 text-xs text-gray-500">不保存明文密码，管理员可重置账号密码、启停账号并删除账号。</p>
              </div>
            </div>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
              共 {users.length} 个账号
            </span>
          </div>

          <div className="space-y-3">
            {users.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
                暂无账号
              </div>
            ) : null}
            {users.map((user) => (
              <div key={user.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 px-3">
                      <div className="min-w-0 break-all text-sm font-bold text-gray-900">{user.username}</div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${user.role === 'admin' ? 'bg-blue-50 text-blue-700' : 'bg-gray-200 text-gray-700'}`}>
                        {user.role === 'admin' ? '管理员' : '普通用户'}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${user.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                        {user.is_active ? '启用中' : '已停用'}
                      </span>
                      {user.id === currentUserId ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">当前账号</span>
                      ) : null}
                    </div>
                    <div className="mt-4 grid gap-2 text-xs text-gray-500 sm:grid-cols-2">
                      <div className="rounded-xl border border-gray-100 bg-white px-3 py-2">
                        <div className="font-semibold text-gray-700">创建时间</div>
                        <div className="mt-1 leading-5 tabular-nums">{user.created_at ? formatBeijingTime(user.created_at) : '暂无'}</div>
                      </div>
                      <div className="rounded-xl border border-gray-100 bg-white px-3 py-2">
                        <div className="font-semibold text-gray-700">最近登录</div>
                        <div className="mt-1 leading-5 tabular-nums">{user.last_login_at ? formatBeijingTime(user.last_login_at) : '暂无'}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:w-[250px]">
                    <button
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 disabled:opacity-60"
                      onClick={() => setResettingUser(user)}
                      disabled={resettingUserId === user.id || isLoading}
                    >
                      {resettingUserId === user.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                      重置密码
                    </button>
                    <button
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 disabled:opacity-60"
                      onClick={() => void onToggleUserStatus(user)}
                      disabled={user.id === currentUserId || isLoading}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {user.is_active ? '停用账号' : '启用账号'}
                    </button>
                    <button
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 sm:col-span-2"
                      onClick={() => void onDeleteUser(user)}
                      disabled={user.id === currentUserId || isLoading}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除账号
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ResetUserPasswordModal
        isOpen={Boolean(resettingUser)}
        username={resettingUser?.username || ''}
        isSubmitting={Boolean(resettingUser && resettingUserId === resettingUser.id)}
        onClose={() => setResettingUser(null)}
        onSubmit={handleResetPassword}
      />
    </section>
  );
}
