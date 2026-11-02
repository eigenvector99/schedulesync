import {
  Department,
  Employee,
  Project,
  ProjectSession,
  Assignment,
  AllowedOverlap,
  Notification,
  MockEmail,
  AuditLog,
} from '../types';

export const INITIAL_DEPARTMENTS: Department[] = [
  {
    id: 'dept-1',
    name: '플랫폼개발팀',
    headEmployeeId: 'emp-approver-a', // 김부서장
  },
  {
    id: 'dept-2',
    name: '프로덕트디자인팀',
    headEmployeeId: 'emp-approver-b', // 이부서장
  },
];

export const INITIAL_EMPLOYEES: Employee[] = [
  {
    id: 'emp-admin',
    email: 'admin@company.internal',
    name: '총괄관리자',
    departmentId: 'dept-1',
    role: 'ADMIN',
    status: 'ACTIVE',
    timezone: 'Asia/Seoul',
    avatarColor: 'bg-slate-700',
  },
  {
    id: 'emp-approver-a',
    email: 'a.kim@company.internal',
    name: '김부서장 (허가권자 A)',
    departmentId: 'dept-1',
    role: 'APPROVER',
    status: 'ACTIVE',
    timezone: 'Asia/Seoul',
    avatarColor: 'bg-blue-600',
  },
  {
    id: 'emp-approver-b',
    email: 'b.lee@company.internal',
    name: '이부서장 (허가권자 B)',
    departmentId: 'dept-2',
    role: 'APPROVER',
    status: 'ACTIVE',
    timezone: 'Asia/Seoul',
    avatarColor: 'bg-purple-600',
  },
  {
    id: 'emp-dev-1',
    email: 'park.dev@company.internal',
    name: '박개발',
    departmentId: 'dept-1',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    timezone: 'Asia/Seoul',
    avatarColor: 'bg-cyan-600',
  },
  {
    id: 'emp-dev-2',
    email: 'jung.eng@company.internal',
    name: '정엔지니어',
    departmentId: 'dept-1',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    timezone: 'Asia/Seoul',
    avatarColor: 'bg-sky-600',
  },
  {
    id: 'emp-dev-3',
    email: 'choi.back@company.internal',
    name: '최백엔드',
    departmentId: 'dept-1',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    timezone: 'Asia/Seoul',
    avatarColor: 'bg-indigo-600',
  },
  {
    id: 'emp-des-1',
    email: 'kang.des@company.internal',
    name: '강디자이너',
    departmentId: 'dept-2',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    timezone: 'Asia/Seoul',
    avatarColor: 'bg-fuchsia-600',
  },
  {
    id: 'emp-des-2',
    email: 'yoon.ui@company.internal',
    name: '윤UI/UX',
    departmentId: 'dept-2',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    timezone: 'Asia/Seoul',
    avatarColor: 'bg-pink-600',
  },
  {
    id: 'emp-des-3',
    email: 'han.gra@company.internal',
    name: '한그래픽',
    departmentId: 'dept-2',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    timezone: 'Asia/Seoul',
    avatarColor: 'bg-rose-600',
  },
  {
    id: 'emp-des-4',
    email: 'song.prod@company.internal',
    name: '송프로덕트',
    departmentId: 'dept-2',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    timezone: 'Asia/Seoul',
    avatarColor: 'bg-amber-600',
  },
];

export const INITIAL_PROJECTS: Project[] = [
  {
    id: 'proj-1',
    name: 'AI 스마트 검색 엔진 구축',
    description: '검색 지연시간 개선 및 멀티모달 임베딩 파이프라인 개발',
    createdBy: 'emp-approver-a', // 김부서장 등록
    startDate: '2026-11-01',
    endDate: '2026-12-31',
    status: 'IN_PROGRESS',
    headcount: 3,
    color: '#2563eb', // blue
    createdAt: '2026-11-01T09:00:00Z',
    updatedAt: '2026-11-01T09:00:00Z',
  },
  {
    id: 'proj-2',
    name: '2026 차세대 디자인 시스템 개편',
    description: '디자인 토큰 통일 및 인터랙션 컴포넌트 라이브러리 2.0 구축',
    createdBy: 'emp-approver-b', // 이부서장 등록
    startDate: '2026-11-01',
    endDate: '2026-12-31',
    status: 'IN_PROGRESS',
    headcount: 4,
    color: '#7c3aed', // purple
    createdAt: '2026-11-01T09:30:00Z',
    updatedAt: '2026-11-01T09:30:00Z',
  },
  {
    id: 'proj-3',
    name: '모바일 온보딩 TF (경험 고도화)',
    description: '신규 고객 유입 후 첫 주 잔존율 상승을 위한 온보딩 프로세스 혁신',
    createdBy: 'emp-approver-a', // 김부서장 등록
    startDate: '2026-11-01',
    endDate: '2026-12-31',
    status: 'RECRUITING',
    headcount: 3,
    color: '#059669', // emerald
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
  },
];

export const INITIAL_SESSIONS: ProjectSession[] = [
  {
    id: 'sess-1',
    projectId: 'proj-1',
    title: '검색 엔진 코어 스프린트',
    startAt: '2026-11-01T14:00:00Z',
    endAt: '2026-12-31T17:00:00Z',
    rrule: 'FREQ=WEEKLY;BYDAY=TU,TH',
    daysOfWeek: [2, 4], // 화, 목
    startTime: '14:00',
    endTime: '17:00',
    timezone: 'Asia/Seoul',
  },
  {
    id: 'sess-2',
    projectId: 'proj-2',
    title: '디자인 시스템 코어 워크숍',
    startAt: '2026-11-01T10:00:00Z',
    endAt: '2026-12-31T13:00:00Z',
    rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
    daysOfWeek: [1, 3], // 월, 수
    startTime: '10:00',
    endTime: '13:00',
    timezone: 'Asia/Seoul',
  },
  {
    id: 'sess-3',
    projectId: 'proj-3',
    title: '온보딩 TF 집중 작업',
    startAt: '2026-11-01T15:00:00Z',
    endAt: '2026-12-31T18:00:00Z',
    rrule: 'FREQ=WEEKLY;BYDAY=TU,TH',
    daysOfWeek: [2, 4], // 화, 목 15:00~18:00 (proj-1 화/목 14:00~17:00과 겹침 시나리오 테스트용)
    startTime: '15:00',
    endTime: '18:00',
    timezone: 'Asia/Seoul',
  },
];

export const INITIAL_ASSIGNMENTS: Assignment[] = [
  {
    id: 'asg-1',
    projectId: 'proj-1',
    employeeId: 'emp-dev-1', // 박개발
    assignedBy: 'emp-approver-a',
    type: 'EMPLOYEE',
    status: 'APPROVED',
    createdAt: '2026-11-01T10:10:00Z',
    updatedAt: '2026-11-01T10:15:00Z',
    approvalDecisions: [
      {
        id: 'dec-1',
        assignmentId: 'asg-1',
        approverId: 'emp-approver-a',
        decision: 'APPROVED',
        comment: '플랫폼 코어 개발 리드 승인',
        decidedAt: '2026-11-01T10:14:00Z',
      },
      {
        id: 'dec-2',
        assignmentId: 'asg-1',
        approverId: 'emp-approver-b',
        decision: 'APPROVED',
        comment: '일정 확인 및 승인 완료',
        decidedAt: '2026-11-01T10:15:00Z',
      },
    ],
  },
  {
    id: 'asg-2',
    projectId: 'proj-1',
    employeeId: 'emp-des-1', // 강디자이너
    assignedBy: 'emp-approver-a',
    type: 'EMPLOYEE',
    status: 'APPROVAL_PENDING', // 강디자이너 수락 완료, A 승인함, B 승인 대기 중
    createdAt: '2026-11-01T11:00:00Z',
    updatedAt: '2026-11-01T11:20:00Z',
    approvalDecisions: [
      {
        id: 'dec-3',
        assignmentId: 'asg-2',
        approverId: 'emp-approver-a',
        decision: 'APPROVED',
        comment: '검색 UI 디자인 지원 투입 요청 승인',
        decidedAt: '2026-11-01T11:22:00Z',
      },
      {
        id: 'dec-4',
        assignmentId: 'asg-2',
        approverId: 'emp-approver-b',
        decision: 'PENDING',
      },
    ],
  },
  {
    id: 'asg-3',
    projectId: 'proj-2',
    employeeId: 'emp-approver-b', // 이부서장 (셀프 투입)
    assignedBy: 'emp-approver-b',
    type: 'SELF',
    status: 'APPROVED',
    createdAt: '2026-11-01T09:40:00Z',
    updatedAt: '2026-11-01T09:40:00Z',
    approvalDecisions: [],
  },
  {
    id: 'asg-4',
    projectId: 'proj-2',
    employeeId: 'emp-des-2', // 윤UI/UX
    assignedBy: 'emp-approver-b',
    type: 'EMPLOYEE',
    status: 'APPROVED',
    createdAt: '2026-11-01T09:45:00Z',
    updatedAt: '2026-11-01T09:55:00Z',
    approvalDecisions: [
      {
        id: 'dec-5',
        assignmentId: 'asg-4',
        approverId: 'emp-approver-a',
        decision: 'APPROVED',
        decidedAt: '2026-11-01T09:50:00Z',
      },
      {
        id: 'dec-6',
        assignmentId: 'asg-4',
        approverId: 'emp-approver-b',
        decision: 'APPROVED',
        decidedAt: '2026-11-01T09:55:00Z',
      },
    ],
  },
  {
    id: 'asg-5',
    projectId: 'proj-2',
    employeeId: 'emp-dev-2', // 정엔지니어
    assignedBy: 'emp-approver-b',
    type: 'EMPLOYEE',
    status: 'EMPLOYEE_PENDING', // 정엔지니어 수락 대기 중
    createdAt: '2026-11-01T10:30:00Z',
    updatedAt: '2026-11-01T10:30:00Z',
    approvalDecisions: [
      {
        id: 'dec-7',
        assignmentId: 'asg-5',
        approverId: 'emp-approver-a',
        decision: 'PENDING',
      },
      {
        id: 'dec-8',
        assignmentId: 'asg-5',
        approverId: 'emp-approver-b',
        decision: 'PENDING',
      },
    ],
  },
];

export const INITIAL_ALLOWED_OVERLAPS: AllowedOverlap[] = [];

export const INITIAL_NOTIFICATIONS: Notification[] = [
  {
    id: 'noti-1',
    recipientId: 'emp-approver-b',
    type: 'APPROVAL_REQUEST',
    title: '배정 승인 요청',
    message: '[AI 스마트 검색 엔진 구축] 프로젝트에 강디자이너 배정 건에 대해 승인이 필요합니다.',
    read: false,
    linkTab: 'inbox',
    createdAt: '2026-11-01T11:22:00Z',
  },
  {
    id: 'noti-2',
    recipientId: 'emp-dev-2',
    type: 'ASSIGNED',
    title: '프로젝트 배정 요청',
    message: '이부서장님이 귀하를 [2026 차세대 디자인 시스템 개편] 프로젝트에 배정하였습니다. 수락 여부를 결정해 주세요.',
    read: false,
    linkTab: 'inbox',
    createdAt: '2026-11-01T10:30:00Z',
  },
];

export const INITIAL_EMAILS: MockEmail[] = [
  {
    id: 'mail-1',
    to: 'b.lee@company.internal',
    toName: '이부서장',
    subject: '[스케줄 승인 요청] AI 스마트 검색 엔진 구축 - 강디자이너 배정',
    body: '이부서장님께,\n\n김부서장님이 등록한 [AI 스마트 검색 엔진 구축] 프로젝트에 강디자이너님이 배정을 수락하였습니다.\n\n허가권자 전원 승인 규칙에 따라 이부서장님의 승인이 필요합니다.\n시스템 내 [내 처리함]에서 검토 후 승인 또는 반려를 진행해 주시기 바랍니다.',
    sentAt: '2026-11-01T11:22:00Z',
  },
  {
    id: 'mail-2',
    to: 'jung.eng@company.internal',
    toName: '정엔지니어',
    subject: '[프로젝트 배정 안내] 2026 차세대 디자인 시스템 개편 배정 초대',
    body: '정엔지니어님께,\n\n이부서장님이 등록한 [2026 차세대 디자인 시스템 개편] 프로젝트에 참여자로 배정되었습니다.\n\n- 일정: 매주 월, 수 10:00 ~ 13:00\n- 기간: 2026-11-01 ~ 2026-12-31\n\n시스템 내 [내 처리함]에서 일정 겹침 여부를 확인하시고 수락 또는 거절을 선택해 주십시오.',
    sentAt: '2026-11-01T10:30:00Z',
  },
];

export const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'log-1',
    actorId: 'emp-admin',
    actorName: '총괄관리자',
    action: 'INITIALIZE_SYSTEM',
    targetType: 'DEPARTMENT',
    targetId: 'dept-1',
    details: '플랫폼개발팀 및 프로덕트디자인팀 부서 및 부서장 초기 설정 완료',
    createdAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'log-2',
    actorId: 'emp-approver-a',
    actorName: '김부서장 (허가권자 A)',
    action: 'CREATE_PROJECT',
    targetType: 'PROJECT',
    targetId: 'proj-1',
    details: '신규 프로젝트 [AI 스마트 검색 엔진 구축] 및 화/목 14:00~17:00 세션 등록',
    createdAt: '2026-11-01T09:00:00Z',
  },
  {
    id: 'log-3',
    actorId: 'emp-approver-b',
    actorName: '이부서장 (허가권자 B)',
    action: 'SELF_ASSIGN',
    targetType: 'ASSIGNMENT',
    targetId: 'asg-3',
    details: '자신을 [2026 차세대 디자인 시스템 개편] 프로젝트에 셀프 투입 (승인 불필요 확정)',
    createdAt: '2026-11-01T09:40:00Z',
  },
  {
    id: 'log-4',
    actorId: 'emp-approver-a',
    actorName: '김부서장 (허가권자 A)',
    action: 'APPROVE_ASSIGNMENT',
    targetType: 'ASSIGNMENT',
    targetId: 'asg-1',
    details: '박개발 직원 배정 승인 (1/2 승인 완료)',
    createdAt: '2026-11-01T10:14:00Z',
  },
  {
    id: 'log-5',
    actorId: 'emp-approver-b',
    actorName: '이부서장 (허가권자 B)',
    action: 'APPROVE_ASSIGNMENT',
    targetType: 'ASSIGNMENT',
    targetId: 'asg-1',
    details: '박개발 직원 배정 최종 승인 완료 (2/2 전원 승인 달성으로 APPROVED 전이)',
    createdAt: '2026-11-01T10:15:00Z',
  },
];
