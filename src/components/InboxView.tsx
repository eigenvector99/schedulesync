import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Inbox,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Calendar,
  UserCheck,
  ShieldCheck,
  FileText,
  AlertCircle,
  ChevronRight,
  Info,
} from 'lucide-react';
import { Assignment, SessionChangeRequest, Project, CHANGE_CLOSE_REASONS } from '../types';
import { KR_DAYS, checkEmployeeOverlap, formatDateTime } from '../utils/dateAndRrule';

interface InboxViewProps {
  onSelectProject: (project: Project) => void;
}

export const InboxView: React.FC<InboxViewProps> = ({ onSelectProject }) => {
  const {
    currentUserId,
    currentUser,
    assignments,
    projects,
    sessions,
    employees,
    departments,
    changeRequests,
    allowedOverlaps,
    respondAssignment,
    decideApproval,
    decideChangeRequest,
    withdrawChangeRequest,
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'accept' | 'approval' | 'change'>('accept');

  // Decline / Reject modal state
  const [rejectModalState, setRejectModalState] = useState<{
    type: 'ASSIGNMENT_DECLINE' | 'APPROVAL_REJECT' | 'CHANGE_REJECT';
    targetId: string;
    targetTitle: string;
    isMandatory: boolean;
  } | null>(null);

  const [rejectReason, setRejectReason] = useState('');
  const [toastMessage, setToastMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  const showToast = (text: string, isError: boolean = false) => {
    setToastMessage({ text, isError });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 1. My Pending Assignments (수락 대기)
  const myPendingAcceptances = assignments.filter(
    (a) => a.employeeId === currentUserId && a.status === 'EMPLOYEE_PENDING'
  );

  // 2. Approver Dual Review Queue (일반 직원 배정 허가권자 전원 승인 대기)
  const approverReviewList =
    currentUser?.role === 'APPROVER'
      ? assignments.filter((a) => a.status === 'APPROVAL_PENDING')
      : [];

  // 3. Schedule Change Requests Queue (허가권자 승인 + 직원 동의 대기)
  const changeReviewList = changeRequests.filter(
    (cr) =>
      cr.status === 'CHANGE_PENDING' &&
      cr.decisions.some((d) => d.actorId === currentUserId)
  );

  // 3-b. Requests I filed myself: pending ones can be withdrawn; closed ones explain why nothing happened.
  const myChangeRequests = changeRequests
    .filter((cr) => cr.requestedBy === currentUserId && (cr.status === 'CHANGE_PENDING' || !!cr.closedReason))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 6);

  // Handle Accept assignment
  const handleAcceptAssignment = async (asg: Assignment) => {
    const res = await respondAssignment(asg.id, true);
    if (res.success) {
      if (asg.type === 'APPROVER') {
        showToast('배정을 수락하여 참여가 최종 확정되었습니다.');
      } else {
        showToast('배정을 수락하였습니다. 허가권자 전원의 승인 대기로 전환되었습니다.');
      }
    } else {
      showToast(res.error || '수락 실패', true);
    }
  };

  // Handle Approve by Approver
  const handleApproveAssignment = async (asg: Assignment) => {
    const res = await decideApproval(asg.id, 'APPROVED');
    if (res.success) {
      showToast('배정 건을 승인하였습니다.');
    } else {
      showToast(res.error || '승인 실패', true);
    }
  };

  // Handle Rejection Submit
  const handleConfirmRejection = async () => {
    if (!rejectModalState) return;

    if (rejectModalState.isMandatory && !rejectReason.trim()) {
      alert('반려 사유를 반드시 입력해야 합니다.');
      return;
    }

    if (rejectModalState.type === 'ASSIGNMENT_DECLINE') {
      const res = await respondAssignment(rejectModalState.targetId, false, rejectReason);
      if (res.success) {
        showToast('배정을 거절하였습니다.');
      } else {
        showToast(res.error || '거절 처리 실패', true);
      }
    } else if (rejectModalState.type === 'APPROVAL_REJECT') {
      const res = await decideApproval(rejectModalState.targetId, 'REJECTED', rejectReason);
      if (res.success) {
        showToast('배정을 반려하였습니다 (전체 반려 처리).');
      } else {
        showToast(res.error || '반려 처리 실패', true);
      }
    } else if (rejectModalState.type === 'CHANGE_REJECT') {
      const res = await decideChangeRequest(rejectModalState.targetId, 'REJECTED', rejectReason);
      if (res.success) {
        showToast('일정 변경을 반려하였습니다 (기존 일정 유지).');
      } else {
        showToast(res.error || '반려 실패', true);
      }
    }

    setRejectModalState(null);
    setRejectReason('');
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

      {/* Top Banner and Tabs */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Inbox className="w-5 h-5 text-blue-600" />
              <span>내 처리함 (결재 & 동의 센터)</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              현재 접속자({currentUser?.name})에게 도달한 배정 수락, 허가권자 승인 및 일정 변경 동의 건입니다.
            </p>
          </div>
        </div>

        {/* Sub Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 text-xs">
          <button
            onClick={() => setActiveSubTab('accept')}
            className={`pb-2.5 px-3 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeSubTab === 'accept'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>배정 수락 대기</span>
            {myPendingAcceptances.length > 0 && (
              <span className="px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded-full text-[10px]">
                {myPendingAcceptances.length}
              </span>
            )}
          </button>

          {currentUser?.role === 'APPROVER' && (
            <button
              onClick={() => setActiveSubTab('approval')}
              className={`pb-2.5 px-3 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
                activeSubTab === 'approval'
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>허가권자 배정 승인함</span>
              {approverReviewList.length > 0 && (
                <span className="px-1.5 py-0.2 bg-amber-100 text-amber-800 rounded-full text-[10px]">
                  {approverReviewList.length}
                </span>
              )}
            </button>
          )}

          <button
            onClick={() => setActiveSubTab('change')}
            className={`pb-2.5 px-3 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeSubTab === 'change'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>일정 변경 승인·동의함</span>
            {changeReviewList.length > 0 && (
              <span className="px-1.5 py-0.2 bg-purple-100 text-purple-800 rounded-full text-[10px]">
                {changeReviewList.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ----------------------------------------------------------- */}
      {/* Tab 1: My Pending Acceptances (배정 수락 대기) */}
      {/* ----------------------------------------------------------- */}
      {activeSubTab === 'accept' && (
        <div className="space-y-4">
          {myPendingAcceptances.length === 0 ? (
            <div className="bg-white p-10 rounded-xl border border-slate-200 text-center text-xs text-slate-400">
              현재 본인에게 대기 중인 프로젝트 배정 요청이 없습니다.
            </div>
          ) : (
            myPendingAcceptances.map((asg) => {
              const proj = projects.find((p) => p.id === asg.projectId);
              if (!proj) return null;

              const assigner = employees.find((e) => e.id === asg.assignedBy);
              const projSessions = sessions.filter((s) => s.projectId === proj.id);

              // Check overlap
              const overlapRes = checkEmployeeOverlap(
                currentUserId,
                proj,
                projSessions,
                projects,
                sessions,
                assignments,
                allowedOverlaps,
                employees,
                proj.id
              );

              return (
                <div
                  key={asg.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded font-semibold border border-blue-200">
                          {asg.type === 'APPROVER' ? '허가권자 배정' : '일반 직원 배정'}
                        </span>
                        <h3 className="text-base font-bold text-slate-900">{proj.name}</h3>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        배정자: <strong>{assigner?.name}</strong> · 배정일시:{' '}
                        {formatDateTime(asg.createdAt)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setRejectModalState({
                            type: 'ASSIGNMENT_DECLINE',
                            targetId: asg.id,
                            targetTitle: proj.name,
                            isMandatory: false,
                          })
                        }
                        className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                      >
                        배정 거절
                      </button>
                      <button
                        onClick={() => handleAcceptAssignment(asg)}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>수락하기</span>
                      </button>
                    </div>
                  </div>

                  {/* Sessions & Time Details */}
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200/80 text-xs space-y-2">
                    <span className="font-semibold text-slate-700 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      참여 요청 일정:
                    </span>
                    {projSessions.map((s) => (
                      <div key={s.id} className="text-slate-600 flex justify-between">
                        <span>{s.title}</span>
                        <span className="font-semibold text-slate-800 tabular-nums">
                          {s.daysOfWeek ? s.daysOfWeek.map((d) => KR_DAYS[d]).join('·') : '단일'}{' '}
                          {s.startTime}~{s.endTime}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Overlap Status Warning */}
                  {overlapRes.hasConflict && (
                    <div className="bg-rose-50 border border-rose-200 p-3 rounded-lg text-xs text-rose-900 space-y-1">
                      <div className="font-bold flex items-center gap-1.5 text-rose-800">
                        <AlertTriangle className="w-4 h-4 text-rose-600" />
                        <span>시간 겹침 경고: 이미 확정된 다른 프로젝트와 일정이 겹칩니다!</span>
                      </div>
                      <p className="text-[11px] text-rose-700">
                        규칙 F-203/F-403: 일반 직원의 경우 수락은 가능하지만, 추후 허가권자 승인 단계에서 겹침이 해소되지 않으면 승인이 차단됩니다.
                      </p>
                      {overlapRes.conflicts.map((c, i) => (
                        <div key={i} className="text-[11px] text-rose-800">
                          · [{c.conflictingProject.name}] ({c.targetSession.dateStr}{' '}
                          {c.targetSession.startTime}~{c.targetSession.endTime})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- */}
      {/* Tab 2: Approver Review Queue (허가권자 전원 승인함) */}
      {/* ----------------------------------------------------------- */}
      {activeSubTab === 'approval' && currentUser?.role === 'APPROVER' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg text-xs text-blue-900 leading-relaxed">
            <span className="font-bold block mb-1">
              규칙 F-401 ~ F-404: 일반 직원 배정 승인 업무 규칙
            </span>
            · <strong>허가권자 전원(A와 B)이 모두 승인</strong>해야 최종 확정됩니다.<br />
            · <strong>1명이라도 반려하면 전체 반려</strong>되며 반려 사유 입력이 필수입니다.<br />
            · 다른 확정 프로젝트와 <strong>시간이 겹치는 동안에는 승인 버튼이 자동 잠금</strong>됩니다.
          </div>

          {approverReviewList.length === 0 ? (
            <div className="bg-white p-10 rounded-xl border border-slate-200 text-center text-xs text-slate-400">
              승인 대기 중인 일반 직원 배정 건이 없습니다.
            </div>
          ) : (
            approverReviewList.map((asg) => {
              const proj = projects.find((p) => p.id === asg.projectId);
              const targetEmp = employees.find((e) => e.id === asg.employeeId);
              const assigner = employees.find((e) => e.id === asg.assignedBy);
              if (!proj || !targetEmp) return null;

              const projSessions = sessions.filter((s) => s.projectId === proj.id);

              // Live Overlap Check
              const overlapRes = checkEmployeeOverlap(
                targetEmp.id,
                proj,
                projSessions,
                projects,
                sessions,
                assignments,
                allowedOverlaps,
                employees,
                proj.id
              );

              // Current Approver Decision State
              const myDecision = asg.approvalDecisions.find(
                (d) => d.approverId === currentUserId
              );
              const hasAlreadyApproved = myDecision?.decision === 'APPROVED';

              return (
                <div
                  key={asg.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-800 rounded font-semibold border border-amber-300">
                          허가권자 승인 대기
                        </span>
                        <h3 className="text-base font-bold text-slate-900">
                          {targetEmp.name} 직원 배정 승인 건 - [{proj.name}]
                        </h3>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        프로젝트 등록: {assigner?.name} · 대상자:{' '}
                        <strong>
                          {targetEmp.name} (
                          {departments.find((d) => d.id === targetEmp.departmentId)?.name})
                        </strong>
                      </p>
                    </div>

                    {/* Approver Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setRejectModalState({
                            type: 'APPROVAL_REJECT',
                            targetId: asg.id,
                            targetTitle: `${targetEmp.name} - ${proj.name}`,
                            isMandatory: true,
                          })
                        }
                        className="px-3.5 py-2 border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>반려 (사유 필수)</span>
                      </button>

                      {hasAlreadyApproved ? (
                        <div className="px-4 py-2 bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-bold rounded-lg flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span>본인 승인 완료 (타 허가권자 대기)</span>
                        </div>
                      ) : (
                        <button
                          disabled={overlapRes.hasConflict}
                          onClick={() => handleApproveAssignment(asg)}
                          className={`px-4 py-2 text-xs font-bold rounded-lg shadow-xs transition-colors flex items-center gap-1.5 ${
                            overlapRes.hasConflict
                              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                              : 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                          }`}
                          title={
                            overlapRes.hasConflict
                              ? '다른 확정 프로젝트와 시간이 겹쳐 승인이 차단되었습니다.'
                              : '승인하기'
                          }
                        >
                          <ShieldCheck className="w-4 h-4" />
                          <span>
                            {overlapRes.hasConflict ? '승인 차단 (시간 겹침)' : '승인하기'}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* All Approvers Status Strip */}
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1.5 text-xs">
                    <span className="font-semibold text-slate-700">허가권자별 승인 현황:</span>
                    <div className="flex flex-wrap items-center gap-4">
                      {asg.approvalDecisions.map((dec) => {
                        const approver = employees.find((e) => e.id === dec.approverId);
                        const isApproved = dec.decision === 'APPROVED';

                        return (
                          <div
                            key={dec.id}
                            className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-md border border-slate-200"
                          >
                            <span className="font-semibold text-slate-800">
                              {approver?.name}:
                            </span>
                            {isApproved ? (
                              <span className="text-emerald-700 font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> 승인 완료
                              </span>
                            ) : (
                              <span className="text-amber-700 font-medium flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" /> 승인 대기
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Overlap Warning Alert */}
                  {overlapRes.hasConflict && (
                    <div className="bg-rose-50 border border-rose-200 p-3 rounded-lg text-xs text-rose-900 space-y-1">
                      <div className="font-bold flex items-center gap-1.5 text-rose-800">
                        <AlertTriangle className="w-4 h-4 text-rose-600" />
                        <span>규칙 F-403: 시간 겹침으로 인한 승인 차단</span>
                      </div>
                      <p className="text-[11px] text-rose-700">
                        대상 직원이 이미 확정된 다른 프로젝트 세션과 시간이 겹칩니다. 겹치는 일정이 조정되기 전까지는 승인이 불가하며, 반려만 가능합니다.
                      </p>
                      {overlapRes.conflicts.map((c, i) => (
                        <div key={i} className="text-[11px] font-semibold text-rose-800">
                          · 충돌 프로젝트 [{c.conflictingProject.name}] (등록자:{' '}
                          {c.conflictingProject.createdByName}) / 시간: {c.targetSession.dateStr}{' '}
                          {c.targetSession.startTime}~{c.targetSession.endTime}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- */}
      {/* Tab 3: Schedule Change Requests Queue (일정 변경 승인·동의) */}
      {/* ----------------------------------------------------------- */}
      {activeSubTab === 'change' && (
        <div className="space-y-4">
          <div className="bg-purple-50 border border-purple-200 p-3 rounded-lg text-xs text-purple-900 leading-relaxed">
            <span className="font-bold block mb-1">
              규칙 3.7: 확정 후 프로젝트 일정 변경 승인 및 동의 규칙
            </span>
            · 상대 허가권자 등록 프로젝트와 겹치는 경우: <strong>상대 허가권자 승인 + 해당 참여 직원 동의</strong>가 모두 있어야 변경이 반영됩니다.<br />
            · 승인자 반려 또는 동의 대상자 1명이라도 거절 시 전체 반려되며, <strong>기존 일정이 유지</strong>됩니다.
          </div>

          {myChangeRequests.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-2 text-xs">
              <span className="font-semibold text-slate-800">내가 요청한 일정 변경</span>
              {myChangeRequests.map((cr) => {
                const proj = projects.find((p) => p.id === cr.projectId);
                const pending = cr.status === 'CHANGE_PENDING';
                const done = cr.decisions.filter((d) => d.decision === 'APPROVED').length;
                return (
                  <div key={cr.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="space-y-0.5">
                      <div className="font-medium text-slate-900">[{proj?.name}] · {formatDateTime(cr.createdAt)}</div>
                      {pending ? (
                        <div className="text-slate-600">승인·동의 {done}/{cr.decisions.length} 완료 — 모두 완료되면 반영됩니다.</div>
                      ) : (
                        <div className="text-amber-800">{cr.closedReason ? CHANGE_CLOSE_REASONS[cr.closedReason] : '종료됨'}</div>
                      )}
                    </div>
                    {pending && (
                      <button
                        onClick={async () => {
                          const res = await withdrawChangeRequest(cr.id);
                          if (res.success) showToast('일정 변경 요청을 철회했습니다.');
                          else showToast(res.error || '철회 실패', true);
                        }}
                        className="px-3 py-1.5 border border-slate-300 text-slate-700 hover:bg-white font-semibold rounded-lg cursor-pointer"
                      >
                        요청 철회
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {changeReviewList.length === 0 ? (
            <div className="bg-white p-10 rounded-xl border border-slate-200 text-center text-xs text-slate-400">
              처리할 일정 변경 승인 또는 동의 요청이 없습니다.
            </div>
          ) : (
            changeReviewList.map((cr) => {
              const proj = projects.find((p) => p.id === cr.projectId);
              const requester = employees.find((e) => e.id === cr.requestedBy);
              const myDecision = cr.decisions.find((d) => d.actorId === currentUserId);

              const isApprovedByMe = myDecision?.decision === 'APPROVED';

              return (
                <div
                  key={cr.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-800 rounded font-semibold border border-purple-300">
                          {myDecision?.kind === 'APPROVAL'
                            ? '허가권자 승인 요청'
                            : myDecision?.kind === 'BOTH'
                            ? '승인 및 동의 통합 요청'
                            : '참여 직원 동의 요청'}
                        </span>
                        <h3 className="text-base font-bold text-slate-900">
                          [{proj?.name}] 프로젝트 일정 변경 요청
                        </h3>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        변경 요청 허가권자: <strong>{requester?.name}</strong> · 요청일시:{' '}
                        {formatDateTime(cr.createdAt)}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setRejectModalState({
                            type: 'CHANGE_REJECT',
                            targetId: cr.id,
                            targetTitle: `일정 변경 - ${proj?.name}`,
                            isMandatory: true,
                          })
                        }
                        className="px-3.5 py-2 border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                      >
                        반려 / 거절
                      </button>

                      {isApprovedByMe ? (
                        <div className="px-4 py-2 bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-bold rounded-lg flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span>본인 결정 완료</span>
                        </div>
                      ) : (
                        <button
                          onClick={async () => {
                            const res = await decideChangeRequest(cr.id, 'APPROVED');
                            if (res.success) {
                              showToast('일정 변경 요청을 승인/동의하였습니다.');
                            } else {
                              showToast(res.error || '처리 실패', true);
                            }
                          }}
                          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>승인 / 동의하기</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Proposed Sessions Info */}
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1">
                    <span className="font-semibold text-slate-800">제안된 신규 일정:</span>
                    {cr.proposedSessions.map((s, idx) => (
                      <div key={idx} className="text-slate-700 flex justify-between">
                        <span>{s.title}</span>
                        <span className="font-semibold tabular-nums">
                          {s.daysOfWeek ? s.daysOfWeek.map((d) => KR_DAYS[d]).join('·') : '단일'}{' '}
                          {s.startTime}~{s.endTime}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Decisions Progress */}
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2 text-xs">
                    <span className="font-semibold text-slate-800">필요한 승인 및 동의 현황:</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {cr.decisions.map((dec) => {
                        const actor = employees.find((e) => e.id === dec.actorId);
                        const isDone = dec.decision === 'APPROVED';

                        return (
                          <div
                            key={dec.id}
                            className="bg-white p-2 rounded border border-slate-200 flex items-center justify-between"
                          >
                            <span className="font-medium text-slate-800">
                              {actor?.name} (
                              {dec.kind === 'APPROVAL'
                                ? '허가권자 승인'
                                : dec.kind === 'BOTH'
                                ? '승인 및 동의'
                                : '직원 동의'}
                              )
                            </span>
                            {isDone ? (
                              <span className="text-emerald-700 font-bold flex items-center gap-1 text-[11px]">
                                <CheckCircle2 className="w-3.5 h-3.5" /> 완료
                              </span>
                            ) : (
                              <span className="text-amber-700 font-medium flex items-center gap-1 text-[11px]">
                                <Clock className="w-3.5 h-3.5" /> 대기 중
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- */}
      {/* Rejection / Decline Modal with Mandatory Reason */}
      {/* ----------------------------------------------------------- */}
      {rejectModalState && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-2.5 text-rose-600 mb-3">
              <XCircle className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900">
                {rejectModalState.type === 'ASSIGNMENT_DECLINE'
                  ? '배정 거절'
                  : '승인 / 변경 반려'}
              </h3>
            </div>
            <p className="text-xs text-slate-600 mb-3">
              [{rejectModalState.targetTitle}] 건에 대해{' '}
              {rejectModalState.isMandatory ? '반려' : '거절'}을 진행합니다.
            </p>

            <div className="space-y-1.5 mb-5 text-xs">
              <label className="block font-semibold text-slate-800">
                사유 입력 {rejectModalState.isMandatory ? '(필수)' : '(선택)'}
              </label>
              <textarea
                rows={3}
                placeholder={
                  rejectModalState.isMandatory
                    ? '반려 사유를 구체적으로 입력하세요. (필수)'
                    : '거절 사유를 입력하세요 (생략 가능).'
                }
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 text-xs">
              <button
                onClick={() => {
                  setRejectModalState(null);
                  setRejectReason('');
                }}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-semibold"
              >
                취소
              </button>
              <button
                onClick={handleConfirmRejection}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg shadow-xs"
              >
                확인 및 반려
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
