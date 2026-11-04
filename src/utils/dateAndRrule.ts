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
 * Time handling
 * -------------
 * The company calendar is shown in one display time zone (DEFAULT_TZ). Every session carries its own IANA
 * `timezone`; recurring sessions are defined by wall-clock times in that zone ("every Tuesday 14:00 Seoul time")
 * and converted to absolute instants here, so results are identical in the browser, on the server and in any
 * process time zone (nothing below uses the local time zone of the machine).
 */
export const DEFAULT_TZ = 'Asia/Seoul';

/** Upper bound for expanding a recurring session (days), a guard against absurd project ranges. */
export const MAX_EXPAND_DAYS = 3700;

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Falls back to the company zone for missing / unknown zone names. */
export function resolveTz(tz?: string | null): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_TZ;
}

function wallParts(ms: number, tz: string) {
  const out: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = parseInt(p.value, 10);
  }
  return { y: out.year, mo: out.month, d: out.day, h: out.hour, mi: out.minute, s: out.second };
}

/** Offset of `tz` from UTC at the instant `ms` (positive east of Greenwich), in ms. */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = wallParts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * Wall-clock time in `tz` -> absolute instant (ms since epoch). DST-aware: a wall time that does not exist
 * (spring-forward gap) moves forward, an ambiguous one (fall-back) resolves to its first occurrence.
 */
export function zonedWallTimeToUtcMs(dateStr: string, timeStr: string, tz: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const { hours, minutes } = parseTimeString(timeStr);
  const wallAsUtc = Date.UTC(y, mo - 1, d, hours, minutes, 0);

  // The offsets in force a day before and a day after bracket any transition near this wall time.
  const DAY = 24 * 3600 * 1000;
  const before = tzOffsetMs(wallAsUtc - DAY, tz);
  const after = tzOffsetMs(wallAsUtc + DAY, tz);

  const valid = [...new Set([before, after])].map((off) => wallAsUtc - off).filter((t) => tzOffsetMs(t, tz) === wallAsUtc - t);
  if (valid.length > 0) return Math.min(...valid); // two valid readings = ambiguous (fall back): first occurrence
  return wallAsUtc - before; // no valid reading = skipped (spring forward): shift forward by the gap
}

/** 'YYYY-MM-DD' of an instant in `tz`. */
export function formatDateInTz(ms: number, tz: string = DEFAULT_TZ): string {
  const p = wallParts(ms, tz);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** 'HH:mm' of an instant in `tz`. */
export function formatTimeInTz(ms: number, tz: string = DEFAULT_TZ): string {
  const p = wallParts(ms, tz);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

/** Format date to YYYY-MM-DD (in the company zone, not the machine's). */
export function formatDate(date: Date): string {
  return formatDateInTz(date.getTime());
}

/** Format time to HH:mm (in the company zone, not the machine's). */
export function formatTime(date: Date): string {
  return formatTimeInTz(date.getTime());
}

/** Today's calendar date in the company zone. */
export function todayInTz(tz: string = DEFAULT_TZ, nowMs: number = Date.now()): string {
  return formatDateInTz(nowMs, tz);
}

/** Calendar arithmetic on 'YYYY-MM-DD' strings (no time zone involved). */
export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Day of week (0 = Sunday) of a calendar date. */
export function weekdayOfDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const fmtDateTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: DEFAULT_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Timestamp for display, always in the company zone (e.g. audit log, inbox). */
export function formatDateTime(value: string | number | Date): string {
  return fmtDateTime.format(new Date(value));
}

/** 'HH:mm' of a timestamp in the company zone. */
export function formatClock(value: string | number | Date): string {
  return formatTimeInTz(new Date(value).getTime());
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
  const [h, m] = (timeStr || '').split(':').map(Number);
  return { hours: h || 0, minutes: m || 0 };
}

/**
 * Expand project sessions into discrete instances within the project date range.
 * `dateStr`, `startTime` and `endTime` of an instance are expressed in the company zone, which is what the
 * calendar renders; `start` / `end` are the absolute instants used for overlap checks.
 */
export function expandSessions(
  project: Pick<Project, 'id' | 'name' | 'createdBy' | 'startDate' | 'endDate' | 'color'>,
  sessions: ProjectSession[],
  isPending: boolean = false
): ExpandedSessionInstance[] {
  const instances: ExpandedSessionInstance[] = [];

  const push = (session: ProjectSession, startMs: number, endMs: number, fallbackTitle: string) => {
    instances.push({
      sessionId: session.id,
      projectId: project.id,
      projectName: project.name,
      projectCreatedBy: project.createdBy,
      sessionTitle: session.title || fallbackTitle,
      dateStr: formatDateInTz(startMs),
      start: new Date(startMs),
      end: new Date(endMs),
      startTime: formatTimeInTz(startMs),
      endTime: formatTimeInTz(endMs),
      color: project.color,
      isPending,
    });
  };

  for (const session of sessions) {
    const tz = resolveTz(session.timezone);

    if (session.daysOfWeek && session.daysOfWeek.length > 0) {
      // Weekly recurrence: walk the calendar dates of the project range, no local time zone involved.
      let weekday = weekdayOfDate(project.startDate);
      let ds = project.startDate;
      for (let guard = 0; ds <= project.endDate && guard < MAX_EXPAND_DAYS; guard++) {
        if (session.daysOfWeek.includes(weekday)) {
          push(session, zonedWallTimeToUtcMs(ds, session.startTime, tz), zonedWallTimeToUtcMs(ds, session.endTime, tz), '정기 세션');
        }
        ds = addDaysStr(ds, 1);
        weekday = (weekday + 1) % 7;
      }
    } else {
      // Single session: an absolute instant range, kept when it intersects the project range (in the session's zone).
      const startMs = Date.parse(session.startAt);
      const endMs = Date.parse(session.endAt);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
      const rangeStart = zonedWallTimeToUtcMs(project.startDate, '00:00', tz);
      const rangeEnd = zonedWallTimeToUtcMs(addDaysStr(project.endDate, 1), '00:00', tz);
      if (startMs < rangeEnd && endMs > rangeStart) push(session, startMs, endMs, '단일 세션');
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
 * Generate dates array for calendar view (pure calendar dates; `date` is midnight of that day in the company zone).
 */
export function getDaysRange(startDateStr: string, numDays: number = 14): { date: Date; dateStr: string; dayIndex: number; dayName: string }[] {
  const result = [];
  const firstWeekday = weekdayOfDate(startDateStr);
  for (let i = 0; i < numDays; i++) {
    const dateStr = addDaysStr(startDateStr, i);
    const dayIndex = (firstWeekday + i) % 7;
    result.push({
      date: new Date(zonedWallTimeToUtcMs(dateStr, '00:00', DEFAULT_TZ)),
      dateStr,
      dayIndex,
      dayName: KR_DAYS[dayIndex],
    });
  }
  return result;
}
