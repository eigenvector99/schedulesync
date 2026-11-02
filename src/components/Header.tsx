import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Calendar,
  TableProperties,
  FolderKanban,
  Inbox,
  Shield,
  Bell,
  Mail,
  LogOut,
  KeyRound,
  User,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react';

interface HeaderProps {
  onOpenEmailDrawer: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenEmailDrawer }) => {
  const {
    departments,
    currentUser,
    activeTab,
    setActiveTab,
    assignments,
    changeRequests,
    notifications,
    mockEmails,
    markNotificationRead,
    markAllNotificationsRead,
    logout,
    changePassword,
  } = useApp();

  const [showNotiDropdown, setShowNotiDropdown] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // Password change state
  const [currPassword, setCurrPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  // Calculate pending inbox counts for current user
  const myPendingAcceptance = assignments.filter(
    (a) => a.employeeId === currentUser?.id && a.status === 'EMPLOYEE_PENDING'
  ).length;

  const myPendingApproval =
    currentUser?.role === 'APPROVER'
      ? assignments.filter((a) => {
          if (a.status !== 'APPROVAL_PENDING') return false;
          const myDec = a.approvalDecisions.find((d) => d.approverId === currentUser?.id);
          return myDec && myDec.decision === 'PENDING';
        }).length
      : 0;

  const myPendingChanges = changeRequests.filter((cr) => {
    if (cr.status !== 'CHANGE_PENDING') return false;
    const myDec = cr.decisions.find((d) => d.actorId === currentUser?.id);
    return myDec && myDec.decision === 'PENDING';
  }).length;

  const totalInboxCount = myPendingAcceptance + myPendingApproval + myPendingChanges;

  // Unread notifications count
  const unreadNotiCount = notifications.filter(
    (n) => n.recipientId === currentUser?.id && !n.read
  ).length;

  // User's department name
  const userDept = departments.find((d) => d.id === currentUser?.departmentId)?.name || '소속 부서';

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);
    setPwLoading(true);

    const res = await changePassword(currPassword, nextPassword);
    setPwLoading(false);

    if (res.success) {
      setPwSuccess('비밀번호가 성공적으로 변경되었습니다.');
      setCurrPassword('');
      setNextPassword('');
      setTimeout(() => {
        setShowPasswordModal(false);
        setPwSuccess(null);
      }, 1500);
    } else {
      setPwError(res.error || '비밀번호 변경 실패');
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Zone 1: Brand Wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold shadow-xs">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-slate-900 tracking-tight">
                  ScheduleSync Pro
                </span>
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                  Live
                </span>
              </div>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                직원 프로젝트 스케줄 &amp; 다자간 승인 시스템
              </p>
            </div>
          </div>

          {/* Zone 2: Navigation Links */}
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setActiveTab('calendar')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'calendar'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>전사 캘린더</span>
            </button>

            <button
              onClick={() => setActiveTab('matrix')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'matrix'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <TableProperties className="w-4 h-4" />
              <span>참여 현황표</span>
            </button>

            <button
              onClick={() => setActiveTab('projects')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'projects'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <FolderKanban className="w-4 h-4" />
              <span>프로젝트 관리</span>
            </button>

            <button
              onClick={() => setActiveTab('inbox')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative ${
                activeTab === 'inbox'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Inbox className="w-4 h-4" />
              <span>내 처리함</span>
              {totalInboxCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 bg-amber-500 text-white text-[11px] font-bold rounded-full">
                  {totalInboxCount}
                </span>
              )}
            </button>

            {currentUser?.role === 'ADMIN' && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'admin'
                    ? 'bg-amber-50 text-amber-800 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Shield className="w-4 h-4" />
                <span>관리자</span>
              </button>
            )}
          </nav>

          {/* Zone 3: Profile & System Alerts */}
          <div className="flex items-center gap-2 shrink-0">
            {/* SMTP Mock Email Drawer Trigger */}
            <button
              onClick={onOpenEmailDrawer}
              className="p-2 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-slate-100 transition-colors relative"
              title="시스템 알림 이메일 발송함"
            >
              <Mail className="w-5 h-5" />
              {mockEmails.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-600"></span>
              )}
            </button>

            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotiDropdown(!showNotiDropdown)}
                className="p-2 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-slate-100 transition-colors relative"
                title="인앱 알림"
              >
                <Bell className="w-5 h-5" />
                {unreadNotiCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500"></span>
                )}
              </button>

              {showNotiDropdown && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      인앱 알림 ({notifications.filter((n) => n.recipientId === currentUser?.id).length})
                    </span>
                    <button
                      onClick={markAllNotificationsRead}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                    >
                      모두 읽음
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                    {notifications
                      .filter((n) => n.recipientId === currentUser?.id)
                      .slice(0, 10).length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        수신된 알림이 없습니다.
                      </div>
                    ) : (
                      notifications
                        .filter((n) => n.recipientId === currentUser?.id)
                        .slice(0, 10)
                        .map((noti) => (
                          <div
                            key={noti.id}
                            onClick={() => {
                              markNotificationRead(noti.id);
                              if (noti.linkTab) setActiveTab(noti.linkTab);
                              setShowNotiDropdown(false);
                            }}
                            className={`p-3 text-xs hover:bg-slate-50 transition-colors cursor-pointer ${
                              !noti.read ? 'bg-blue-50/50' : ''
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-slate-800">{noti.title}</p>
                              <span className="text-[10px] text-slate-400 shrink-0">
                                {new Date(noti.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <p className="text-slate-600 mt-1 leading-relaxed">{noti.message}</p>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User Profile Menu Dropdown */}
            <div className="relative pl-2 border-l border-slate-200">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold ${
                    currentUser?.avatarColor || 'bg-slate-700'
                  }`}
                >
                  {currentUser?.name.charAt(0) || 'U'}
                </div>
                <div className="text-left text-xs leading-tight hidden md:block">
                  <p className="font-bold text-slate-900">{currentUser?.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {userDept} ·{' '}
                    <span className="font-medium text-blue-700">
                      {currentUser?.role === 'ADMIN'
                        ? '관리자'
                        : currentUser?.role === 'APPROVER'
                        ? '허가권자'
                        : '직원'}
                    </span>
                  </p>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1 divide-y divide-slate-100 text-xs">
                  <div className="p-3 bg-slate-50">
                    <p className="font-bold text-slate-900">{currentUser?.name}</p>
                    <p className="text-slate-500 text-[11px] truncate">{currentUser?.email}</p>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-600">
                      <span>{userDept}</span>
                      <span>·</span>
                      <span className="font-semibold text-blue-700">
                        {currentUser?.role === 'ADMIN'
                          ? '시스템 관리자'
                          : currentUser?.role === 'APPROVER'
                          ? '프로젝트 허가권자'
                          : '일반 직원'}
                      </span>
                    </div>
                  </div>

                  <div className="py-1">
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        setShowPasswordModal(true);
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-slate-50 text-slate-700 flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <KeyRound className="w-4 h-4 text-slate-400" />
                      <span>비밀번호 변경</span>
                    </button>
                  </div>

                  <div className="py-1">
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        logout();
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-rose-50 text-rose-600 flex items-center gap-2 transition-colors cursor-pointer font-medium"
                    >
                      <LogOut className="w-4 h-4 text-rose-500" />
                      <span>로그아웃 (Sign Out)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-blue-600" />
                <span>계정 비밀번호 변경</span>
              </h3>
              <button
                onClick={() => setShowPasswordModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {pwError && (
              <div className="mb-3 p-2.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-xs flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{pwError}</span>
              </div>
            )}

            {pwSuccess && (
              <div className="mb-3 p-2.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-xs flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{pwSuccess}</span>
              </div>
            )}

            <form onSubmit={handleChangePasswordSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">현재 비밀번호</label>
                <input
                  type="password"
                  required
                  value={currPassword}
                  onChange={(e) => setCurrPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  새 비밀번호 (10자 이상, 영문+숫자)
                </label>
                <input
                  type="password"
                  required
                  minLength={10}
                  value={nextPassword}
                  onChange={(e) => setNextPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-3.5 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={pwLoading}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-xs"
                >
                  {pwLoading ? '변경 중...' : '비밀번호 변경'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
