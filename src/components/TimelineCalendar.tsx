import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatDate,
  formatTime,
  getDaysRange,
  expandSessions,
  isOverlapAllowed,
} from '../utils/dateAndRrule';
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  Calendar as CalendarIcon,
  Clock,
  AlertTriangle,
  Info,
  CheckCircle,
} from 'lucide-react';
import { Project, ExpandedSessionInstance } from '../types';

interface TimelineCalendarProps {
  onSelectProject: (project: Project) => void;
}

export const TimelineCalendar: React.FC<TimelineCalendarProps> = ({ onSelectProject }) => {
  const {
    employees,
    departments,
    projects,
    sessions,
    assignments,
    allowedOverlaps,
  } = useApp();

  // Calendar Controls
  const [baseDate, setBaseDate] = useState<string>('2026-11-01');
  const [rangeMode, setRangeMode] = useState<'7' | '14'>('14');
  const [selectedDeptId, setSelectedDeptId] = useState<string>('ALL');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const numDays = parseInt(rangeMode, 10);
  const days = useMemo(() => getDaysRange(baseDate, numDays), [baseDate, numDays]);

  // Navigate date range
  const handlePrev = () => {
    const cur = new Date(`${baseDate}T00:00:00`);
    cur.setDate(cur.getDate() - numDays);
    setBaseDate(formatDate(cur));
  };

  const handleNext = () => {
    const cur = new Date(`${baseDate}T00:00:00`);
    cur.setDate(cur.getDate() + numDays);
    setBaseDate(formatDate(cur));
  };

  const handleToday = () => {
    setBaseDate('2026-11-01');
  };

  // Filter employees
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      if (selectedDeptId !== 'ALL' && emp.departmentId !== selectedDeptId) return false;
      if (searchQuery.trim() && !emp.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [employees, selectedDeptId, searchQuery]);

  // Pre-expand sessions for all projects to render per employee
  // For each employee, collect session instances:
  // - from assignments with status === 'APPROVED' (solid)
  // - from assignments with status === 'APPROVAL_PENDING' or 'EMPLOYEE_PENDING' (dotted)
  const employeeScheduleMap = useMemo(() => {
    const map = new Map<string, ExpandedSessionInstance[]>();

    for (const emp of employees) {
      const empAssignments = assignments.filter((a) => {
        if (a.employeeId !== emp.id) return false;
        if (a.status === 'DECLINED' || a.status === 'REJECTED' || a.status === 'WITHDRAWN' || a.status === 'RELEASED') {
          return false;
        }
        if (selectedProjectId !== 'ALL' && a.projectId !== selectedProjectId) return false;
        return true;
      });

      const instances: ExpandedSessionInstance[] = [];

      for (const asg of empAssignments) {
        const proj = projects.find((p) => p.id === asg.projectId);
        if (!proj || proj.status === 'CANCELLED') continue;

        const projSessions = sessions.filter((s) => s.projectId === proj.id);
        const isPending = asg.status !== 'APPROVED';
        const expanded = expandSessions(proj, projSessions, isPending);

        instances.push(...expanded);
      }

      map.set(emp.id, instances);
    }

    return map;
  }, [employees, assignments, projects, sessions, selectedProjectId]);

  return (
    <div className="space-y-4">
      {/* 1. Header Toolbar: Date Controls & Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        {/* Date Navigator */}
        <div className="flex items-center gap-2">
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
            <button
              onClick={handlePrev}
              className="p-2 hover:bg-slate-200 text-slate-700 transition-colors"
              title="이전 기간"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleToday}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
            >
              오늘 (2026.11)
            </button>
            <button
              onClick={handleNext}
              className="p-2 hover:bg-slate-200 text-slate-700 transition-colors"
              title="다음 기간"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="text-sm font-bold text-slate-900 ml-2">
            {days[0]?.dateStr} ~ {days[days.length - 1]?.dateStr}
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg ml-2">
            <button
              onClick={() => setRangeMode('7')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                rangeMode === '7'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              7일 보기
            </button>
            <button
              onClick={() => setRangeMode('14')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                rangeMode === '14'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              14일 타임라인
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Department Filter */}
          <select
            value={selectedDeptId}
            onChange={(e) => setSelectedDeptId(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-blue-500"
          >
            <option value="ALL">전체 부서</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          {/* Project Filter */}
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-blue-500 max-w-[180px] truncate"
          >
            <option value="ALL">전체 프로젝트</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {/* Search Employee */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="직원 이름 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-blue-500 w-36 sm:w-44"
            />
          </div>
        </div>
      </div>

      {/* 2. Legend Bar */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 px-2">
        <div className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded bg-blue-600 inline-block shadow-2xs"></span>
          <span>확정된 참여 일정 (실선)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded border-2 border-dashed border-amber-500 bg-amber-50 inline-block"></span>
          <span>승인 또는 수락 대기 (점선)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-amber-600 font-bold">⚠️</span>
          <span>사전 허용된 겹침 세션</span>
        </div>
      </div>

      {/* 3. Main Timeline Grid (Rows: Employees, Cols: Dates) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left min-w-[900px]">
            {/* Header: Date Columns */}
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600 font-semibold">
                <th className="w-56 p-3 sticky left-0 z-20 bg-slate-50 border-r border-slate-200 shadow-xs">
                  직원 / 부서
                </th>
                {days.map((d) => {
                  const isWeekend = d.dayIndex === 0 || d.dayIndex === 6;
                  const isSunday = d.dayIndex === 0;
                  const isSaturday = d.dayIndex === 6;
                  return (
                    <th
                      key={d.dateStr}
                      className={`p-2 text-center border-r border-slate-200 min-w-[70px] ${
                        isWeekend ? 'bg-slate-100/60' : ''
                      }`}
                    >
                      <div
                        className={`text-[11px] font-bold ${
                          isSunday
                            ? 'text-rose-600'
                            : isSaturday
                            ? 'text-blue-600'
                            : 'text-slate-700'
                        }`}
                      >
                        {d.dayName}
                      </div>
                      <div className="text-[10px] text-slate-500 tabular-nums">
                        {d.dateStr.slice(5)}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            {/* Body: Employees Rows */}
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={days.length + 1} className="p-8 text-center text-slate-400">
                    검색 조건에 맞는 직원이 없습니다.
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => {
                  const dept = departments.find((d) => d.id === emp.departmentId)?.name || '부서';
                  const empSessions = employeeScheduleMap.get(emp.id) || [];

                  return (
                    <tr key={emp.id} className="hover:bg-slate-50/50 transition-colors">
                      {/* Sticky Employee Profile Cell */}
                      <td className="p-3 sticky left-0 z-10 bg-white border-r border-slate-200 shadow-xs">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold ${
                              emp.avatarColor || 'bg-slate-700'
                            }`}
                          >
                            {emp.name.charAt(0)}
                          </div>
                          <div className="truncate">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900 truncate">
                                {emp.name}
                              </span>
                              {emp.role === 'APPROVER' && (
                                <span className="text-[9px] px-1 py-0.2 bg-blue-100 text-blue-800 rounded font-semibold shrink-0">
                                  허가권자
                                </span>
                              )}
                              {emp.role === 'ADMIN' && (
                                <span className="text-[9px] px-1 py-0.2 bg-amber-100 text-amber-800 rounded font-semibold shrink-0">
                                  관리자
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {dept}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Day Cells */}
                      {days.map((d) => {
                        const daySessions = empSessions.filter((s) => s.dateStr === d.dateStr);
                        const isWeekend = d.dayIndex === 0 || d.dayIndex === 6;

                        return (
                          <td
                            key={d.dateStr}
                            className={`p-1 border-r border-slate-200 align-top ${
                              isWeekend ? 'bg-slate-50/40' : ''
                            }`}
                          >
                            <div className="space-y-1 min-h-[46px] flex flex-col justify-start">
                              {daySessions.map((session, sIdx) => {
                                const targetProj = projects.find((p) => p.id === session.projectId);
                                const isAllowedOverlap = allowedOverlaps.some(
                                  (ao) =>
                                    ao.employeeId === emp.id &&
                                    (ao.sessionAId === session.sessionId ||
                                      ao.sessionBId === session.sessionId)
                                );

                                return (
                                  <div
                                    key={`${session.sessionId}-${sIdx}`}
                                    onClick={() => targetProj && onSelectProject(targetProj)}
                                    className={`p-1 rounded text-[10px] cursor-pointer transition-all leading-tight ${
                                      session.isPending
                                        ? 'border border-dashed border-amber-500 bg-amber-50/90 text-amber-900 hover:bg-amber-100'
                                        : 'text-white hover:opacity-90 shadow-2xs'
                                    }`}
                                    style={{
                                      backgroundColor: session.isPending ? undefined : session.color,
                                    }}
                                    title={`[${session.projectName}] ${session.sessionTitle} (${session.startTime}~${session.endTime})${
                                      session.isPending ? ' [승인/수락 대기 중]' : ''
                                    }${isAllowedOverlap ? ' [사전 허용된 겹침]' : ''}`}
                                  >
                                    <div className="font-semibold truncate">
                                      {session.projectName}
                                    </div>
                                    <div className="flex items-center justify-between gap-1 text-[9px] opacity-90 tabular-nums">
                                      <span>
                                        {session.startTime}~{session.endTime}
                                      </span>
                                      {isAllowedOverlap && (
                                        <span title="허용된 겹침">⚠️</span>
                                      )}
                                      {session.isPending && (
                                        <span className="text-[8px] bg-amber-200 text-amber-900 px-0.5 rounded font-bold">
                                          대기
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
