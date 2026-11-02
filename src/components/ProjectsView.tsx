import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  FolderPlus,
  Calendar,
  Users,
  UserPlus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Shield,
  Trash2,
  Edit3,
  CalendarClock,
  Info,
  X,
  AlertCircle,
} from 'lucide-react';
import { Project, ProjectSession, ConflictDetail, Employee } from '../types';
import { KR_DAYS, checkEmployeeOverlap } from '../utils/dateAndRrule';

interface ProjectsViewProps {
  onSelectProject: (project: Project) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({ onSelectProject }) => {
  const {
    projects,
    sessions,
    assignments,
    employees,
    departments,
    currentUserId,
    currentUser,
    allowedOverlaps,
    createProject,
    updateProject,
    assignEmployee,
    withdrawAssignment,
    releaseAssignment,
    requestSessionChange,
  } = useApp();

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [assigningProjectId, setAssigningProjectId] = useState<string | null>(null);
  const [changingSessionProjectId, setChangingSessionProjectId] = useState<string | null>(null);

  // Self assign warning modal state
  const [selfAssignConfirmModal, setSelfAssignConfirmModal] = useState<{
    projectId: string;
    conflicts: ConflictDetail[];
  } | null>(null);

  // Schedule change own-warning confirm modal
  const [ownWarningConfirmModal, setOwnWarningConfirmModal] = useState<{
    projectId: string;
    newSessions: Omit<ProjectSession, 'id' | 'projectId'>[];
    conflicts: ConflictDetail[];
  } | null>(null);

  // Success / Error toast
  const [toastMessage, setToastMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  const showToast = (text: string, isError: boolean = false) => {
    setToastMessage({ text, isError });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Create Project Form State
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newStartDate, setNewStartDate] = useState('2026-11-01');
  const [newEndDate, setNewEndDate] = useState('2026-12-31');
  const [newHeadcount, setNewHeadcount] = useState<number>(3);
  const [newColor, setNewColor] = useState('#2563eb');
  const [newSessionTitle, setNewSessionTitle] = useState('정기 작업 스프린트');
  const [newDaysOfWeek, setNewDaysOfWeek] = useState<number[]>([2, 4]); // 화, 목
  const [newStartTime, setNewStartTime] = useState('14:00');
  const [newEndTime, setNewEndTime] = useState('17:00');

  const handleCreateProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) {
      showToast('프로젝트 이름을 입력하세요.', true);
      return;
    }

    const sessionPayload: Omit<ProjectSession, 'id' | 'projectId'> = {
      title: newSessionTitle,
      startAt: `${newStartDate}T${newStartTime}:00Z`,
      endAt: `${newEndDate}T${newEndTime}:00Z`,
      rrule: `FREQ=WEEKLY;BYDAY=${newDaysOfWeek.map((d) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d]).join(',')}`,
      daysOfWeek: newDaysOfWeek,
      startTime: newStartTime,
      endTime: newEndTime,
      timezone: 'Asia/Seoul',
    };

    const res = await createProject(
      {
        name: newProjectName,
        description: newProjectDesc,
        startDate: newStartDate,
        endDate: newEndDate,
        status: 'IN_PROGRESS',
        headcount: newHeadcount,
        color: newColor,
      },
      [sessionPayload]
    );

    if (res.success) {
      showToast('새 프로젝트가 성공적으로 등록되었습니다.');
      setShowCreateModal(false);
      // Reset form
      setNewProjectName('');
      setNewProjectDesc('');
    } else {
      showToast(res.error || '프로젝트 등록에 실패했습니다.', true);
    }
  };

  // Handle Employee Assignment click
  const handleAssignClick = async (proj: Project, emp: Employee) => {
    const res = await assignEmployee(proj.id, emp.id);
    if (res.needConfirmation && res.conflicts) {
      // Self-assign warning confirmation
      setSelfAssignConfirmModal({
        projectId: proj.id,
        conflicts: res.conflicts,
      });
      return;
    }

    if (res.success) {
      if (emp.id === currentUserId) {
        showToast('자신을 프로젝트에 성공적으로 투입하였습니다.');
      } else {
        showToast(`${emp.name} 직원에게 배정 요청을 발송하였습니다.`);
      }
    } else {
      showToast(res.error || '배정에 실패했습니다.', true);
    }
  };

  const handleConfirmSelfAssign = async () => {
    if (!selfAssignConfirmModal) return;
    const res = await assignEmployee(selfAssignConfirmModal.projectId, currentUserId, true);
    if (res.success) {
      showToast('경고 확인 후 셀프 투입이 확정되었습니다 (허용된 겹침 등록).');
      setSelfAssignConfirmModal(null);
    } else {
      showToast(res.error || '투입 실패', true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold flex items-center gap-2 ${
            toastMessage.isError
              ? 'bg-rose-50 text-rose-800 border-rose-200'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          }`}
        >
          {toastMessage.isError ? (
            <AlertCircle className="w-4 h-4 text-rose-600" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-slate-900">프로젝트 관리 및 배정 센터</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            규칙 F-104: <strong>자신이 등록한 프로젝트만</strong> 수정 및 직원을 배정할 수 있습니다.
          </p>
        </div>

        {currentUser?.role === 'APPROVER' && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <FolderPlus className="w-4 h-4" />
            <span>새 프로젝트 등록</span>
          </button>
        )}
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {projects.map((proj) => {
          const creator = employees.find((e) => e.id === proj.createdBy);
          const isMyProject = proj.createdBy === currentUserId;
          const projSessions = sessions.filter((s) => s.projectId === proj.id);
          const projAssignments = assignments.filter(
            (a) =>
              a.projectId === proj.id &&
              a.status !== 'WITHDRAWN' &&
              a.status !== 'RELEASED' &&
              a.status !== 'DECLINED' &&
              a.status !== 'REJECTED'
          );
          const confirmedMembers = projAssignments.filter((a) => a.status === 'APPROVED');
          const pendingMembers = projAssignments.filter((a) => a.status !== 'APPROVED');

          return (
            <div
              key={proj.id}
              className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between overflow-hidden hover:border-slate-300 transition-all"
            >
              {/* Card Header Strip */}
              <div className="p-4 border-b border-slate-100 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <span
                    className="w-3.5 h-3.5 rounded-full mt-1 shrink-0"
                    style={{ backgroundColor: proj.color }}
                  ></span>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm leading-snug">
                      {proj.name}
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      등록자: <strong>{creator?.name}</strong>{' '}
                      {isMyProject && (
                        <span className="text-blue-600 font-semibold">(본인 등록)</span>
                      )}
                    </p>
                  </div>
                </div>

                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${
                    proj.status === 'IN_PROGRESS'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : proj.status === 'RECRUITING'
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {proj.status === 'IN_PROGRESS'
                    ? '진행 중'
                    : proj.status === 'RECRUITING'
                    ? '인원 모집'
                    : '기획'}
                </span>
              </div>

              {/* Card Body */}
              <div className="p-4 space-y-3 flex-1 text-xs text-slate-600">
                <p className="line-clamp-2 text-slate-600 leading-relaxed">
                  {proj.description}
                </p>

                {/* Session Schedules */}
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      작업 세션 일정
                    </span>
                    {isMyProject && (
                      <button
                        onClick={() => setChangingSessionProjectId(proj.id)}
                        className="text-blue-600 hover:text-blue-800 text-[10px] font-medium flex items-center gap-0.5 cursor-pointer"
                      >
                        <CalendarClock className="w-3 h-3" />
                        <span>일정 변경</span>
                      </button>
                    )}
                  </div>
                  {projSessions.map((s) => (
                    <div key={s.id} className="text-[11px] text-slate-600 flex items-center justify-between">
                      <span>{s.title}</span>
                      <span className="font-semibold text-slate-800 tabular-nums">
                        {s.daysOfWeek ? s.daysOfWeek.map((d) => KR_DAYS[d]).join('·') : '단일'}{' '}
                        {s.startTime}~{s.endTime}
                      </span>
                    </div>
                  ))}
                  <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-200 flex justify-between">
                    <span>기간</span>
                    <span className="tabular-nums">
                      {proj.startDate} ~ {proj.endDate}
                    </span>
                  </div>
                </div>

                {/* Participant Count & Avatars */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1.5">
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      참여 현황 ({confirmedMembers.length}
                      {proj.headcount ? `/${proj.headcount}` : ''}명 확정)
                    </span>
                    {pendingMembers.length > 0 && (
                      <span className="text-amber-600 font-medium">
                        대기 {pendingMembers.length}명
                      </span>
                    )}
                  </div>

                  {/* Members list */}
                  <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                    {projAssignments.map((asg) => {
                      const emp = employees.find((e) => e.id === asg.employeeId);
                      const isConfirmed = asg.status === 'APPROVED';

                      return (
                        <div
                          key={asg.id}
                          className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100 text-[11px]"
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                isConfirmed ? 'bg-emerald-500' : 'bg-amber-500'
                              }`}
                            ></span>
                            <span className="font-semibold text-slate-800 truncate">
                              {emp?.name}
                            </span>
                            {asg.type === 'SELF' && (
                              <span className="text-[9px] text-slate-500">(본인)</span>
                            )}
                            <span className="text-[10px] text-slate-500">
                              {isConfirmed
                                ? '확정'
                                : asg.status === 'APPROVAL_PENDING'
                                ? '승인대기'
                                : '수락대기'}
                            </span>
                          </div>

                          {/* Creator Actions: Withdraw / Release */}
                          {isMyProject && (
                            <div className="flex items-center gap-1 shrink-0">
                              {isConfirmed ? (
                                <button
                                  onClick={() => releaseAssignment(asg.id)}
                                  className="text-[10px] text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                  title="참여 해제"
                                >
                                  해제
                                </button>
                              ) : (
                                <button
                                  onClick={() => withdrawAssignment(asg.id)}
                                  className="text-[10px] text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                  title="배정 취소"
                                >
                                  취소
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={() => onSelectProject(proj)}
                  className="text-xs text-slate-600 hover:text-blue-600 font-semibold cursor-pointer"
                >
                  상세 보기
                </button>

                {isMyProject ? (
                  <button
                    onClick={() => setAssigningProjectId(proj.id)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-xs shadow-2xs transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>직원 배정</span>
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-400 italic">
                    조회 전용 (타 허가권자 등록)
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------------------------------------------------- */}
      {/* Modal 1: Create Project Modal */}
      {/* ---------------------------------------------------- */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-blue-600" />
                <span>신규 프로젝트 등록 (허가권자 전용)</span>
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProjectSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">프로젝트명</label>
                <input
                  type="text"
                  required
                  placeholder="예: AI 고객 응대 챗봇 구축"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">설명 및 목표</label>
                <textarea
                  rows={2}
                  placeholder="프로젝트의 주요 목표와 업무 범위를 입력하세요."
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">시작일</label>
                  <input
                    type="date"
                    required
                    value={newStartDate}
                    onChange={(e) => setNewStartDate(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-blue-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">종료일</label>
                  <input
                    type="date"
                    required
                    value={newEndDate}
                    onChange={(e) => setNewEndDate(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">필요 인원 (선택)</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={newHeadcount}
                    onChange={(e) => setNewHeadcount(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-blue-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">캘린더 식별 색상</label>
                  <div className="flex items-center gap-2 mt-1">
                    {['#2563eb', '#7c3aed', '#059669', '#dc2626', '#d97706', '#db2777'].map((c) => (
                      <button
                        type="button"
                        key={c}
                        onClick={() => setNewColor(c)}
                        className={`w-6 h-6 rounded-full transition-transform ${
                          newColor === c ? 'scale-125 ring-2 ring-slate-900 ring-offset-2' : ''
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Session / Schedule configuration */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-blue-600" />
                  정기 작업 세션 설정 (RFC 5545 반복 규칙)
                </span>

                <div>
                  <label className="block text-slate-600 mb-1 font-medium">세션 명칭</label>
                  <input
                    type="text"
                    value={newSessionTitle}
                    onChange={(e) => setNewSessionTitle(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 mb-1 font-medium">반복 요일 선택</label>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((d) => {
                      const isSelected = newDaysOfWeek.includes(d);
                      return (
                        <button
                          type="button"
                          key={d}
                          onClick={() => {
                            if (isSelected) {
                              setNewDaysOfWeek(newDaysOfWeek.filter((x) => x !== d));
                            } else {
                              setNewDaysOfWeek([...newDaysOfWeek, d]);
                            }
                          }}
                          className={`w-8 h-8 rounded-lg font-bold text-xs transition-colors ${
                            isSelected
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {KR_DAYS[d]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-600 mb-1 font-medium">시작 시각</label>
                    <input
                      type="time"
                      value={newStartTime}
                      onChange={(e) => setNewStartTime(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1 font-medium">종료 시각</label>
                    <input
                      type="time"
                      value={newEndTime}
                      onChange={(e) => setNewEndTime(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-xs"
                >
                  프로젝트 등록 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Modal 2: Assign Employees Modal with Live Overlap Check */}
      {/* ---------------------------------------------------- */}
      {assigningProjectId && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-blue-600" />
                  <span>
                    직원 배정 및 시간 겹침 검증 - [
                    {projects.find((p) => p.id === assigningProjectId)?.name}]
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  규칙 F-202: 🟢 겹침 없음 | 🔴 시간 겹침 (경고 표시) | ⏳ 대기 중 상태를 실시간 확인합니다.
                </p>
              </div>
              <button
                onClick={() => setAssigningProjectId(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content List */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
              {employees.map((emp) => {
                const targetProj = projects.find((p) => p.id === assigningProjectId)!;
                const projSessions = sessions.filter((s) => s.projectId === assigningProjectId);

                // Check overlap
                const overlapRes = checkEmployeeOverlap(
                  emp.id,
                  targetProj,
                  projSessions,
                  projects,
                  sessions,
                  assignments,
                  allowedOverlaps,
                  employees,
                  assigningProjectId
                );

                // Check if already assigned
                const existingAsg = assignments.find(
                  (a) =>
                    a.projectId === assigningProjectId &&
                    a.employeeId === emp.id &&
                    a.status !== 'WITHDRAWN' &&
                    a.status !== 'RELEASED' &&
                    a.status !== 'DECLINED' &&
                    a.status !== 'REJECTED'
                );

                const isMe = emp.id === currentUserId;
                const dept = departments.find((d) => d.id === emp.departmentId)?.name;

                return (
                  <div
                    key={emp.id}
                    className={`p-3.5 rounded-xl border transition-all ${
                      existingAsg
                        ? 'bg-slate-50 border-slate-200 opacity-80'
                        : overlapRes.hasConflict
                        ? 'bg-rose-50/40 border-rose-200'
                        : overlapRes.pendingCount > 0
                        ? 'bg-amber-50/40 border-amber-200'
                        : 'bg-white border-slate-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                            emp.avatarColor || 'bg-slate-700'
                          }`}
                        >
                          {emp.name.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900">{emp.name}</span>
                            {isMe && (
                              <span className="text-[10px] px-1.5 py-0.2 bg-blue-100 text-blue-700 rounded-md font-semibold">
                                본인
                              </span>
                            )}
                            <span className="text-[10px] text-slate-500">
                              {dept} ·{' '}
                              {emp.role === 'APPROVER'
                                ? '허가권자'
                                : emp.role === 'ADMIN'
                                ? '관리자'
                                : '직원'}
                            </span>
                          </div>

                          {/* Overlap Status Badge */}
                          <div className="mt-1 flex items-center gap-2">
                            {existingAsg ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {existingAsg.status === 'APPROVED'
                                  ? '현재 참여 확정됨'
                                  : '현재 승인/수락 대기 중'}
                              </span>
                            ) : overlapRes.hasConflict ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700">
                                <span className="w-2 h-2 rounded-full bg-rose-600 inline-block"></span>
                                🔴 프로젝트 시간 겹침 발생 ({overlapRes.conflicts.length}건)
                              </span>
                            ) : overlapRes.pendingCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                                <span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>
                                ⏳ 타 프로젝트 대기 중 ({overlapRes.pendingCount}건)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                                🟢 겹침 없음 (즉시 배정 가능)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action Button */}
                      <div>
                        {existingAsg ? (
                          <span className="text-[11px] text-slate-400 font-medium px-3 py-1 bg-slate-200/60 rounded-md">
                            배정 완료
                          </span>
                        ) : (
                          <button
                            onClick={() => handleAssignClick(targetProj, emp)}
                            className={`px-3.5 py-1.5 rounded-lg font-semibold text-xs transition-colors flex items-center gap-1 cursor-pointer ${
                              isMe
                                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs'
                                : overlapRes.hasConflict
                                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>
                              {isMe
                                ? '나를 투입 (셀프 배정)'
                                : overlapRes.hasConflict
                                ? '경고 확인 후 배정'
                                : '배정 요청'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Conflict breakdown details */}
                    {!existingAsg && overlapRes.hasConflict && (
                      <div className="mt-2.5 pt-2 border-t border-rose-200/60 bg-white/60 p-2.5 rounded-lg space-y-1">
                        <div className="text-[11px] font-bold text-rose-800 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                          <span>충돌 세부 내역 (승인 단계에서 자동 차단 대상):</span>
                        </div>
                        {overlapRes.conflicts.slice(0, 2).map((conf, cIdx) => (
                          <div key={cIdx} className="text-[10px] text-slate-700 flex justify-between">
                            <span>
                              충돌 프로젝트: <strong>[{conf.conflictingProject.name}]</strong> (등록자:{' '}
                              {conf.conflictingProject.createdByName})
                            </span>
                            <span className="font-semibold text-rose-700 tabular-nums">
                              {conf.targetSession.dateStr} {conf.targetSession.startTime}~
                              {conf.targetSession.endTime}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setAssigningProjectId(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Modal 3: Self Assign Warning Confirmation Modal */}
      {/* ---------------------------------------------------- */}
      {selfAssignConfirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-3 text-amber-600 mb-3">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-slate-900">
                허가권자 셀프 투입 겹침 경고 확인
              </h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              설계 문서 v1.0 확정 규칙: 허가권자가 자기 프로젝트에 자신을 투입할 때는 누구의 승인도 필요하지 않으며,
              다른 확정 프로젝트와 시간이 겹쳐도 <strong>경고 확인 후 허용</strong>됩니다.
            </p>

            <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg text-xs text-amber-900 space-y-1 mb-5">
              <span className="font-bold">발생한 시간 겹침:</span>
              {selfAssignConfirmModal.conflicts.slice(0, 3).map((c, i) => (
                <div key={i} className="text-[11px]">
                  · [{c.conflictingProject.name}] 세션과 시간 중복 ({c.targetSession.dateStr}{' '}
                  {c.targetSession.startTime}~{c.targetSession.endTime})
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setSelfAssignConfirmModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                취소
              </button>
              <button
                onClick={handleConfirmSelfAssign}
                className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs"
              >
                경고 확인 후 투입 확정
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Modal 4: Session Schedule Change Modal */}
      {/* ---------------------------------------------------- */}
      {changingSessionProjectId && (
        <SessionChangeModal
          projectId={changingSessionProjectId}
          onClose={() => setChangingSessionProjectId(null)}
          onSuccess={(msg) => {
            showToast(msg);
            setChangingSessionProjectId(null);
          }}
          onRequestWarningConfirm={(newSessions, conflicts) => {
            setOwnWarningConfirmModal({
              projectId: changingSessionProjectId,
              newSessions,
              conflicts,
            });
          }}
        />
      )}

      {/* ---------------------------------------------------- */}
      {/* Modal 5: Own Project Schedule Warning Confirm Modal */}
      {/* ---------------------------------------------------- */}
      {ownWarningConfirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-3 text-amber-600 mb-3">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-slate-900">
                본인 등록 프로젝트 겹침 경고 확인
              </h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              설계 문서 v1.0 확정 규칙: 겹치는 프로젝트 역시 <strong>본인이 등록한 프로젝트</strong>인 경우,
              경고 확인 후 즉시 저장되며 <strong>직원의 별도 동의가 불필요</strong>합니다.
            </p>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setOwnWarningConfirmModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  const res = await requestSessionChange(
                    ownWarningConfirmModal.projectId,
                    ownWarningConfirmModal.newSessions,
                    true
                  );
                  if (res.success) {
                    showToast('경고 확인 후 일정이 즉시 반영되었습니다.');
                    setOwnWarningConfirmModal(null);
                    setChangingSessionProjectId(null);
                  } else {
                    showToast(res.error || '반영 실패', true);
                  }
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs"
              >
                경고 확인 후 저장 반영
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Subcomponent for Schedule Change with Impact Analysis
 */
const SessionChangeModal: React.FC<{
  projectId: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onRequestWarningConfirm: (
    newSessions: Omit<ProjectSession, 'id' | 'projectId'>[],
    conflicts: ConflictDetail[]
  ) => void;
}> = ({ projectId, onClose, onSuccess, onRequestWarningConfirm }) => {
  const { projects, sessions, requestSessionChange } = useApp();
  const proj = projects.find((p) => p.id === projectId)!;
  const currentSession = sessions.find((s) => s.projectId === projectId);

  const [title, setTitle] = useState(currentSession?.title || '작업 세션');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    currentSession?.daysOfWeek || [2, 4]
  );
  const [startTime, setStartTime] = useState(currentSession?.startTime || '14:00');
  const [endTime, setEndTime] = useState(currentSession?.endTime || '17:00');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newSessionPayload: Omit<ProjectSession, 'id' | 'projectId'> = {
      title,
      startAt: `${proj.startDate}T${startTime}:00Z`,
      endAt: `${proj.endDate}T${endTime}:00Z`,
      rrule: `FREQ=WEEKLY;BYDAY=${daysOfWeek.map((d) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d]).join(',')}`,
      daysOfWeek,
      startTime,
      endTime,
      timezone: 'Asia/Seoul',
    };

    const res = await requestSessionChange(projectId, [newSessionPayload]);

    if (res.needWarningConfirm && res.warningConflicts) {
      onRequestWarningConfirm([newSessionPayload], res.warningConflicts);
      return;
    }

    if (res.appliedDirectly) {
      onSuccess('겹침이 없어 프로젝트 일정이 즉시 수정되었습니다.');
    } else if (res.changeRequestId) {
      onSuccess(
        '타 허가권자의 프로젝트와 겹침이 발생하여 [일정 변경 요청]이 생성되었습니다. (상대 허가권자 승인 + 직원 동의 대기)'
      );
    } else {
      alert(res.error || '일정 변경 실패');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-blue-600" />
            <span>프로젝트 일정 변경 - [{proj.name}]</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 leading-relaxed">
            <span className="font-bold block mb-1">일정 변경 워크플로 안내 (v1.0 확정 규칙):</span>
            · 겹침 없음: 즉시 반영 후 참가자 알림<br />
            · 본인 등록 프로젝트 간 겹침: 경고 확인 후 즉시 반영 (직원 동의 불필요)<br />
            · 타 허가권자 프로젝트와 겹침: 상대 허가권자 승인 + 해당 참여 직원 동의 필요
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">세션 명칭</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">반복 요일 선택</label>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((d) => {
                const isSelected = daysOfWeek.includes(d);
                return (
                  <button
                    type="button"
                    key={d}
                    onClick={() => {
                      if (isSelected) {
                        setDaysOfWeek(daysOfWeek.filter((x) => x !== d));
                      } else {
                        setDaysOfWeek([...daysOfWeek, d]);
                      }
                    }}
                    className={`w-8 h-8 rounded-lg font-bold text-xs transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-50 border border-slate-200 text-slate-600'
                    }`}
                  >
                    {KR_DAYS[d]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">시작 시각</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">종료 시각</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-xs"
            >
              일정 변경 검증 및 저장
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
