import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json());

// -------------------------------------------------------------
// Database Persistence Layer (File-backed in /data/database.json)
// -------------------------------------------------------------
const DATA_DIR = path.resolve(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface UserRecord {
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
  invitationToken?: string;
  resetToken?: string;
}

interface DBData {
  users: UserRecord[];
  departments: any[];
  projects: any[];
  sessions: any[];
  assignments: any[];
  changeRequests: any[];
  allowedOverlaps: any[];
  notifications: any[];
  mockEmails: any[];
  auditLogs: any[];
  tokens: { token: string; userId: string; expiresAt: string }[];
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

function createDefaultDB(): DBData {
  const salt = 'common_company_salt_2026';

  const defaultUsers: UserRecord[] = [
    {
      id: 'emp-admin',
      email: 'admin@company.internal',
      name: '총괄관리자',
      departmentId: 'dept-1',
      role: 'ADMIN',
      status: 'ACTIVE',
      timezone: 'Asia/Seoul',
      avatarColor: 'bg-slate-700',
      passwordSalt: salt,
      passwordHash: hashPassword('admin123!', salt),
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
      passwordSalt: salt,
      passwordHash: hashPassword('kim123!', salt),
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
      passwordSalt: salt,
      passwordHash: hashPassword('lee123!', salt),
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
      passwordSalt: salt,
      passwordHash: hashPassword('park123!', salt),
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
      passwordSalt: salt,
      passwordHash: hashPassword('jung123!', salt),
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
      passwordSalt: salt,
      passwordHash: hashPassword('choi123!', salt),
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
      passwordSalt: salt,
      passwordHash: hashPassword('kang123!', salt),
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
      passwordSalt: salt,
      passwordHash: hashPassword('yoon123!', salt),
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
      passwordSalt: salt,
      passwordHash: hashPassword('han123!', salt),
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
      passwordSalt: salt,
      passwordHash: hashPassword('song123!', salt),
    },
  ];

  const defaultDepartments = [
    { id: 'dept-1', name: '플랫폼개발팀', headEmployeeId: 'emp-approver-a' },
    { id: 'dept-2', name: '프로덕트디자인팀', headEmployeeId: 'emp-approver-b' },
  ];

  const defaultProjects = [
    {
      id: 'proj-1',
      name: 'AI 스마트 검색 엔진 구축',
      description: '검색 지연시간 개선 및 멀티모달 임베딩 파이프라인 개발',
      createdBy: 'emp-approver-a',
      startDate: '2026-11-01',
      endDate: '2026-12-31',
      status: 'IN_PROGRESS',
      headcount: 3,
      color: '#2563eb',
      createdAt: '2026-11-01T09:00:00Z',
      updatedAt: '2026-11-01T09:00:00Z',
    },
    {
      id: 'proj-2',
      name: '2026 차세대 디자인 시스템 개편',
      description: '디자인 토큰 통일 및 인터랙션 컴포넌트 라이브러리 2.0 구축',
      createdBy: 'emp-approver-b',
      startDate: '2026-11-01',
      endDate: '2026-12-31',
      status: 'IN_PROGRESS',
      headcount: 4,
      color: '#7c3aed',
      createdAt: '2026-11-01T09:30:00Z',
      updatedAt: '2026-11-01T09:30:00Z',
    },
    {
      id: 'proj-3',
      name: '모바일 온보딩 TF (경험 고도화)',
      description: '신규 고객 유입 후 첫 주 잔존율 상승을 위한 온보딩 프로세스 혁신',
      createdBy: 'emp-approver-a',
      startDate: '2026-11-01',
      endDate: '2026-12-31',
      status: 'RECRUITING',
      headcount: 3,
      color: '#059669',
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-01T10:00:00Z',
    },
  ];

  const defaultSessions = [
    {
      id: 'sess-1',
      projectId: 'proj-1',
      title: '검색 엔진 코어 스프린트',
      startAt: '2026-11-01T14:00:00Z',
      endAt: '2026-12-31T17:00:00Z',
      rrule: 'FREQ=WEEKLY;BYDAY=TU,TH',
      daysOfWeek: [2, 4],
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
      daysOfWeek: [1, 3],
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
      daysOfWeek: [2, 4],
      startTime: '15:00',
      endTime: '18:00',
      timezone: 'Asia/Seoul',
    },
  ];

  const defaultAssignments = [
    {
      id: 'asg-1',
      projectId: 'proj-1',
      employeeId: 'emp-dev-1',
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
      employeeId: 'emp-des-1',
      assignedBy: 'emp-approver-a',
      type: 'EMPLOYEE',
      status: 'APPROVAL_PENDING',
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
      employeeId: 'emp-approver-b',
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
      employeeId: 'emp-des-2',
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
      employeeId: 'emp-dev-2',
      assignedBy: 'emp-approver-b',
      type: 'EMPLOYEE',
      status: 'EMPLOYEE_PENDING',
      createdAt: '2026-11-01T10:30:00Z',
      updatedAt: '2026-11-01T10:30:00Z',
      approvalDecisions: [
        { id: 'dec-7', assignmentId: 'asg-5', approverId: 'emp-approver-a', decision: 'PENDING' },
        { id: 'dec-8', assignmentId: 'asg-5', approverId: 'emp-approver-b', decision: 'PENDING' },
      ],
    },
  ];

  const defaultNotifications = [
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
  ];

  const defaultEmails = [
    {
      id: 'mail-1',
      to: 'b.lee@company.internal',
      toName: '이부서장',
      subject: '[스케줄 승인 요청] AI 스마트 검색 엔진 구축 - 강디자이너 배정',
      body: '이부서장님께,\n\n김부서장님이 등록한 [AI 스마트 검색 엔진 구축] 프로젝트에 강디자이너님이 배정을 수락하였습니다.\n\n허가권자 전원 승인 규칙에 따라 이부서장님의 승인이 필요합니다.',
      sentAt: '2026-11-01T11:22:00Z',
    },
  ];

  const defaultAuditLogs = [
    {
      id: 'log-1',
      actorId: 'emp-admin',
      actorName: '총괄관리자',
      action: 'INITIALIZE_SYSTEM',
      targetType: 'DEPARTMENT',
      targetId: 'dept-1',
      details: '시스템 가동 및 초기 부서/계정 마운트 완료',
      createdAt: '2026-11-01T08:00:00Z',
    },
  ];

  return {
    users: defaultUsers,
    departments: defaultDepartments,
    projects: defaultProjects,
    sessions: defaultSessions,
    assignments: defaultAssignments,
    changeRequests: [],
    allowedOverlaps: [],
    notifications: defaultNotifications,
    mockEmails: defaultEmails,
    auditLogs: defaultAuditLogs,
    tokens: [],
  };
}

let db: DBData;

function loadDB(): DBData {
  if (fs.existsSync(DB_FILE)) {
    try {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse database.json, resetting to default:', e);
      const initial = createDefaultDB();
      saveDB(initial);
      return initial;
    }
  } else {
    const initial = createDefaultDB();
    saveDB(initial);
    return initial;
  }
}

function saveDB(data: DBData) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save database.json:', e);
  }
}

db = loadDB();

// -------------------------------------------------------------
// Authentication Middleware
// -------------------------------------------------------------
interface AuthenticatedRequest extends Request {
  user?: UserRecord;
}

const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '인증이 필요합니다. (Missing token)' });
  }

  const token = authHeader.substring(7);
  const tokenRecord = db.tokens.find((t) => t.token === token);
  if (!tokenRecord) {
    return res.status(401).json({ error: '유효하지 않거나 만료된 세션입니다.' });
  }

  const user = db.users.find((u) => u.id === tokenRecord.userId);
  if (!user || user.status === 'DISABLED') {
    return res.status(403).json({ error: '계정이 비활성화되었거나 존재하지 않습니다.' });
  }

  req.user = user;
  next();
};

function logAudit(
  actor: UserRecord | undefined,
  action: string,
  targetType: string,
  targetId: string,
  details: string
) {
  const log = {
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    actorId: actor?.id || 'SYSTEM',
    actorName: actor?.name || '시스템',
    action,
    targetType,
    targetId,
    details,
    createdAt: new Date().toISOString(),
  };
  db.auditLogs.unshift(log);
  saveDB(db);
}

// -------------------------------------------------------------
// REST API Endpoints
// -------------------------------------------------------------

// 1. Auth: Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: '이메일과 비밀번호를 모두 입력하세요.' });
  }

  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: '등록되지 않은 이메일 계정입니다.' });
  }
  if (user.status === 'DISABLED') {
    return res.status(403).json({ error: '비활성화된 계정입니다. 관리자에게 문의하세요.' });
  }

  const computedHash = hashPassword(password, user.passwordSalt);
  if (computedHash !== user.passwordHash) {
    return res.status(401).json({ error: '비밀번호가 일치하지 않습니다.' });
  }

  // Generate token
  const token = `tok_${crypto.randomBytes(24).toString('hex')}`;
  db.tokens.push({
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  });
  saveDB(db);

  logAudit(user, 'USER_LOGIN', 'EMPLOYEE', user.id, `로그인 성공 (${user.email})`);

  const { passwordHash, passwordSalt, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

// 2. Auth: Get Current User (Me)
app.get('/api/auth/me', authMiddleware, (req: AuthenticatedRequest, res) => {
  const { passwordHash, passwordSalt, ...safeUser } = req.user!;
  res.json({ user: safeUser });
});

// 3. Auth: Logout
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    db.tokens = db.tokens.filter((t) => t.token !== token);
    saveDB(db);
  }
  res.json({ success: true });
});

// 4. Auth: Change Password
app.post('/api/auth/change-password', authMiddleware, (req: AuthenticatedRequest, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = req.user!;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: '새 비밀번호는 6자리 이상이어야 합니다.' });
  }

  const currentComputed = hashPassword(currentPassword, user.passwordSalt);
  if (currentComputed !== user.passwordHash) {
    return res.status(400).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
  }

  const newSalt = generateSalt();
  const newHash = hashPassword(newPassword, newSalt);

  user.passwordSalt = newSalt;
  user.passwordHash = newHash;
  saveDB(db);

  logAudit(user, 'CHANGE_PASSWORD', 'EMPLOYEE', user.id, '비밀번호 변경 완료');
  res.json({ success: true });
});

// 5. Auth: Reset Password Request (generates email with reset token)
app.post('/api/auth/password-reset-request', (req, res) => {
  const { email } = req.body;
  const user = db.users.find((u) => u.email.toLowerCase() === email?.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: '해당 이메일의 계정을 찾을 수 없습니다.' });
  }

  const token = crypto.randomBytes(16).toString('hex');
  user.resetToken = token;

  const mockEmail = {
    id: `mail-${Date.now()}`,
    to: user.email,
    toName: user.name,
    subject: '[ScheduleSync] 비밀번호 재설정 링크 안내',
    body: `${user.name}님,\n\n비밀번호 재설정 토큰: ${token}\n시스템 로그인 화면에서 '비밀번호 재설정' 탭을 통해 새 비밀번호를 설정하세요.`,
    sentAt: new Date().toISOString(),
  };
  db.mockEmails.unshift(mockEmail);
  saveDB(db);

  res.json({ success: true, message: '재설정 안내 이메일이 발송되었습니다.', token });
});

// 6. Auth: Confirm Password Reset with Token
app.post('/api/auth/password-reset-confirm', (req, res) => {
  const { token, newPassword } = req.body;
  const user = db.users.find((u) => u.resetToken === token);
  if (!user) {
    return res.status(400).json({ error: '유효하지 않거나 만료된 재설정 토큰입니다.' });
  }

  const newSalt = generateSalt();
  user.passwordSalt = newSalt;
  user.passwordHash = hashPassword(newPassword, newSalt);
  user.resetToken = undefined;
  saveDB(db);

  logAudit(user, 'RESET_PASSWORD', 'EMPLOYEE', user.id, '토큰을 통한 비밀번호 재설정 완료');
  res.json({ success: true });
});

// 7. Get Full System State (Departments, Employees, Projects, Assignments, Notifications, etc.)
app.get('/api/state', authMiddleware, (req: AuthenticatedRequest, res) => {
  const safeUsers = db.users.map(({ passwordHash, passwordSalt, ...u }) => u);
  res.json({
    departments: db.departments,
    employees: safeUsers,
    projects: db.projects,
    sessions: db.sessions,
    assignments: db.assignments,
    changeRequests: db.changeRequests,
    allowedOverlaps: db.allowedOverlaps,
    notifications: db.notifications,
    mockEmails: db.mockEmails,
    auditLogs: db.auditLogs,
  });
});

// 8. Projects: Create Project (Approver only)
app.post('/api/projects', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'APPROVER') {
    return res.status(403).json({ error: '프로젝트 등록은 허가권자만 가능합니다.' });
  }

  const { project, sessions } = req.body;
  const projectId = `proj-${Date.now()}`;
  const now = new Date().toISOString();

  const newProject = {
    ...project,
    id: projectId,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  };

  const newSessions = (sessions || []).map((s: any, idx: number) => ({
    ...s,
    id: `sess-${Date.now()}-${idx}`,
    projectId,
  }));

  db.projects.unshift(newProject);
  db.sessions.push(...newSessions);
  saveDB(db);

  logAudit(user, 'CREATE_PROJECT', 'PROJECT', projectId, `신규 프로젝트 [${newProject.name}] 등록`);
  res.json({ success: true, project: newProject, sessions: newSessions });
});

// 9. Projects: Update Project Metadata
app.patch('/api/projects/:id', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const proj = db.projects.find((p) => p.id === req.params.id);
  if (!proj) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  if (proj.createdBy !== user.id && user.role !== 'ADMIN') {
    return res.status(403).json({ error: '자신이 등록한 프로젝트만 수정할 수 있습니다.' });
  }

  Object.assign(proj, req.body, { updatedAt: new Date().toISOString() });
  saveDB(db);

  logAudit(user, 'UPDATE_PROJECT', 'PROJECT', proj.id, `[${proj.name}] 정보 수정`);
  res.json({ success: true, project: proj });
});

// 10. Assignments: Assign
app.post('/api/assignments', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { projectId, employeeId, confirmOverlap, conflicts } = req.body;

  const proj = db.projects.find((p) => p.id === projectId);
  if (!proj) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  if (proj.createdBy !== user.id) {
    return res.status(403).json({ error: '자신이 등록한 프로젝트에만 배정할 수 있습니다.' });
  }

  const targetEmp = db.users.find((u) => u.id === employeeId);
  if (!targetEmp || targetEmp.status !== 'ACTIVE') {
    return res.status(400).json({ error: '활성 상태의 직원만 배정할 수 있습니다.' });
  }

  const now = new Date().toISOString();
  const assignmentId = `asg-${Date.now()}`;

  // Self Assign
  if (employeeId === user.id) {
    const newAsg = {
      id: assignmentId,
      projectId,
      employeeId,
      assignedBy: user.id,
      type: 'SELF',
      status: 'APPROVED',
      createdAt: now,
      updatedAt: now,
      approvalDecisions: [],
    };
    db.assignments.unshift(newAsg);

    if (confirmOverlap && Array.isArray(conflicts)) {
      conflicts.forEach((c: any) => {
        db.allowedOverlaps.push({
          id: `ao-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          employeeId: user.id,
          sessionAId: c.targetSession?.sessionId || '',
          sessionBId: c.conflictingSession?.sessionId || '',
          source: 'SELF_ASSIGN',
          sourceId: assignmentId,
          createdAt: now,
        });
      });
    }

    logAudit(user, 'SELF_ASSIGN', 'ASSIGNMENT', assignmentId, `[${proj.name}] 셀프 투입 확정`);
    saveDB(db);
    return res.json({ success: true, assignment: newAsg });
  }

  // Approver to Approver
  if (targetEmp.role === 'APPROVER') {
    const newAsg = {
      id: assignmentId,
      projectId,
      employeeId,
      assignedBy: user.id,
      type: 'APPROVER',
      status: 'EMPLOYEE_PENDING',
      createdAt: now,
      updatedAt: now,
      approvalDecisions: [],
    };
    db.assignments.unshift(newAsg);

    // Notification & Email
    db.notifications.unshift({
      id: `noti-${Date.now()}`,
      recipientId: employeeId,
      type: 'ASSIGNED',
      title: '프로젝트 배정 요청',
      message: `${user.name}님이 [${proj.name}] 프로젝트에 배정하였습니다. 수락 여부를 결정해 주세요.`,
      read: false,
      linkTab: 'inbox',
      createdAt: now,
    });

    logAudit(user, 'ASSIGN_APPROVER', 'ASSIGNMENT', assignmentId, `[${proj.name}]에 허가권자 ${targetEmp.name} 배정`);
    saveDB(db);
    return res.json({ success: true, assignment: newAsg });
  }

  // Approver to General Employee
  const approvers = db.users.filter((u) => u.role === 'APPROVER');
  const decisions = approvers.map((app) => ({
    id: `dec-${Date.now()}-${app.id}`,
    assignmentId,
    approverId: app.id,
    decision: 'PENDING',
  }));

  const newAsg = {
    id: assignmentId,
    projectId,
    employeeId,
    assignedBy: user.id,
    type: 'EMPLOYEE',
    status: 'EMPLOYEE_PENDING',
    createdAt: now,
    updatedAt: now,
    approvalDecisions: decisions,
  };
  db.assignments.unshift(newAsg);

  db.notifications.unshift({
    id: `noti-${Date.now()}`,
    recipientId: employeeId,
    type: 'ASSIGNED',
    title: '프로젝트 배정 요청',
    message: `${user.name}님이 [${proj.name}] 프로젝트에 배정하였습니다. 수락 여부를 결정해 주세요.`,
    read: false,
    linkTab: 'inbox',
    createdAt: now,
  });

  logAudit(user, 'ASSIGN_EMPLOYEE', 'ASSIGNMENT', assignmentId, `[${proj.name}]에 일반 직원 ${targetEmp.name} 배정`);
  saveDB(db);
  res.json({ success: true, assignment: newAsg });
});

// 11. Assignments: Respond (Accept / Decline)
app.post('/api/assignments/:id/response', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { accept, declineReason } = req.body;
  const asg = db.assignments.find((a) => a.id === req.params.id);

  if (!asg) return res.status(404).json({ error: '배정 내역을 찾을 수 없습니다.' });
  if (asg.employeeId !== user.id) {
    return res.status(403).json({ error: '본인에게 할당된 배정만 수락/거절할 수 있습니다.' });
  }

  const proj = db.projects.find((p) => p.id === asg.projectId);
  const now = new Date().toISOString();

  if (!accept) {
    asg.status = 'DECLINED';
    asg.declineReason = declineReason || '개인 사정으로 인한 거절';
    asg.updatedAt = now;

    db.notifications.unshift({
      id: `noti-${Date.now()}`,
      recipientId: asg.assignedBy,
      type: 'DECLINED',
      title: '배정 거절 알림',
      message: `${user.name}님이 [${proj?.name}] 배정을 거절하였습니다. 사유: ${asg.declineReason}`,
      read: false,
      linkTab: 'projects',
      createdAt: now,
    });

    logAudit(user, 'DECLINE_ASSIGNMENT', 'ASSIGNMENT', asg.id, `직원 ${user.name} 배정 거절`);
    saveDB(db);
    return res.json({ success: true, assignment: asg });
  }

  // Accepted
  if (asg.type === 'APPROVER') {
    asg.status = 'APPROVED';
    asg.updatedAt = now;

    db.notifications.unshift({
      id: `noti-${Date.now()}`,
      recipientId: asg.assignedBy,
      type: 'ACCEPTED',
      title: '배정 수락 및 최종 확정',
      message: `허가권자 ${user.name}님이 [${proj?.name}] 배정을 수락하여 참여가 최종 확정되었습니다.`,
      read: false,
      linkTab: 'calendar',
      createdAt: now,
    });

    logAudit(user, 'APPROVER_ACCEPT', 'ASSIGNMENT', asg.id, `허가권자 ${user.name} 수락으로 [${proj?.name}] 확정`);
    saveDB(db);
    return res.json({ success: true, assignment: asg });
  }

  // General Employee Accepted -> APPROVAL_PENDING
  asg.status = 'APPROVAL_PENDING';
  asg.updatedAt = now;

  const approvers = db.users.filter((u) => u.role === 'APPROVER');
  approvers.forEach((app) => {
    db.notifications.unshift({
      id: `noti-${Date.now()}-${app.id}`,
      recipientId: app.id,
      type: 'APPROVAL_REQUEST',
      title: '배정 승인 요청',
      message: `[${proj?.name}]에 ${user.name} 직원이 배정을 수락하여 허가권자 승인이 필요합니다.`,
      read: false,
      linkTab: 'inbox',
      createdAt: now,
    });
  });

  logAudit(user, 'EMPLOYEE_ACCEPT', 'ASSIGNMENT', asg.id, `직원 ${user.name} 수락으로 허가권자 전원 승인 대기`);
  saveDB(db);
  res.json({ success: true, assignment: asg });
});

// 12. Assignments: Approver Decision (Approve / Reject)
app.post('/api/assignments/:id/decision', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'APPROVER') {
    return res.status(403).json({ error: '허가권자만 승인 또는 반려할 수 있습니다.' });
  }

  const { decision, comment } = req.body;
  const asg = db.assignments.find((a) => a.id === req.params.id);
  if (!asg) return res.status(404).json({ error: '배정 내역을 찾을 수 없습니다.' });

  const proj = db.projects.find((p) => p.id === asg.projectId);
  const targetEmp = db.users.find((u) => u.id === asg.employeeId);
  const now = new Date().toISOString();

  if (decision === 'REJECTED') {
    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: '반려 시에는 반려 사유를 필수로 입력해야 합니다.' });
    }

    asg.status = 'REJECTED';
    asg.declineReason = `허가권자 ${user.name} 반려: ${comment}`;
    asg.updatedAt = now;

    const myDec = asg.approvalDecisions.find((d: any) => d.approverId === user.id);
    if (myDec) {
      myDec.decision = 'REJECTED';
      myDec.comment = comment;
      myDec.decidedAt = now;
    }

    db.notifications.unshift({
      id: `noti-${Date.now()}`,
      recipientId: asg.employeeId,
      type: 'REJECTED',
      title: '프로젝트 배정 반려',
      message: `[${proj?.name}] 배정 건이 ${user.name} 부서장에 의해 반려되었습니다. 사유: ${comment}`,
      read: false,
      linkTab: 'inbox',
      createdAt: now,
    });

    logAudit(user, 'REJECT_ASSIGNMENT', 'ASSIGNMENT', asg.id, `${targetEmp?.name} 배정 반려 (사유: ${comment})`);
    saveDB(db);
    return res.json({ success: true, assignment: asg });
  }

  // Approved
  const myDec = asg.approvalDecisions.find((d: any) => d.approverId === user.id);
  if (myDec) {
    myDec.decision = 'APPROVED';
    myDec.comment = comment;
    myDec.decidedAt = now;
  }

  const approvers = db.users.filter((u) => u.role === 'APPROVER');
  const allApproved = approvers.every((app) => {
    const dec = asg.approvalDecisions.find((d: any) => d.approverId === app.id);
    return dec && dec.decision === 'APPROVED';
  });

  if (allApproved) {
    asg.status = 'APPROVED';
    asg.updatedAt = now;

    db.notifications.unshift({
      id: `noti-${Date.now()}`,
      recipientId: asg.employeeId,
      type: 'APPROVED',
      title: '프로젝트 참여 확정!',
      message: `[${proj?.name}] 프로젝트 배정이 허가권자 전원의 승인을 받아 최종 확정되었습니다!`,
      read: false,
      linkTab: 'calendar',
      createdAt: now,
    });

    logAudit(user, 'FINAL_APPROVE_ASSIGNMENT', 'ASSIGNMENT', asg.id, `전원 승인 달성으로 ${targetEmp?.name} 참여 최종 확정`);
  } else {
    logAudit(user, 'APPROVE_ASSIGNMENT', 'ASSIGNMENT', asg.id, `허가권자 ${user.name} 승인 완료 (타 허가권자 대기)`);
  }

  saveDB(db);
  res.json({ success: true, assignment: asg });
});

// 13. Assignments: Withdraw
app.post('/api/assignments/:id/withdraw', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const asg = db.assignments.find((a) => a.id === req.params.id);
  if (!asg) return res.status(404).json({ error: '배정 내역을 찾을 수 없습니다.' });

  const proj = db.projects.find((p) => p.id === asg.projectId);
  if (proj?.createdBy !== user.id) {
    return res.status(403).json({ error: '등록한 허가권자만 배정을 취소할 수 있습니다.' });
  }

  asg.status = 'WITHDRAWN';
  asg.updatedAt = new Date().toISOString();
  saveDB(db);

  logAudit(user, 'WITHDRAW_ASSIGNMENT', 'ASSIGNMENT', asg.id, `[${proj?.name}] 배정 철회`);
  res.json({ success: true });
});

// 14. Assignments: Release
app.post('/api/assignments/:id/release', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const asg = db.assignments.find((a) => a.id === req.params.id);
  if (!asg) return res.status(404).json({ error: '배정 내역을 찾을 수 없습니다.' });

  const proj = db.projects.find((p) => p.id === asg.projectId);
  if (proj?.createdBy !== user.id) {
    return res.status(403).json({ error: '등록한 허가권자만 참여를 해제할 수 있습니다.' });
  }

  asg.status = 'RELEASED';
  asg.updatedAt = new Date().toISOString();
  saveDB(db);

  logAudit(user, 'RELEASE_ASSIGNMENT', 'ASSIGNMENT', asg.id, `[${proj?.name}]에서 참여 해제`);
  res.json({ success: true });
});

// 15. Schedule Sessions & Change Requests
app.put('/api/projects/:id/sessions', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const proj = db.projects.find((p) => p.id === req.params.id);
  if (!proj) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  if (proj.createdBy !== user.id) {
    return res.status(403).json({ error: '자신이 등록한 프로젝트의 일정만 수정할 수 있습니다.' });
  }

  const { sessions: newSessionInputs, directApply, changeRequestData } = req.body;
  const now = new Date().toISOString();

  if (directApply) {
    db.sessions = db.sessions.filter((s) => s.projectId !== proj.id);
    const newSessions = newSessionInputs.map((s: any, idx: number) => ({
      ...s,
      id: `sess-${Date.now()}-${idx}`,
      projectId: proj.id,
    }));
    db.sessions.push(...newSessions);
    saveDB(db);

    logAudit(user, 'UPDATE_SESSIONS_DIRECT', 'SESSION', proj.id, `[${proj.name}] 일정 변경 반영`);
    return res.json({ success: true, appliedDirectly: true });
  }

  // Create Change Request
  const requestId = `cr-${Date.now()}`;
  const changeReq = {
    id: requestId,
    projectId: proj.id,
    requestedBy: user.id,
    proposedSessions: newSessionInputs,
    conflicts: changeRequestData?.conflicts || [],
    status: 'CHANGE_PENDING',
    createdAt: now,
    decisions: changeRequestData?.decisions || [],
  };

  db.changeRequests.unshift(changeReq);
  saveDB(db);

  logAudit(user, 'CREATE_CHANGE_REQUEST', 'CHANGE_REQUEST', requestId, `[${proj.name}] 일정 변경 요청 생성`);
  res.json({ success: true, appliedDirectly: false, changeRequest: changeReq });
});

// 16. Change Request Decision
app.post('/api/change-requests/:id/decision', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { decision, comment } = req.body;
  const cr = db.changeRequests.find((c) => c.id === req.params.id);
  if (!cr) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });

  const myDec = cr.decisions.find((d: any) => d.actorId === user.id);
  if (!myDec) return res.status(403).json({ error: '본인에게 할당된 승인/동의 요청이 아닙니다.' });

  const now = new Date().toISOString();

  if (decision === 'REJECTED') {
    cr.status = 'CHANGE_REJECTED';
    myDec.decision = 'REJECTED';
    myDec.comment = comment;
    myDec.decidedAt = now;

    logAudit(user, 'REJECT_CHANGE_REQUEST', 'CHANGE_REQUEST', cr.id, `일정 변경 반려 (사유: ${comment || '미입력'})`);
    saveDB(db);
    return res.json({ success: true });
  }

  // Approved
  myDec.decision = 'APPROVED';
  myDec.comment = comment;
  myDec.decidedAt = now;

  const allApproved = cr.decisions.every((d: any) => d.decision === 'APPROVED');
  if (allApproved) {
    db.sessions = db.sessions.filter((s) => s.projectId !== cr.projectId);
    const newSessions = cr.proposedSessions.map((s: any, idx: number) => ({
      ...s,
      id: `sess-${Date.now()}-${idx}`,
      projectId: cr.projectId,
    }));
    db.sessions.push(...newSessions);
    cr.status = 'CHANGE_APPROVED';

    logAudit(user, 'APPROVE_CHANGE_REQUEST_FINAL', 'CHANGE_REQUEST', cr.id, '일정 변경 최종 승인 및 캘린더 반영');
  }

  saveDB(db);
  res.json({ success: true, allApproved });
});

// 17. Admin: Create Employee Account
app.post('/api/admin/employees', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') {
    return res.status(403).json({ error: '시스템 관리자만 계정을 발급할 수 있습니다.' });
  }

  const { name, email, departmentId, role } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: '이름과 이메일을 입력하세요.' });
  }

  const existing = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: '이미 존재하는 이메일 계정입니다.' });
  }

  const salt = generateSalt();
  const initialPassword = 'password123!';
  const empId = `emp-${Date.now()}`;

  const newEmp: UserRecord = {
    id: empId,
    email,
    name,
    departmentId: departmentId || 'dept-1',
    role: role || 'EMPLOYEE',
    status: 'ACTIVE',
    timezone: 'Asia/Seoul',
    avatarColor: 'bg-emerald-600',
    passwordSalt: salt,
    passwordHash: hashPassword(initialPassword, salt),
  };

  db.users.push(newEmp);

  // Send invitation email
  db.mockEmails.unshift({
    id: `mail-${Date.now()}`,
    to: email,
    toName: name,
    subject: '[ScheduleSync] 직원 계정 발급 및 초기 비밀번호 안내',
    body: `${name}님,\n\nScheduleSync 계정이 발급되었습니다.\n- 이메일: ${email}\n- 초기 비밀번호: ${initialPassword}\n\n로그인 후 즉시 비밀번호를 변경하여 주시기 바랍니다.`,
    sentAt: new Date().toISOString(),
  });

  logAudit(user, 'CREATE_EMPLOYEE', 'EMPLOYEE', empId, `신규 직원 [${name} (${email})] 계정 발급`);
  saveDB(db);

  const { passwordHash, passwordSalt, ...safeEmp } = newEmp;
  res.json({ success: true, employee: safeEmp });
});

// 18. Admin: Toggle Employee Status (Active / Disabled)
app.patch('/api/admin/employees/:id/status', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') {
    return res.status(403).json({ error: '시스템 관리자만 계정 상태를 변경할 수 있습니다.' });
  }

  const target = db.users.find((u) => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: '직원을 찾을 수 없습니다.' });

  target.status = target.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  saveDB(db);

  logAudit(user, 'TOGGLE_EMPLOYEE_STATUS', 'EMPLOYEE', target.id, `직원 [${target.name}] 상태 -> ${target.status}`);
  res.json({ success: true, status: target.status });
});

// 19. Admin: Update Department Head
app.patch('/api/admin/departments/:id/head', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') {
    return res.status(403).json({ error: '관리자만 부서장을 임명할 수 있습니다.' });
  }

  const dept = db.departments.find((d) => d.id === req.params.id);
  if (!dept) return res.status(404).json({ error: '부서를 찾을 수 없습니다.' });

  const { headEmployeeId } = req.body;
  dept.headEmployeeId = headEmployeeId;

  const targetUser = db.users.find((u) => u.id === headEmployeeId);
  if (targetUser) {
    targetUser.role = 'APPROVER';
  }
  saveDB(db);

  logAudit(user, 'UPDATE_DEPT_HEAD', 'DEPARTMENT', dept.id, `[${dept.name}] 부서장 -> ${targetUser?.name}`);
  res.json({ success: true });
});

// 20. System: Reset to Clean/Default DB
app.post('/api/system/reset-demo', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') {
    return res.status(403).json({ error: '관리자만 시스템을 초기화할 수 있습니다.' });
  }

  db = createDefaultDB();
  saveDB(db);

  logAudit(user, 'RESET_SYSTEM', 'DEPARTMENT', 'dept-1', '전체 데이터 초기화 실행');
  res.json({ success: true });
});

// -------------------------------------------------------------
// Vite Integration & Server Startup
// -------------------------------------------------------------
async function startServer() {
  if (!isProduction) {
    // Development mode with Vite Middleware
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production mode
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ScheduleSync Pro Server] listening on http://0.0.0.0:${PORT} (env: ${process.env.NODE_ENV || 'dev'})`);
  });
}

startServer();
