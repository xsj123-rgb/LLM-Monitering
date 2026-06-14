import React, { useState } from 'react';
import { Eye, EyeOff, HeartPulse, LoaderCircle, LockKeyhole, Radar, ShieldCheck, Sparkles, UserRound } from 'lucide-react';

interface LoginPageProps {
  onSubmit: (username: string, password: string) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}

export function LoginPage({ onSubmit, isSubmitting, error }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const capabilityCards = [
    { label: '拨测监控', value: 'TTFT / TPS / E2E', icon: <Radar className="h-4 w-4" /> },
    { label: '异常联动', value: '飞书 / 钉钉 / Webhook', icon: <ShieldCheck className="h-4 w-4" /> },
    { label: '审计视图', value: '日志 / 报表 / 恢复轨迹', icon: <Sparkles className="h-4 w-4" /> },
  ];

  const summaryCards = [
    { value: '7x24', label: '守护节奏', note: '持续关注拨测波动' },
    { value: 'SLA', label: '合规审计', note: '追踪阈值与恢复过程' },
    { value: 'Ops', label: '告警联动', note: '集中沉淀通知上下文' },
  ];

  const detailCards = [
    { title: '节点监控', value: 'TTFT / TPS' },
    { title: '异常恢复', value: '事件流追踪' },
    { title: '审计导出', value: '日报 / 周报' },
  ];

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit(username.trim(), password);
  };

  return (
    <div className="min-h-dvh overflow-hidden bg-[#eff3ff] text-[#1F2937]">
      <div className="relative isolate min-h-dvh">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.16),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.14),_transparent_30%),linear-gradient(180deg,_#f8fbff_0%,_#edf2ff_55%,_#e8eefc_100%)]" />
        <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(255,255,255,0.78)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.78)_1px,transparent_1px)] [background-size:32px_32px]" />

        <div className="relative min-h-dvh w-full">
          <div className="grid min-h-dvh w-full overflow-hidden lg:grid-cols-[1.08fr_0.92fr]">
            <section className="relative flex items-center overflow-hidden border-b border-white/50 px-5 py-6 sm:px-8 lg:border-b-0 lg:border-r lg:border-white/60 lg:px-10 lg:py-8 xl:px-14">
              <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(37,99,235,0.09),transparent_42%),radial-gradient(circle_at_78%_18%,rgba(191,219,254,0.54),transparent_24%),linear-gradient(180deg,rgba(248,250,255,0.84),rgba(242,247,255,0.72))]" />
              <div className="relative mx-auto flex w-full max-w-[980px] min-h-[760px] flex-col justify-between gap-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_12px_24px_rgba(37,99,235,0.26)]">
                      <HeartPulse className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="font-display text-[28px] font-bold tracking-tight text-slate-900">LLM-Guardian</div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.34em] text-blue-600">Enterprise Console</div>
                    </div>
                  </div>
                </div>

                <div className="grid flex-1 content-center gap-5">
                  <div className="grid gap-4 xl:grid-cols-[1.26fr_0.94fr]">
                    <div className="rounded-[30px] border border-white/85 bg-white/82 p-6 shadow-[0_12px_34px_rgba(148,163,184,0.09)] xl:p-8">
                      <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-700">
                        <Sparkles className="h-3.5 w-3.5" />
                        LLM Operations
                      </div>
                      <h1 className="mt-5 max-w-[10ch] font-display text-[38px] font-bold leading-[1.06] text-slate-900 sm:text-[44px] xl:text-[52px]">
                        本地模型拨测与告警控制台
                      </h1>
                      <p className="mt-4 max-w-xl text-[15px] leading-7 text-slate-500">
                        统一查看 TTFT、TPS、E2E、告警与恢复状态，让值班排障更直接。
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                      {capabilityCards.map((item) => (
                        <div key={item.label} className="rounded-[24px] border border-slate-100 bg-white/88 p-4 shadow-[0_10px_28px_rgba(148,163,184,0.08)]">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                            {item.icon}
                          </div>
                          <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{item.label}</div>
                          <div className="mt-2 text-sm font-semibold leading-6 text-slate-900">{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {summaryCards.map((item) => (
                      <div key={item.value} className="rounded-[24px] border border-white/80 bg-slate-950 px-5 py-4 text-white shadow-[0_18px_32px_rgba(15,23,42,0.16)]">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">{item.label}</div>
                        <div className="mt-2 font-display text-3xl font-bold">{item.value}</div>
                        <div className="mt-2 text-xs leading-5 text-slate-300">{item.note}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="relative flex items-center bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(247,250,255,0.82))] px-5 py-6 sm:px-8 lg:px-10 xl:px-14">
              <div className="mx-auto w-full max-w-[520px]">
                <div className="flex min-h-[760px] flex-col justify-between rounded-[34px] border border-white/80 bg-white/94 p-6 shadow-[0_24px_60px_rgba(148,163,184,0.12)] backdrop-blur sm:p-8">
                  <div className="mb-7 flex items-center gap-3 lg:hidden">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
                      <HeartPulse className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-display text-xl font-bold text-slate-900">LLM-Guardian</div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-600">Enterprise Console</div>
                    </div>
                  </div>

                  <div className="mb-7 space-y-3">
                    <h2 className="font-display text-3xl font-bold text-slate-900">进入值守控制台</h2>
                    <p className="text-sm leading-6 text-slate-500">
                      登录后即可查看拨测结果、告警事件流与 SLA 审计。
                    </p>
                  </div>

                  <form className="space-y-5" onSubmit={handleSubmit}>
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold text-slate-700">用户名</span>
                      <div className="flex h-14 items-center gap-3 rounded-[20px] border border-slate-200 bg-slate-50 px-4 transition focus-within:border-blue-300 focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)]">
                        <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
                        <input
                          type="text"
                          value={username}
                          onChange={(event) => setUsername(event.target.value)}
                          className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                          placeholder="请输入用户名"
                          autoComplete="username"
                        />
                      </div>
                    </label>

                    <label className="block">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-slate-700">密码</span>
                      </div>
                      <div className="flex h-14 items-center gap-3 rounded-[20px] border border-slate-200 bg-slate-50 pl-4 pr-2 transition focus-within:border-blue-300 focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)]">
                        <LockKeyhole className="h-4 w-4 shrink-0 text-slate-400" />
                        <input
                          type={isPasswordVisible ? 'text' : 'password'}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          className="login-password-input w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                          placeholder="请输入密码"
                          autoComplete="current-password"
                        />
                        <button
                          type="button"
                          onClick={() => setIsPasswordVisible((value) => !value)}
                          aria-label={isPasswordVisible ? '隐藏密码' : '查看密码'}
                          className="mr-[-2px] flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-[color,background-color,transform,box-shadow] duration-200 ease-out hover:bg-slate-200/55 hover:text-slate-600 active:scale-[0.94] active:bg-slate-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-1"
                        >
                          {isPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </label>

                    {error ? (
                      <div role="alert" className="rounded-[20px] border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {error}
                      </div>
                    ) : null}

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-blue-600 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(37,99,235,0.24)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                      <span>{isSubmitting ? '登录中...' : '登录'}</span>
                    </button>
                  </form>

                  <div className="mt-6 grid gap-3 rounded-[22px] border border-slate-100 bg-slate-50 p-4 sm:grid-cols-3">
                    {detailCards.map((item) => (
                      <div key={item.title}>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{item.title}</div>
                        <div className="mt-2 text-sm font-semibold text-slate-900">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
