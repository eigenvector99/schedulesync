import React from 'react';
import { useApp } from '../context/AppContext';
import { Project } from '../types';
import { KR_DAYS } from '../utils/dateAndRrule';
import {
  X,
  Calendar,
  Clock,
  Users,
  CheckCircle2,
  AlertTriangle,
  User,
  ShieldCheck,
  FolderKanban,
} from 'lucide-react';

interface ProjectDetailModalProps {
  project: Project | null;
  onClose: () => void;
}

export const ProjectDetailModal: React.FC<ProjectDetailModalProps> = ({ project, onClose }) => {
  const { sessions, assignments, employees, departments } = useApp();

  if (!project) return null;

  const creator = employees.find((e) => e.id === project.createdBy);
  const projSessions = sessions.filter((s) => s.projectId === project.id);
  const projAssignments = assignments.filter((a) => a.projectId === project.id);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3 mb-4">
          <div className="flex items-start gap-3">
            <span
              className="w-4 h-4 rounded-full mt-1 shrink-0"
              style={{ backgroundColor: project.color }}
            />
            <div>
              <h3 className="text-lg font-bold text-slate-900">{project.name}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                등록자: <strong>{creator?.name}</strong> · 상태:{' '}
                <span className="font-semibold text-blue-700">
                  {project.status === 'IN_PROGRESS'
                    ? '진행 중'
                    : project.status === 'RECRUITING'
                    ? '모집 중'
                    : '기획'}
                </span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 text-xs">
          <div>
            <h4 className="font-semibold text-slate-700 mb-1">프로젝트 설명</h4>
            <p className="text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
              {project.description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <span className="text-[11px] text-slate-500 block mb-0.5">프로젝트 기간</span>
              <span className="font-semibold text-slate-800 tabular-nums">
                {project.startDate} ~ {project.endDate}
              </span>
            </div>
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <span className="text-[11px] text-slate-500 block mb-0.5">필요 인원</span>
              <span className="font-semibold text-slate-800 tabular-nums">
                {project.headcount ? `${project.headcount}명` : '제한 없음'}
              </span>
            </div>
          </div>

          {/* Sessions */}
          <div>
            <h4 className="font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-blue-600" />
              <span>등록된 작업 세션 일정</span>
            </h4>
            <div className="space-y-2">
              {projSessions.map((s) => (
                <div
                  key={s.id}
                  className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between"
                >
                  <div>
                    <span className="font-semibold text-slate-800 block">{s.title}</span>
                    <span className="text-[11px] text-slate-500">
                      반복: {s.daysOfWeek ? s.daysOfWeek.map((d) => KR_DAYS[d]).join(', ') : '단일 일정'}
                    </span>
                  </div>
                  <span className="text-xs font-bold text-blue-700 tabular-nums bg-white px-2 py-1 rounded border border-slate-200">
                    {s.startTime} ~ {s.endTime}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Assigned Members */}
          <div>
            <h4 className="font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-blue-600" />
              <span>배정 및 참여 현황 ({projAssignments.length}명)</span>
            </h4>
            <div className="space-y-1.5">
              {projAssignments.length === 0 ? (
                <p className="text-slate-400 py-3 text-center bg-slate-50 rounded-lg">
                  배정된 인원이 없습니다.
                </p>
              ) : (
                projAssignments.map((asg) => {
                  const emp = employees.find((e) => e.id === asg.employeeId);
                  const dept = departments.find((d) => d.id === emp?.departmentId)?.name;
                  const isConfirmed = asg.status === 'APPROVED';

                  return (
                    <div
                      key={asg.id}
                      className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${
                            emp?.avatarColor || 'bg-slate-700'
                          }`}
                        >
                          {emp?.name.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-800">{emp?.name}</span>
                            <span className="text-[10px] text-slate-500">{dept}</span>
                            {asg.type === 'SELF' && (
                              <span className="text-[10px] text-indigo-700 font-semibold">(셀프 투입)</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isConfirmed ? (
                          <span className="text-[11px] font-bold text-emerald-700 flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5" /> 최종 확정
                          </span>
                        ) : asg.status === 'APPROVAL_PENDING' ? (
                          <span className="text-[11px] font-semibold text-amber-800 flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded border border-amber-300">
                            <Clock className="w-3.5 h-3.5" /> 허가권자 승인 대기
                          </span>
                        ) : asg.status === 'EMPLOYEE_PENDING' ? (
                          <span className="text-[11px] font-semibold text-blue-800 flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                            <Clock className="w-3.5 h-3.5" /> 직원 수락 대기
                          </span>
                        ) : asg.status === 'DECLINED' ? (
                          <span className="text-[11px] font-medium text-slate-500">거절됨</span>
                        ) : (
                          <span className="text-[11px] font-medium text-rose-600">반려됨</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 pt-3 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
