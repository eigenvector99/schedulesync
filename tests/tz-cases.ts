/** Prints the results of time-zone sensitive computations as JSON. Run under different TZ env values. */
import {
  zonedWallTimeToUtcMs,
  expandSessions,
  checkEmployeeOverlap,
  getDaysRange,
  todayInTz,
  formatDate,
  formatTime,
  formatDateTime,
} from '../src/utils/dateAndRrule';

const iso = (ms: number) => new Date(ms).toISOString();
const proj = (id: string, startDate: string, endDate: string, createdBy = 'u') =>
  ({ id, name: id, createdBy, startDate, endDate, color: '#000', status: 'IN_PROGRESS', description: '', createdAt: '', updatedAt: '' }) as any;
const rec = (id: string, projectId: string, days: number[], st: string, et: string, tz = 'Asia/Seoul') =>
  ({ id, projectId, title: id, daysOfWeek: days, startTime: st, endTime: et, timezone: tz, startAt: '', endAt: '' }) as any;
const single = (id: string, projectId: string, startAt: string, endAt: string, tz = 'Asia/Seoul') =>
  ({ id, projectId, title: id, startAt, endAt, startTime: '', endTime: '', timezone: tz }) as any;

const overlap = (employee: string, target: any, targetSessions: any[], others: { project: any; sessions: any[] }[]) => {
  const projects = [target, ...others.map((o) => o.project)];
  const sessions = [...targetSessions, ...others.flatMap((o) => o.sessions)];
  const assignments = others.map((o, i) => ({ id: `a${i}`, projectId: o.project.id, employeeId: employee, status: 'APPROVED' })) as any[];
  const r = checkEmployeeOverlap(employee, target, targetSessions, projects, sessions, assignments, [], [{ id: 'u', name: 'U' }] as any, target.id);
  return { has: r.hasConflict, conflicts: r.conflicts.map((c) => `${c.targetSession.dateStr} ${c.targetSession.startTime}-${c.targetSession.endTime} vs ${c.conflictingSession.dateStr} ${c.conflictingSession.startTime}-${c.conflictingSession.endTime}`) };
};

const tuesdays = expandSessions(proj('p', '2026-11-01', '2026-11-30'), [rec('s', 'p', [2], '14:00', '17:00')]);
const pA = proj('A', '2026-11-01', '2026-11-30');
const pB = proj('B', '2026-11-01', '2026-11-30');
const pN = proj('N', '2026-11-01', '2026-11-30');
const pS = proj('S', '2026-11-01', '2026-11-30');

const out = {
  // wall clock -> instant
  seoul: iso(zonedWallTimeToUtcMs('2026-11-05', '10:00', 'Asia/Seoul')),
  nyWinter: iso(zonedWallTimeToUtcMs('2026-03-06', '09:00', 'America/New_York')),
  nySummer: iso(zonedWallTimeToUtcMs('2026-03-09', '09:00', 'America/New_York')),
  nyGap: iso(zonedWallTimeToUtcMs('2026-03-08', '02:30', 'America/New_York')), // does not exist -> moves forward
  nyFold: iso(zonedWallTimeToUtcMs('2026-11-01', '01:30', 'America/New_York')), // happens twice -> first occurrence
  // recurring Tuesday 14:00-17:00 Seoul
  tuesdays: tuesdays.map((i) => `${i.dateStr} ${i.startTime}-${i.endTime} ${iso(i.start.getTime())}`),
  // an absolute single session (14:00-17:00 KST on Tue 3 Nov) collides with the recurring one
  mixed: overlap('e', pB, [single('b1', 'B', '2026-11-03T05:00:00Z', '2026-11-03T08:00:00Z')], [{ project: pA, sessions: [rec('a1', 'A', [2], '14:00', '17:00')] }]),
  // a single session that is early morning in Seoul (previous day in UTC) belongs to the Seoul date
  earlyMorning: expandSessions(pB, [single('b2', 'B', '2026-11-03T23:30:00Z', '2026-11-04T00:30:00Z')]).map((i) => `${i.dateStr} ${i.startTime}-${i.endTime}`),
  // New York Tuesday 21:00-23:00 (EST) is Wednesday 11:00-13:00 in Seoul -> collides with Seoul Wednesday 12:00-14:00
  crossZone: overlap('e', pN, [rec('n1', 'N', [2], '21:00', '23:00', 'America/New_York')], [{ project: pS, sessions: [rec('s1', 'S', [3], '12:00', '14:00')] }]),
  // adjacent, not overlapping
  adjacent: overlap('e', pB, [rec('b3', 'B', [2], '17:00', '18:00')], [{ project: pA, sessions: [rec('a2', 'A', [2], '14:00', '17:00')] }]),
  // calendar helpers
  days: getDaysRange('2026-11-01', 3).map((d) => `${d.dateStr}:${d.dayIndex}${d.dayName}`),
  today: todayInTz('Asia/Seoul', Date.parse('2026-11-03T16:00:00Z')),
  todayNy: todayInTz('America/New_York', Date.parse('2026-11-03T16:00:00Z')),
  fmt: `${formatDate(new Date('2026-11-03T16:30:00Z'))} ${formatTime(new Date('2026-11-03T16:30:00Z'))}`,
  dateTime: formatDateTime('2026-11-03T16:30:00Z'),
};
console.log(JSON.stringify(out));
