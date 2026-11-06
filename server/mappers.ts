/** Row (snake_case) -> API shape (camelCase) mappers. The JSON contract with the frontend is unchanged. */

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  departmentId: string;
  role: 'EMPLOYEE' | 'APPROVER' | 'ADMIN';
  status: 'ACTIVE' | 'INVITED' | 'DISABLED';
  timezone: string;
  avatarColor: string;
  passwordSalt: string;
  passwordHash: string;
  /** NULL on legacy records = 1,000 PBKDF2 iterations. */
  passwordIter: number | null;
  resetTokenHash: string | null;
  resetTokenExpiresAt: string | null;
  slackUserId: string | null;
}

const iso = (v: any): string | undefined => (v == null ? undefined : v instanceof Date ? v.toISOString() : String(v));
const opt = <T>(v: T | null | undefined): T | undefined => (v == null ? undefined : v);

export const mapUser = (r: any): UserRecord => ({
  id: r.id,
  email: r.email,
  name: r.name,
  departmentId: r.department_id,
  role: r.role,
  status: r.status,
  timezone: r.timezone,
  avatarColor: r.avatar_color,
  passwordSalt: r.password_salt,
  passwordHash: r.password_hash,
  passwordIter: r.password_iter ?? null,
  resetTokenHash: r.reset_token_hash ?? null,
  resetTokenExpiresAt: iso(r.reset_token_expires_at) ?? null,
  slackUserId: r.slack_user_id ?? null,
});

/** What other people (and the browser) may see of a user; e-mail only for the owner and administrators. */
export function publicUser(u: UserRecord, viewer: UserRecord) {
  const { passwordHash, passwordSalt, passwordIter, resetTokenHash, resetTokenExpiresAt, slackUserId, ...safe } = u;
  if (viewer.role !== 'ADMIN' && viewer.id !== u.id) return { ...safe, email: '' };
  return safe;
}

export const mapDepartment = (r: any) => ({ id: r.id, name: r.name, headEmployeeId: r.head_employee_id ?? '' });

export const mapProject = (r: any) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  createdBy: r.created_by,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status,
  headcount: opt(r.headcount),
  color: r.color,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export const mapSession = (r: any) => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  startAt: opt(r.start_at),
  endAt: opt(r.end_at),
  rrule: opt(r.rrule),
  daysOfWeek: opt(r.days_of_week),
  startTime: opt(r.start_time),
  endTime: opt(r.end_time),
  timezone: r.timezone,
});

export const mapDecision = (r: any) => ({
  id: r.id,
  assignmentId: r.assignment_id,
  approverId: r.approver_id,
  decision: r.decision,
  comment: opt(r.comment),
  decidedAt: iso(r.decided_at),
});

export const mapAssignment = (r: any, decisions: any[] = []) => ({
  id: r.id,
  projectId: r.project_id,
  employeeId: r.employee_id,
  assignedBy: r.assigned_by,
  type: r.type,
  status: r.status,
  declineReason: opt(r.decline_reason),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  approvalDecisions: decisions.map(mapDecision),
});

export const mapChangeDecision = (r: any) => ({
  id: r.id,
  changeRequestId: r.change_request_id,
  actorId: r.actor_id,
  kind: r.kind,
  decision: r.decision,
  comment: opt(r.comment),
  decidedAt: iso(r.decided_at),
});

export const mapChangeRequest = (r: any, decisions: any[] = []) => ({
  id: r.id,
  projectId: r.project_id,
  requestedBy: r.requested_by,
  proposedSessions: r.proposed_sessions,
  conflicts: r.conflicts,
  status: r.status,
  closedReason: opt(r.closed_reason),
  closedAt: iso(r.closed_at),
  createdAt: iso(r.created_at),
  decisions: decisions.map(mapChangeDecision),
});

export const mapAllowedOverlap = (r: any) => ({
  id: r.id,
  employeeId: r.employee_id,
  sessionAId: r.session_a_id,
  sessionBId: r.session_b_id,
  source: r.source,
  sourceId: opt(r.source_id),
  createdAt: iso(r.created_at),
});

export const mapNotification = (r: any) => ({
  id: r.id,
  recipientId: r.recipient_id,
  type: r.type,
  title: r.title,
  message: r.message,
  read: r.read,
  linkTab: r.link_tab,
  createdAt: iso(r.created_at),
});

export const mapAuditLog = (r: any) => ({
  id: r.id,
  actorId: r.actor_id,
  actorName: r.actor_name,
  action: r.action,
  targetType: r.target_type,
  targetId: r.target_id,
  details: r.details,
  createdAt: iso(r.created_at),
});
