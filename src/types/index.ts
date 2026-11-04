/**
 * 직원 스케줄 관리 및 프로젝트 참여 승인 시스템 (v1.0 확정본)
 * Data Models & Type Definitions
 */

export type UserRole = 'EMPLOYEE' | 'APPROVER' | 'ADMIN';
export type EmployeeStatus = 'ACTIVE' | 'INVITED' | 'DISABLED';

export interface Department {
  id: string;
  name: string;
  headEmployeeId: string; // 부서장 (허가권자)
}

export interface Employee {
  id: string;
  email: string;
  name: string;
  departmentId: string;
  role: UserRole;
  status: EmployeeStatus;
  timezone: string;
  avatarColor?: string;
  failedLoginCount?: number;
}

export type ProjectStatus = 'PLANNING' | 'RECRUITING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface ProjectSession {
  id: string;
  projectId: string;
  title: string;
  // 단일 날짜 또는 반복 규칙
  startAt: string; // ISO string
  endAt: string;   // ISO string
  rrule?: string;  // e.g., 'FREQ=WEEKLY;BYDAY=TU,TH'
  daysOfWeek?: number[]; // [1, 3] = 월, 수 (0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토)
  startTime: string; // '14:00'
  endTime: string;   // '17:00'
  timezone: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdBy: string; // 등록한 허가권자 employeeId
  startDate: string; // 'YYYY-MM-DD'
  endDate: string;   // 'YYYY-MM-DD'
  status: ProjectStatus;
  headcount?: number; // 필요 인원
  color: string;     // 캘린더 표시 색상 (테마 토큰)
  createdAt: string;
  updatedAt: string;
}

export type AssignmentType = 'SELF' | 'APPROVER' | 'EMPLOYEE';
export type AssignmentStatus =
  | 'EMPLOYEE_PENDING' // 직원 수락 대기
  | 'APPROVAL_PENDING' // 허가권자 전원 승인 대기 (일반직원 배정 시)
  | 'APPROVED'         // 최종 확정
  | 'DECLINED'         // 직원이 수락 거절
  | 'REJECTED'         // 허가권자 중 1명 이상 반려
  | 'WITHDRAWN'        // 등록 허가권자가 배정 철회
  | 'RELEASED';        // 참여 해제

export interface ApprovalDecision {
  id: string;
  assignmentId: string;
  approverId: string;
  decision: 'PENDING' | 'APPROVED' | 'REJECTED';
  comment?: string;
  decidedAt?: string;
}

export interface Assignment {
  id: string;
  projectId: string;
  employeeId: string;
  assignedBy: string; // 배정한 허가권자 employeeId
  type: AssignmentType;
  status: AssignmentStatus;
  declineReason?: string;
  createdAt: string;
  updatedAt: string;
  approvalDecisions: ApprovalDecision[];
}

export type ChangeDecisionKind = 'APPROVAL' | 'CONSENT' | 'BOTH';

export interface ChangeDecision {
  id: string;
  changeRequestId: string;
  actorId: string; // 허가권자 or 직원
  kind: ChangeDecisionKind;
  decision: 'PENDING' | 'APPROVED' | 'REJECTED';
  comment?: string;
  decidedAt?: string;
}

export type SessionChangeRequestStatus =
  | 'CHANGE_PENDING'
  | 'CHANGE_APPROVED'
  | 'CHANGE_REJECTED'
  | 'CHANGE_WITHDRAWN';

export type ChangeCloseReason =
  | 'BASE_CHANGED'
  | 'NEW_CONFLICT'
  | 'PROJECT_CLOSED'
  | 'OWNER_CHANGED'
  | 'REQUESTER_INACTIVE'
  | 'WITHDRAWN_BY_REQUESTER';

export const CHANGE_CLOSE_REASONS: Record<ChangeCloseReason, string> = {
  BASE_CHANGED: '요청 이후 프로젝트 일정이 바뀌어 요청이 무효화되었습니다. 다시 요청해 주세요.',
  NEW_CONFLICT: '요청 이후 승인받지 않은 새로운 시간 겹침이 생겨 요청이 무효화되었습니다. 다시 요청해 주세요.',
  PROJECT_CLOSED: '프로젝트가 취소되었거나 종료되어 요청이 무효화되었습니다.',
  OWNER_CHANGED: '프로젝트 등록자가 바뀌어 요청이 무효화되었습니다.',
  REQUESTER_INACTIVE: '요청자가 더 이상 허가권자가 아니거나 비활성화되어 요청이 무효화되었습니다.',
  WITHDRAWN_BY_REQUESTER: '요청자가 변경 요청을 철회했습니다.',
};

export interface SessionChangeRequest {
  id: string;
  projectId: string;
  requestedBy: string; // 변경 요청한 허가권자
  proposedSessions: ProjectSession[];
  conflicts: ConflictDetail[];
  status: SessionChangeRequestStatus;
  /** Set when the request was closed without a decision: see CHANGE_CLOSE_REASONS. */
  closedReason?: ChangeCloseReason;
  closedAt?: string;
  createdAt: string;
  decisions: ChangeDecision[];
}

export interface AllowedOverlap {
  id: string;
  employeeId: string;
  sessionAId: string;
  sessionBId: string;
  source: 'SELF_ASSIGN' | 'OWN_PROJECTS' | 'CHANGE_REQUEST';
  sourceId: string;
  createdAt: string;
}

export interface ExpandedSessionInstance {
  sessionId: string;
  projectId: string;
  projectName: string;
  projectCreatedBy: string;
  sessionTitle: string;
  dateStr: string; // 'YYYY-MM-DD'
  start: Date;
  end: Date;
  startTime: string; // '14:00'
  endTime: string;   // '17:00'
  color: string;
  isPending?: boolean;
}

export interface ConflictDetail {
  targetSession: {
    sessionId?: string;
    title: string;
    dateStr: string;
    startTime: string;
    endTime: string;
  };
  conflictingProject: {
    id: string;
    name: string;
    createdBy: string;
    createdByName: string;
  };
  conflictingSession: {
    sessionId?: string;
    title: string;
    dateStr: string;
    startTime: string;
    endTime: string;
  };
  isAllowed?: boolean;
}

export interface OverlapCheckResult {
  hasConflict: boolean;
  conflicts: ConflictDetail[];
  pendingCount: number;
}

export interface Notification {
  id: string;
  recipientId: string;
  type: 'ASSIGNED' | 'ACCEPTED' | 'DECLINED' | 'APPROVAL_REQUEST' | 'APPROVED' | 'REJECTED' | 'SESSION_CHANGED' | 'CHANGE_REQUEST' | 'WARNING';
  title: string;
  message: string;
  read: boolean;
  linkTab?: 'inbox' | 'calendar' | 'projects' | 'matrix';
  createdAt: string;
}

export interface MockEmail {
  id: string;
  to: string;
  toName: string;
  subject: string;
  body: string;
  sentAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: 'PROJECT' | 'SESSION' | 'ASSIGNMENT' | 'CHANGE_REQUEST' | 'EMPLOYEE' | 'DEPARTMENT';
  targetId: string;
  details: string;
  createdAt: string;
}
