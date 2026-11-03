import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Shield,
  UserPlus,
  Users,
  Building,
  History,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Search,
  Filter,
  UserCheck,
  Power,
} from 'lucide-react';
import { UserRole } from '../types';

export const AdminConsole: React.FC = () => {
  const {
    employees,
    departments,
    auditLogs,
    createEmployeeAccount,
    resendInvite,
    createDepartment,
    toggleEmployeeStatus,
    updateDepartmentHead,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'employees' | 'departments' | 'audit'>('employees');

  // New Employee Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newDeptId, setNewDeptId] = useState(departments[0]?.id || '');
  const [newRole, setNewRole] = useState<UserRole>('EMPLOYEE');
  const [newDeptName, setNewDeptName] = useState('');
  // Shown when Slack/SMTP delivery failed so the administrator can pass the link on personally.
  const [manualLink, setManualLink] = useState<{ name: string; link: string; reason?: string } | null>(null);

  // Audit Logs Filter
  const [logFilter, setLogFilter] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim()) {
      alert('이름과 이메일을 입력하세요.');
      return;
    }

    const res = await createEmployeeAccount({
      name: newName,
      email: newEmail,
      departmentId: newDeptId,
      role: newRole,
      timezone: 'Asia/Seoul',
    });

    if (res.success) {
      if (res.delivered) showToast(`[${newName}] 님에게 Slack DM으로 계정 초대를 보냈습니다. (72시간 내 비밀번호 설정)`);
      else if (res.inviteLink) setManualLink({ name: newName, link: res.inviteLink, reason: res.deliveryError });
      setShowAddModal(false);
      setNewName('');
      setNewEmail('');
    } else {
      alert(res.error || '계정 발급 실패');
    }
  };

  const filteredLogs = auditLogs.filter((log) => {
    if (!logFilter.trim()) return true;
    const query = logFilter.toLowerCase();
    return (
      log.actorName.toLowerCase().includes(query) ||
      log.action.toLowerCase().includes(query) ||
      log.details.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl shadow-lg text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{toastMessage}</span>
        </div>
      )}

      {manualLink && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-xs space-y-2">
          <p className="font-bold text-amber-900">
            [{manualLink.name}] 님에게 자동 발송하지 못했습니다{manualLink.reason ? ` (${manualLink.reason})` : ''}.
          </p>
          <p className="text-amber-800">
            아래 링크를 본인에게 직접 전달하세요. 1회용이며 이 창을 닫으면 다시 볼 수 없습니다. (발급 사실은 감사 로그에 기록됩니다)
          </p>
          <div className="flex gap-2">
            <input readOnly value={manualLink.link} onFocus={(e) => e.currentTarget.select()} className="flex-1 px-2 py-1.5 border border-amber-300 rounded bg-white font-mono" />
            <button
              onClick={() => navigator.clipboard?.writeText(manualLink.link)}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded"
            >
              복사
            </button>
            <button onClick={() => setManualLink(null)} className="px-3 py-1.5 border border-amber-300 rounded text-amber-900">
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Admin Header */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Shield className="w-5 h-5 text-amber-600" />
              <span>시스템 관리자 콘솔 (Admin Console)</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              설계 문서 v1.0 규칙: 계정 발급/비활성화, 부서 및 허가권자 지정, 추가 전용 감사 로그(Audit Log)를 관리합니다.
            </p>
          </div>

          {activeTab === 'employees' && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>직원 계정 발급</span>
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 text-xs">
          <button
            onClick={() => setActiveTab('employees')}
            className={`pb-2.5 px-3 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'employees'
                ? 'border-amber-600 text-amber-800'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>계정 관리 ({employees.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('departments')}
            className={`pb-2.5 px-3 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'departments'
                ? 'border-amber-600 text-amber-800'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building className="w-4 h-4" />
            <span>부서 및 허가권자 지정</span>
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`pb-2.5 px-3 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'audit'
                ? 'border-amber-600 text-amber-800'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-4 h-4" />
            <span>감사 로그 ({auditLogs.length})</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Employees List */}
      {activeTab === 'employees' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                  <th className="p-3">직원 이름</th>
                  <th className="p-3">이메일 계정</th>
                  <th className="p-3">소속 부서</th>
                  <th className="p-3">역할</th>
                  <th className="p-3">계정 상태</th>
                  <th className="p-3 text-right">상태 관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {employees.map((emp) => {
                  const dept = departments.find((d) => d.id === emp.departmentId)?.name;
                  const isActive = emp.status === 'ACTIVE';
                  const isInvited = emp.status === 'INVITED';

                  return (
                    <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-bold text-slate-900 flex items-center gap-2">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${
                            emp.avatarColor || 'bg-slate-700'
                          }`}
                        >
                          {emp.name.charAt(0)}
                        </div>
                        <span>{emp.name}</span>
                      </td>
                      <td className="p-3 text-slate-600 font-mono">{emp.email}</td>
                      <td className="p-3 text-slate-700">{dept}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            emp.role === 'ADMIN'
                              ? 'bg-amber-100 text-amber-800'
                              : emp.role === 'APPROVER'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {emp.role === 'ADMIN'
                            ? '시스템 관리자'
                            : emp.role === 'APPROVER'
                            ? '허가권자'
                            : '일반 직원'}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold text-[11px] ${
                            isActive ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isActive ? 'bg-emerald-500' : 'bg-slate-300'
                            }`}
                          ></span>
                          {isActive ? '활성 (ACTIVE)' : isInvited ? '초대 대기 (INVITED)' : '비활성 (DISABLED)'}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {isInvited && (
                          <button
                            onClick={async () => {
                              const r = await resendInvite(emp.id);
                              if (!r.success) alert(r.error || '초대 재발송 실패');
                              else if (r.delivered) showToast(`[${emp.name}] 님에게 초대를 다시 보냈습니다.`);
                              else if (r.inviteLink) setManualLink({ name: emp.name, link: r.inviteLink, reason: r.deliveryError });
                            }}
                            className="px-2.5 py-1 rounded text-[11px] font-medium border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer"
                          >
                            초대 재발송
                          </button>
                        )}
                        {emp.role !== 'ADMIN' && !isInvited && (
                          <button
                            onClick={() => toggleEmployeeStatus(emp.id)}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                              isActive
                                ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                                : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                            }`}
                          >
                            {isActive ? '계정 비활성화' : '계정 활성화'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Departments & Approver Roles */}
      {activeTab === 'departments' && (
        <div className="space-y-4">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await createDepartment(newDeptName);
            if (r.success) {
              showToast(`[${newDeptName}] 부서를 등록했습니다.`);
              setNewDeptName('');
            } else alert(r.error || '부서 등록 실패');
          }}
          className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex items-center gap-2 text-xs"
        >
          <input
            value={newDeptName}
            onChange={(e) => setNewDeptName(e.target.value)}
            maxLength={60}
            placeholder="새 부서명"
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg w-56"
          />
          <button type="submit" className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg">
            부서 등록
          </button>
        </form>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {departments.map((dept) => {
            const head = employees.find((e) => e.id === dept.headEmployeeId);
            const deptMembers = employees.filter((e) => e.departmentId === dept.id);

            return (
              <div
                key={dept.id}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Building className="w-5 h-5 text-blue-600" />
                    <h3 className="font-bold text-slate-900 text-base">{dept.name}</h3>
                  </div>
                  <span className="text-xs text-slate-500">인원: {deptMembers.length}명</span>
                </div>

                <div className="space-y-2 text-xs">
                  <label className="block font-semibold text-slate-700">
                    부서장 지정 (허가권자 권한 자동 부여)
                  </label>
                  <select
                    value={dept.headEmployeeId}
                    onChange={(e) => updateDepartmentHead(dept.id, e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-semibold focus:outline-blue-500"
                  >
                    <option value="" disabled>
                      부서장을 선택하세요
                    </option>
                    {deptMembers.filter((m) => m.role !== 'ADMIN' && m.status === 'ACTIVE').map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500">
                    현재 지정된 허가권자: <strong>{head?.name}</strong>
                  </p>
                </div>

                {/* Member list */}
                <div className="pt-2">
                  <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                    소속 직원 목록:
                  </span>
                  <div className="space-y-1">
                    {deptMembers.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between p-1.5 rounded bg-slate-50 text-xs text-slate-700"
                      >
                        <span className="font-medium">{m.name}</span>
                        <span className="text-[10px] text-slate-500">{m.email}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      )}

      {/* Tab 3: Append-only Audit Logs */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between gap-4">
            <span className="text-xs font-semibold text-slate-700">
              무결성 감사 로그 (추가 전용)
            </span>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="감사 로그 검색..."
                value={logFilter}
                onChange={(e) => setLogFilter(e.target.value)}
                className="text-xs pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-amber-500 w-56"
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold z-10">
                  <tr>
                    <th className="p-3 w-40">기록 시각</th>
                    <th className="p-3 w-36">수행자</th>
                    <th className="p-3 w-40">행위 (Action)</th>
                    <th className="p-3 w-28">대상 구분</th>
                    <th className="p-3">상세 기록</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 text-slate-500 tabular-nums">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="p-3 font-semibold text-slate-900">{log.actorName}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-slate-100 text-slate-800">
                          {log.action}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600">{log.targetType}</td>
                      <td className="p-3 text-slate-700 leading-relaxed">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-amber-600" />
              <span>신규 직원 계정 발급 (관리자 전용)</span>
            </h3>

            <form onSubmit={handleAddEmployee} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">직원 이름</label>
                <input
                  type="text"
                  required
                  placeholder="예: 홍길동"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-amber-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">이메일 주소</label>
                <input
                  type="email"
                  required
                  placeholder="hong@company.internal"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-amber-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">소속 부서</label>
                <select
                  value={newDeptId}
                  onChange={(e) => setNewDeptId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-amber-500"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">시스템 역할</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-amber-500"
                >
                  <option value="EMPLOYEE">일반 직원 (EMPLOYEE)</option>
                  <option value="APPROVER">허가권자 (APPROVER)</option>
                  <option value="ADMIN">시스템 관리자 (ADMIN)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg shadow-xs"
                >
                  계정 발급 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
