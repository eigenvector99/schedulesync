import {
  Project,
  ProjectSession,
  ExpandedSessionInstance,
  ConflictDetail,
  AllowedOverlap,
  Assignment,
  Employee,
  OverlapCheckResult,
} from '../types';

/**
 * Format date to YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Format time to HH:mm
 */
export function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Day of week name in Korean
 */
export const KR_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function getDayName(dayIndex: number): string {
  return KR_DAYS[dayIndex] || '';
}

/**
 * Parse time string HH:mm into hours & minutes
 */
export function parseTimeString(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number);
  return { hours: h || 0, minutes: m || 0 };
}

/**
 * Expand project sessions into discrete instances within the project date range
 */
export function expandSessions(
  project: Pick<Project, 'id' | 'name' | 'createdBy' | 'startDate' | 'endDate' | 'color'>,
  sessions: ProjectSession[],
  isPending: boolean = false
): ExpandedSessionInstance[] {
  const instances: ExpandedSessionInstance[] = [];
  const projectStart = new Date(`${project.startDate}T00:00:00`);
  const projectEnd = new Date(`${project.endDate}T23:59:59`);

  for (const session of sessions) {
    if (session.daysOfWeek && session.daysOfWeek.length > 0) {
      // Weekly recurrence
      const { hours: sh, minutes: sm } = parseTimeString(session.startTime);
      const { hours: eh, minutes: em } = parseTimeString(session.endTime);

      const cur = new Date(projectStart);
      while (cur <= projectEnd) {
        const day = cur.getDay();
        if (session.daysOfWeek.includes(day)) {
          const dateStr = formatDate(cur);
          const start = new Date(cur);
          start.setHours(sh, sm, 0, 0);

          const end = new Date(cur);
          end.setHours(eh, em, 0, 0);

          instances.push({
            sessionId: session.id,
            projectId: project.id,
            projectName: project.name,
            projectCreatedBy: project.createdBy,
            sessionTitle: session.title || '정기 세션',
            dateStr,
            start,
            end,
            startTime: session.startTime,
            endTime: session.endTime,
            color: project.color,
            isPending,
          });
        }
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      // Single session instance
      const start = new Date(session.startAt);
      const end = new Date(session.endAt);
      if (start <= projectEnd && end >= projectStart) {
        const dateStr = formatDate(start);
        instances.push({
          sessionId: session.id,
          projectId: project.id,
          projectName: project.name,
          projectCreatedBy: project.createdBy,
          sessionTitle: session.title || '단일 세션',
          dateStr,
          start,
          end,
          startTime: session.startTime || formatTime(start),
          endTime: session.endTime || formatTime(end),
          color: project.color,
          isPending,
        });
      }
    }
  }

  return instances;
}

/**
 * Check interval collision: A.start < B.end and B.start < A.end
 */
export function isOverlappingInterval(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA.getTime() < endB.getTime() && startB.getTime() < endA.getTime();
}

/**
 * Check whether overlap between sessionA and sessionB was previously allowed
 */
export function isOverlapAllowed(
  employeeId: string,
  sessionAId: string | undefined,
  sessionBId: string | undefined,
  allowedOverlaps: AllowedOverlap[]
): boolean {
  if (!sessionAId || !sessionBId) return false;
  return allowedOverlaps.some(
    (ao) =>
      ao.employeeId === employeeId &&
      ((ao.sessionAId === sessionAId && ao.sessionBId === sessionBId) ||
        (ao.sessionAId === sessionBId && ao.sessionBId === sessionAId))
  );
}

/**
 * Check time overlaps for an employee given target project sessions
 */
export function checkEmployeeOverlap(
  employeeId: string,
  targetProject: Pick<Project, 'id' | 'name' | 'createdBy' | 'startDate' | 'endDate' | 'color'>,
  targetSessions: ProjectSession[],
  allProjects: Project[],
  allSessions: ProjectSession[],
  allAssignments: Assignment[],
  allowedOverlaps: AllowedOverlap[],
  allEmployees: Employee[],
  excludeProjectId?: string
): OverlapCheckResult {
  // 1. Expand target sessions
  const targetInstances = expandSessions(targetProject, targetSessions);

  // 2. Find confirmed projects for employee (status === 'APPROVED')
  const confirmedAssignments = allAssignments.filter(
    (a) =>
      a.employeeId === employeeId &&
      a.status === 'APPROVED' &&
      a.projectId !== (excludeProjectId || targetProject.id)
  );

  const pendingAssignments = allAssignments.filter(
    (a) =>
      a.employeeId === employeeId &&
      (a.status === 'EMPLOYEE_PENDING' || a.status === 'APPROVAL_PENDING') &&
      a.projectId !== (excludeProjectId || targetProject.id)
  );

  const conflicts: ConflictDetail[] = [];

  for (const assignment of confirmedAssignments) {
    const confProject = allProjects.find((p) => p.id === assignment.projectId);
    if (!confProject || confProject.status === 'CANCELLED' || confProject.status === 'COMPLETED') {
      continue;
    }

    const confProjectSessions = allSessions.filter((s) => s.projectId === confProject.id);
    const confInstances = expandSessions(confProject, confProjectSessions);
    const creator = allEmployees.find((e) => e.id === confProject.createdBy);
    const creatorName = creator ? creator.name : '허가권자';

    for (const tInst of targetInstances) {
      for (const cInst of confInstances) {
        if (isOverlappingInterval(tInst.start, tInst.end, cInst.start, cInst.end)) {
          const isAllowed = isOverlapAllowed(
            employeeId,
            tInst.sessionId,
            cInst.sessionId,
            allowedOverlaps
          );

          if (!isAllowed) {
            conflicts.push({
              targetSession: {
                sessionId: tInst.sessionId,
                title: tInst.sessionTitle,
                dateStr: tInst.dateStr,
                startTime: tInst.startTime,
                endTime: tInst.endTime,
              },
              conflictingProject: {
                id: confProject.id,
                name: confProject.name,
                createdBy: confProject.createdBy,
                createdByName: creatorName,
              },
              conflictingSession: {
                sessionId: cInst.sessionId,
                title: cInst.sessionTitle,
                dateStr: cInst.dateStr,
                startTime: cInst.startTime,
                endTime: cInst.endTime,
              },
              isAllowed,
            });
          }
        }
      }
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
    pendingCount: pendingAssignments.length,
  };
}

/**
 * Generate dates array for calendar view
 */
export function getDaysRange(startDateStr: string, numDays: number = 14): { date: Date; dateStr: string; dayIndex: number; dayName: string }[] {
  const result = [];
  const start = new Date(`${startDateStr}T00:00:00`);
  for (let i = 0; i < numDays; i++) {
    const cur = new Date(start);
    cur.setDate(cur.getDate() + i);
    const dateStr = formatDate(cur);
    const dayIndex = cur.getDay();
    result.push({
      date: cur,
      dateStr,
      dayIndex,
      dayName: KR_DAYS[dayIndex],
    });
  }
  return result;
}
