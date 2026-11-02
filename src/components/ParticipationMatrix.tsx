import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Search, Filter, CheckCircle2, Clock, Users, ArrowUpRight } from 'lucide-react';
import { Project } from '../types';

interface ParticipationMatrixProps {
  onSelectProject: (project: Project) => void;
}

export const ParticipationMatrix: React.FC<ParticipationMatrixProps> = ({ onSelectProject }) => {
  const { employees, departments, projects, assignments } = useApp();
  const [selectedDeptId, setSelectedDeptId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const activeProjects = useMemo(() => {
    return projects.filter((p) => p.status !== 'CANCELLED');
  }, [projects]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      if (selectedDeptId !== 'ALL' && emp.departmentId !== selectedDeptId) return false;
      if (searchQuery.trim() && !emp.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [employees, selectedDeptId, searchQuery]);

  return (
    <div className="space-y-4">
      {/* Header and Controls */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span>전사 프로젝트 참여 현황표</span>
            <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md border border-blue-200 font-medium">
              전 직원 공개
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            누가 어떤 프로젝트에 참여 중(확정/대기)인지 한눈에 파악할 수 있는 매트릭스 뷰입니다.
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <select
            value={selectedDeptId}
            onChange={(e) => setSelectedDeptId(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-blue-500"
          >
            <option value="ALL">전체 부서</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="직원 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-blue-500 w-40"
            />
          </div>
        </div>
      </div>

      {/* Matrix Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs min-w-[800px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                <th className="p-3 sticky left-0 z-20 bg-slate-50 border-r border-slate-200 w-52 shadow-xs">
                  직원 / 부서
                </th>
                {activeProjects.map((proj) => {
                  const confirmedCount = assignments.filter(
                    (a) => a.projectId === proj.id && a.status === 'APPROVED'
                  ).length;

                  return (
                    <th
                      key={proj.id}
                      className="p-3 border-r border-slate-200 min-w-[160px] cursor-pointer hover:bg-slate-100/80 transition-colors"
                      onClick={() => onSelectProject(proj)}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-slate-900 truncate" title={proj.name}>
                          {proj.name}
                        </span>
                        <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
                        <span>
                          {proj.status === 'IN_PROGRESS'
                            ? '진행 중'
                            : proj.status === 'RECRUITING'
                            ? '모집 중'
                            : '기획'}
                        </span>
                        <span className="font-semibold text-slate-700 tabular-nums">
                          {confirmedCount}
                          {proj.headcount ? `/${proj.headcount}명` : '명'}
                        </span>
                      </div>
                    </th>
                  );
                })}
                <th className="p-3 text-center w-28 bg-slate-100/70 font-semibold text-slate-700">
                  참여 프로젝트 수
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200">
              {filteredEmployees.map((emp) => {
                const dept = departments.find((d) => d.id === emp.departmentId)?.name || '부서';

                const empConfirmedAssignments = assignments.filter(
                  (a) => a.employeeId === emp.id && a.status === 'APPROVED'
                );

                return (
                  <tr key={emp.id} className="hover:bg-slate-50/60 transition-colors">
                    {/* Employee Profile Cell */}
                    <td className="p-3 sticky left-0 z-10 bg-white border-r border-slate-200 shadow-xs">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold ${
                            emp.avatarColor || 'bg-slate-700'
                          }`}
                        >
                          {emp.name.charAt(0)}
                        </div>
                        <div className="truncate">
                          <span className="font-bold text-slate-900 block truncate">
                            {emp.name}
                          </span>
                          <span className="text-[10px] text-slate-500 block truncate">
                            {dept}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Project Participation Cells */}
                    {activeProjects.map((proj) => {
                      const asg = assignments.find(
                        (a) =>
                          a.projectId === proj.id &&
                          a.employeeId === emp.id &&
                          a.status !== 'WITHDRAWN' &&
                          a.status !== 'RELEASED' &&
                          a.status !== 'DECLINED' &&
                          a.status !== 'REJECTED'
                      );

                      return (
                        <td key={proj.id} className="p-3 border-r border-slate-200 align-middle">
                          {asg ? (
                            asg.status === 'APPROVED' ? (
                              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                <span>참여 확정</span>
                                {asg.type === 'SELF' && (
                                  <span className="text-[9px] text-emerald-600 ml-0.5">(본인)</span>
                                )}
                              </div>
                            ) : asg.status === 'APPROVAL_PENDING' ? (
                              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-300">
                                <Clock className="w-3.5 h-3.5 text-amber-600" />
                                <span>승인 대기</span>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-blue-50 text-blue-800 border border-blue-200">
                                <Clock className="w-3.5 h-3.5 text-blue-600" />
                                <span>수락 대기</span>
                              </div>
                            )
                          ) : (
                            <span className="text-slate-300 font-mono pl-3">-</span>
                          )}
                        </td>
                      );
                    })}

                    {/* Total Confirmed Projects Count */}
                    <td className="p-3 text-center bg-slate-50/50 font-bold text-slate-800 tabular-nums">
                      {empConfirmedAssignments.length}개
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
