import React, { useState } from 'react';
import { HeartPulse, LoaderCircle, LockKeyhole, UserRound } from 'lucide-react';

interface LoginPageProps {
  onSubmit: (username: string, password: string) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}

export function LoginPage({ onSubmit, isSubmitting, error }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit(username.trim(), password);
  };

  return (
    <div className="min-h-screen bg-[#eef2ff] text-[#1F2937]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-10 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="hidden rounded-[28px] border border-blue-100 bg-white px-10 py-12 shadow-sm lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                  <HeartPulse className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-xl font-bold tracking-tight text-gray-900">LLM-Guardian</div>
                  <div className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-600">Enterprise</div>
                </div>
              </div>
              <div className="max-w-xl space-y-3">
                <h1 className="text-3xl font-bold leading-tight text-gray-900">
                  本地模型主动拨测、告警与 SLA 审计控制台
                </h1>
                <p className="text-sm leading-7 text-gray-500">
                  统一查看 OpenAI 兼容接口与 Ollama 节点的 TTFT、TPS、E2E 与告警恢复状态。
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                { label: '响应首字', value: 'TTFT' },
                { label: '流式吞吐', value: 'TPS' },
                { label: '合规审计', value: 'SLA' },
              ].map((item) => (
                <div key={item.value} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">
                    {item.label}
                  </div>
                  <div className="mt-2 text-2xl font-bold text-gray-900">{item.value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/70 bg-white px-6 py-7 shadow-sm sm:px-8 sm:py-8">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                <HeartPulse className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-bold text-gray-900">LLM-Guardian</div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-600">Enterprise</div>
              </div>
            </div>

            <div className="mb-8 space-y-2">
              <h2 className="text-2xl font-bold text-gray-900">管理员登录</h2>
              <p className="text-sm text-gray-500">登录后进入平台控制台。当前版本仅支持本地管理员账号。</p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-700">用户名</span>
                <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3">
                  <UserRound className="h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="w-full bg-transparent text-sm outline-none"
                    placeholder="请输入管理员用户名"
                    autoComplete="username"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-700">密码</span>
                <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3">
                  <LockKeyhole className="h-4 w-4 text-gray-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full bg-transparent text-sm outline-none"
                    placeholder="请输入密码"
                    autoComplete="current-password"
                  />
                </div>
              </label>

              {error && <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                <span>{isSubmitting ? '登录中...' : '登录'}</span>
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
