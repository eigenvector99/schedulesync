import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Calendar,
  Lock,
  Mail,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  UserCheck,
  ChevronDown,
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login, requestPasswordReset, confirmPasswordReset } = useApp();

  const [activeTab, setActiveTab] = useState<'login' | 'reset'>('login');

  // Form states
  const [email, setEmail] = useState('a.kim@company.internal');
  const [password, setPassword] = useState('kim123!');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Reset password states
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetStep, setResetStep] = useState<1 | 2>(1);

  // Quick Preset Selector helper
  const [showPresets, setShowPresets] = useState(false);

  const presets = [
    { name: '김부서장 (허가권자 A)', email: 'a.kim@company.internal', pass: 'kim123!', role: '허가권자' },
    { name: '이부서장 (허가권자 B)', email: 'b.lee@company.internal', pass: 'lee123!', role: '허가권자' },
    { name: '총괄관리자 (Admin)', email: 'admin@company.internal', pass: 'admin123!', role: '관리자' },
    { name: '박개발 (일반 직원)', email: 'park.dev@company.internal', pass: 'park123!', role: '직원' },
    { name: '정엔지니어 (수락 대기 직원)', email: 'jung.eng@company.internal', pass: 'jung123!', role: '직원' },
    { name: '강디자이너 (승인 대기 직원)', email: 'kang.des@company.internal', pass: 'kang123!', role: '직원' },
  ];

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    const res = await login(email, password);
    setLoading(false);

    if (!res.success) {
      setErrorMsg(res.error || '로그인에 실패했습니다.');
    }
  };

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    const res = await requestPasswordReset(resetEmail);
    setLoading(false);

    if (res.success) {
      setSuccessMsg('재설정 토큰이 발송되었습니다. (시스템 이메일 수신함 확인)');
      if (res.token) setResetToken(res.token);
      setResetStep(2);
    } else {
      setErrorMsg(res.error || '재설정 요청 실패');
    }
  };

  const handleResetConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    const res = await confirmPasswordReset(resetToken, newPassword);
    setLoading(false);

    if (res.success) {
      setSuccessMsg('비밀번호가 성공적으로 변경되었습니다. 변경된 비밀번호로 로그인하세요.');
      setActiveTab('login');
      setPassword(newPassword);
      setEmail(resetEmail);
      setResetStep(1);
    } else {
      setErrorMsg(res.error || '비밀번호 재설정 실패');
    }
  };

  const handleSelectPreset = (p: (typeof presets)[0]) => {
    setEmail(p.email);
    setPassword(p.pass);
    setShowPresets(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex w-12 h-12 rounded-2xl bg-blue-600 items-center justify-center text-white shadow-lg shadow-blue-500/20 mb-3">
          <Calendar className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">
          ScheduleSync Pro
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          직원 스케줄 관리 및 프로젝트 참여 승인 시스템 (v1.0)
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-white py-8 px-6 sm:px-8 shadow-2xl rounded-2xl border border-slate-200">
          {/* Tabs */}
          <div className="flex items-center border-b border-slate-200 mb-6 text-xs font-semibold">
            <button
              onClick={() => {
                setActiveTab('login');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`pb-3 px-4 border-b-2 transition-colors ${
                activeTab === 'login'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              로그인 (Sign In)
            </button>
            <button
              onClick={() => {
                setActiveTab('reset');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`pb-3 px-4 border-b-2 transition-colors ${
                activeTab === 'reset'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              비밀번호 재설정
            </button>
          </div>

          {/* Alert Messages */}
          {errorMsg && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Tab 1: Login Form */}
          {activeTab === 'login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">이메일 계정</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    placeholder="name@company.internal"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-blue-500 text-xs"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700">비밀번호</label>
                  <button
                    type="button"
                    onClick={() => setActiveTab('reset')}
                    className="text-[11px] text-blue-600 hover:underline"
                  >
                    비밀번호를 잊으셨나요?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-blue-500 text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>{loading ? '로그인 확인 중...' : '시스템 로그인'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {/* Fast Account Selector for Testing / Convenience */}
              <div className="pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowPresets(!showPresets)}
                  className="w-full py-2 px-3 bg-slate-50 hover:bg-slate-100 rounded-lg text-slate-600 flex items-center justify-between font-medium text-[11px] transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-blue-600" />
                    <span>빠른 계정 선택 (초기 테스트 계정 목록)</span>
                  </span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>

                {showPresets && (
                  <div className="mt-2 divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden bg-slate-50 text-[11px]">
                    {presets.map((p, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSelectPreset(p)}
                        className="p-2.5 hover:bg-white cursor-pointer flex items-center justify-between transition-colors"
                      >
                        <div>
                          <span className="font-bold text-slate-900">{p.name}</span>
                          <span className="text-slate-500 ml-2">({p.email})</span>
                        </div>
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-200 text-slate-700 font-semibold">
                          {p.role}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </form>
          )}

          {/* Tab 2: Reset Password Form */}
          {activeTab === 'reset' && (
            <div className="space-y-4 text-xs">
              {resetStep === 1 ? (
                <form onSubmit={handleResetRequest} className="space-y-4">
                  <p className="text-slate-500 leading-relaxed text-[11px]">
                    가입된 이메일 주소를 입력하시면 비밀번호 재설정 토큰이 시스템 이메일로 발송됩니다.
                  </p>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">이메일 계정</label>
                    <input
                      type="email"
                      required
                      placeholder="name@company.internal"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-xs"
                  >
                    {loading ? '발송 중...' : '재설정 토큰 발송 요청'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleResetConfirm} className="space-y-4">
                  <p className="text-slate-500 leading-relaxed text-[11px]">
                    수신된 재설정 토큰과 새로운 비밀번호를 입력해 주십시오.
                  </p>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">재설정 토큰</label>
                    <input
                      type="text"
                      required
                      placeholder="발송된 토큰 문자열"
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">새 비밀번호 (6자 이상)</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      placeholder="새 비밀번호 입력"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg shadow-xs"
                  >
                    {loading ? '처리 중...' : '새 비밀번호 설정 완료'}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 text-center text-xs text-slate-500">
          <p>ScheduleSync Enterprise Schedule &amp; Approval System v1.0</p>
        </div>
      </div>
    </div>
  );
};
