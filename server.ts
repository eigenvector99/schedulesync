import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import nodemailer from 'nodemailer';
import { checkEmployeeOverlap } from './src/utils/dateAndRrule';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '1mb' }));

// -------------------------------------------------------------
// Database file location (DATA_DIR, default ./data)
// -------------------------------------------------------------
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, 'data');
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
  /** PBKDF2 iteration count. Missing on legacy records (= LEGACY_PBKDF2_ITER). */
  passwordIter?: number;
  /** SHA-256 of the one-time reset / invitation token (the raw token is only ever e-mailed). */
  resetTokenHash?: string;
  resetTokenExpiresAt?: string;
}

interface TokenRecord {
  /** SHA-256 of the bearer token. The raw token is never stored. */
  tokenHash: string;
  userId: string;
  expiresAt: string;
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
  tokens: TokenRecord[];
}

// -------------------------------------------------------------
// Crypto / ID helpers
// -------------------------------------------------------------
const pbkdf2Async = promisify(crypto.pbkdf2);
const PBKDF2_ITER = 310_000;
const LEGACY_PBKDF2_ITER = 1_000;

async function hashPassword(password: string, salt: string, iter = PBKDF2_ITER): Promise<string> {
  return (await pbkdf2Async(password, salt, iter, 64, 'sha512')).toString('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Returns an error message, or null when the password is acceptable. */
function validatePassword(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return '비밀번호는 10자 이상이어야 합니다.';
  if (pw.length > 128) return '비밀번호는 128자 이하여야 합니다.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '비밀번호는 영문자와 숫자를 모두 포함해야 합니다.';
  return null;
}

// -------------------------------------------------------------
// Database Persistence Layer (File-backed; see README for the planned RDB migration)
// -------------------------------------------------------------
function emptyDB(): DBData {
  return {
    users: [],
    departments: [],
    projects: [],
    sessions: [],
    assignments: [],
    changeRequests: [],
    allowedOverlaps: [],
    notifications: [],
    mockEmails: [],
    auditLogs: [],
    tokens: [],
  };
}

function loadDB(): DBData {
  if (!fs.existsSync(DB_FILE)) return emptyDB();
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  try {
    const parsed = { ...emptyDB(), ...JSON.parse(raw) } as DBData;
    // Drop sessions issued by the legacy schema (raw tokens) and expired ones.
    const now = Date.now();
    parsed.tokens = (parsed.tokens || []).filter((t: any) => t.tokenHash && new Date(t.expiresAt).getTime() > now);
    return parsed;
  } catch (e) {
    // Never silently reset production data: keep the broken file for recovery and stop.
    const backup = `${DB_FILE}.corrupt-${Date.now()}`;
    fs.copyFileSync(DB_FILE, backup);
    console.error(`[FATAL] ${DB_FILE} could not be parsed. A copy was saved to ${backup}.`, e);
    process.exit(1);
  }
}

function saveDB(data: DBData) {
  // Write to a temp file and rename so a crash can never leave a half-written database.
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}

let db: DBData = loadDB();

/**
 * First-run bootstrap: the only account that ever exists out of the box is the administrator
 * described by ADMIN_EMAIL / ADMIN_PASSWORD. There are no built-in demo users or passwords.
 */
async function bootstrapAdmin() {
  if (db.users.length > 0) return;
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const pwError = validatePassword(password);
  if (!email || pwError) {
    console.error(
      '[FATAL] 빈 데이터베이스입니다. 최초 관리자 계정을 만들려면 ADMIN_EMAIL, ADMIN_PASSWORD(10자 이상, 영문+숫자) 환경변수를 설정하세요.' +
        (pwError && email ? ` (${pwError})` : '')
    );
    process.exit(1);
  }

  const salt = generateSalt();
  const deptId = 'dept-1';
  db.departments.push({ id: deptId, name: '기본 부서', headEmployeeId: '' });
  db.users.push({
    id: newId('emp'),
    email: email!,
    name: process.env.ADMIN_NAME?.trim() || '시스템 관리자',
    departmentId: deptId,
    role: 'ADMIN',
    status: 'ACTIVE',
    timezone: 'Asia/Seoul',
    avatarColor: 'bg-slate-700',
    passwordSalt: salt,
    passwordHash: await hashPassword(password!, salt),
    passwordIter: PBKDF2_ITER,
  });
  saveDB(db);
  console.log(`[bootstrap] 최초 관리자 계정을 생성했습니다: ${email}`);
}

// -------------------------------------------------------------
// Outbound mail (SMTP). Without SMTP_HOST nothing is sent; in development the message is
// printed to the server console, in production only the fact that it was skipped is logged.
// -------------------------------------------------------------
const mailTransport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!mailTransport) {
    if (isProduction) console.warn(`[mail] SMTP 미설정 - "${subject}" 발송 생략 (to: ${to})`);
    else console.log(`[mail:dev] to=${to}\nsubject=${subject}\n${text}\n`);
    return false;
  }
  try {
    await mailTransport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
    return true;
  } catch (e) {
    console.error(`[mail] 발송 실패 (to: ${to}, subject: ${subject}):`, e);
    return false;
  }
}

function appUrl(): string {
  return (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
}

/** Issues a one-time token for password reset / account activation and mails it. */
async function issueResetToken(user: UserRecord, ttlMinutes: number, kind: 'reset' | 'invite') {
  const token = crypto.randomBytes(32).toString('hex');
  user.resetTokenHash = sha256(token);
  user.resetTokenExpiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  saveDB(db);

  const link = `${appUrl()}/?resetToken=${token}`;
  const subject = kind === 'invite' ? '[ScheduleSync] 계정이 발급되었습니다' : '[ScheduleSync] 비밀번호 재설정 안내';
  const body =
    kind === 'invite'
      ? `${user.name}님,\n\nScheduleSync 계정이 발급되었습니다. 아래 링크에서 비밀번호를 설정하면 사용할 수 있습니다. (${Math.round(ttlMinutes / 60)}시간 내 1회 사용 가능)\n\n${link}\n\n토큰: ${token}`
      : `${user.name}님,\n\n비밀번호 재설정을 요청하셨습니다. 아래 링크에서 새 비밀번호를 설정하세요. (${ttlMinutes}분 내 1회 사용 가능)\n\n${link}\n\n토큰: ${token}\n\n요청하지 않으셨다면 이 메일을 무시하셔도 됩니다.`;
  await sendMail(user.email, subject, body);
}

// -------------------------------------------------------------
// Tiny in-memory rate limiter (per process). Replace with a shared store when scaling out.
// -------------------------------------------------------------
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (b.resetAt <= now) rateBuckets.delete(k);
  const before = db.tokens.length;
  db.tokens = db.tokens.filter((t) => new Date(t.expiresAt).getTime() > now);
  if (db.tokens.length !== before) saveDB(db);
}, 10 * 60_000).unref();

// -------------------------------------------------------------
// Authentication Middleware
// -------------------------------------------------------------
interface AuthenticatedRequest extends Request {
  user?: UserRecord;
  tokenHash?: string;
}

const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '인증이 필요합니다. (Missing token)' });
  }

  const tokenHash = sha256(authHeader.substring(7));
  const tokenRecord = db.tokens.find((t) => t.tokenHash === tokenHash);
  if (!tokenRecord || new Date(tokenRecord.expiresAt).getTime() <= Date.now()) {
    return res.status(401).json({ error: '유효하지 않거나 만료된 세션입니다.' });
  }

  const user = db.users.find((u) => u.id === tokenRecord.userId);
  if (!user || user.status !== 'ACTIVE') {
    return res.status(403).json({ error: '계정이 비활성화되었거나 존재하지 않습니다.' });
  }

  req.user = user;
  req.tokenHash = tokenHash;
  next();
};

function revokeSessions(userId: string, exceptTokenHash?: string) {
  db.tokens = db.tokens.filter((t) => t.userId !== userId || t.tokenHash === exceptTokenHash);
}

function publicUser(u: UserRecord, viewer: UserRecord) {
  const { passwordHash, passwordSalt, passwordIter, resetTokenHash, resetTokenExpiresAt, ...safe } = u;
  // E-mail addresses are only visible to the owner and administrators.
  if (viewer.role !== 'ADMIN' && viewer.id !== u.id) return { ...safe, email: '' };
  return safe;
}

function logAudit(
  actor: UserRecord | undefined,
  action: string,
  targetType: string,
  targetId: string,
  details: string
) {
  const log = {
    id: newId('log'),
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
const LOGIN_ERROR = '이메일 또는 비밀번호가 올바르지 않습니다.';
const DUMMY_SALT = generateSalt();

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: '이메일과 비밀번호를 모두 입력하세요.' });
  }

  // Brute-force protection: per IP and per target account.
  if (
    rateLimited(`login:ip:${req.ip}`, 30, 15 * 60_000) ||
    rateLimited(`login:acct:${email.toLowerCase()}`, 10, 15 * 60_000)
  ) {
    return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' });
  }

  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  // Always run a hash so response time does not reveal whether the account exists.
  const iter = user?.passwordIter ?? LEGACY_PBKDF2_ITER;
  const computedHash = await hashPassword(password, user?.passwordSalt ?? DUMMY_SALT, iter);

  if (!user || !safeEqualHex(computedHash, user.passwordHash)) {
    return res.status(401).json({ error: LOGIN_ERROR });
  }
  if (user.status === 'DISABLED') {
    return res.status(403).json({ error: '비활성화된 계정입니다. 관리자에게 문의하세요.' });
  }
  if (user.status !== 'ACTIVE') {
    return res.status(403).json({ error: '아직 활성화되지 않은 계정입니다. 초대 메일의 링크로 비밀번호를 설정하세요.' });
  }

  // Transparently upgrade legacy hashes to the current work factor.
  if (iter !== PBKDF2_ITER) {
    user.passwordSalt = generateSalt();
    user.passwordHash = await hashPassword(password, user.passwordSalt);
    user.passwordIter = PBKDF2_ITER;
  }

  const token = `tok_${crypto.randomBytes(32).toString('hex')}`;
  db.tokens.push({
    tokenHash: sha256(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  });
  saveDB(db);

  logAudit(user, 'USER_LOGIN', 'EMPLOYEE', user.id, `로그인 성공 (${user.email})`);

  res.json({ token, user: publicUser(user, user) });
});

// 2. Auth: Get Current User (Me)
app.get('/api/auth/me', authMiddleware, (req: AuthenticatedRequest, res) => {
  res.json({ user: publicUser(req.user!, req.user!) });
});

// 3. Auth: Logout
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokenHash = sha256(authHeader.substring(7));
    db.tokens = db.tokens.filter((t) => t.tokenHash !== tokenHash);
    saveDB(db);
  }
  res.json({ success: true });
});

// 4. Auth: Change Password
app.post('/api/auth/change-password', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  const user = req.user!;

  if (rateLimited(`chpw:${user.id}`, 10, 15 * 60_000)) {
    return res.status(429).json({ error: '시도가 너무 많습니다. 잠시 후 다시 시도하세요.' });
  }
  const pwError = validatePassword(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });
  if (typeof currentPassword !== 'string') {
    return res.status(400).json({ error: '현재 비밀번호를 입력하세요.' });
  }

  const currentComputed = await hashPassword(currentPassword, user.passwordSalt, user.passwordIter ?? LEGACY_PBKDF2_ITER);
  if (!safeEqualHex(currentComputed, user.passwordHash)) {
    return res.status(400).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
  }

  user.passwordSalt = generateSalt();
  user.passwordHash = await hashPassword(newPassword, user.passwordSalt);
  user.passwordIter = PBKDF2_ITER;
  // Sign out every other device.
  revokeSessions(user.id, req.tokenHash);
  saveDB(db);

  logAudit(user, 'CHANGE_PASSWORD', 'EMPLOYEE', user.id, '비밀번호 변경 완료');
  res.json({ success: true });
});

// 5. Auth: Reset Password Request. The token is only ever delivered by e-mail, and the response
// is identical whether or not the address is registered (no account enumeration).
app.post('/api/auth/password-reset-request', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const generic = { success: true, message: '입력하신 이메일이 등록되어 있다면 재설정 안내 메일이 발송됩니다.' };
  if (!email) return res.status(400).json({ error: '이메일을 입력하세요.' });

  if (rateLimited(`reset:ip:${req.ip}`, 10, 60 * 60_000) || rateLimited(`reset:acct:${email}`, 3, 60 * 60_000)) {
    return res.json(generic); // silently throttle; do not reveal anything
  }

  const user = db.users.find((u) => u.email.toLowerCase() === email);
  if (user && user.status !== 'DISABLED') {
    await issueResetToken(user, 30, 'reset');
    logAudit(user, 'PASSWORD_RESET_REQUEST', 'EMPLOYEE', user.id, '비밀번호 재설정 메일 발송');
  }
  res.json(generic);
});

// 6. Auth: Confirm Password Reset / Account Activation with a one-time token
app.post('/api/auth/password-reset-confirm', async (req, res) => {
  const { token, newPassword } = req.body ?? {};
  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: '유효하지 않거나 만료된 재설정 토큰입니다.' });
  }
  if (rateLimited(`resetc:ip:${req.ip}`, 20, 60 * 60_000)) {
    return res.status(429).json({ error: '시도가 너무 많습니다. 잠시 후 다시 시도하세요.' });
  }
  const pwError = validatePassword(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });

  const tokenHash = sha256(token.trim());
  const user = db.users.find(
    (u) =>
      u.resetTokenHash &&
      safeEqualHex(u.resetTokenHash, tokenHash) &&
      u.resetTokenExpiresAt &&
      new Date(u.resetTokenExpiresAt).getTime() > Date.now()
  );
  if (!user || user.status === 'DISABLED') {
    return res.status(400).json({ error: '유효하지 않거나 만료된 재설정 토큰입니다.' });
  }

  user.passwordSalt = generateSalt();
  user.passwordHash = await hashPassword(newPassword, user.passwordSalt);
  user.passwordIter = PBKDF2_ITER;
  user.resetTokenHash = undefined;
  user.resetTokenExpiresAt = undefined;
  if (user.status === 'INVITED') user.status = 'ACTIVE';
  revokeSessions(user.id);
  saveDB(db);

  logAudit(user, 'RESET_PASSWORD', 'EMPLOYEE', user.id, '토큰을 통한 비밀번호 설정/재설정 완료');
  res.json({ success: true });
});

// 7. Get System State, scoped to what the caller is allowed to see.
//    Calendar-relevant data (projects, sessions, assignments) is company-wide by design;
//    personal and administrative data is not.
app.get('/api/state', authMiddleware, (req: AuthenticatedRequest, res) => {
  const me = req.user!;
  const isAdmin = me.role === 'ADMIN';

  const involvedInAssignment = (a: any) =>
    isAdmin || a.employeeId === me.id || a.assignedBy === me.id || a.approvalDecisions?.some((d: any) => d.approverId === me.id);

  res.json({
    departments: db.departments,
    employees: db.users.filter((u) => u.status !== 'INVITED' || isAdmin).map((u) => publicUser(u, me)),
    projects: db.projects,
    sessions: db.sessions,
    // Decline / reject reasons are only shown to the people involved.
    assignments: db.assignments.map((a) => {
      if (involvedInAssignment(a)) return a;
      const { declineReason, ...rest } = a;
      return {
        ...rest,
        approvalDecisions: (a.approvalDecisions || []).map(({ comment, ...d }: any) => d),
      };
    }),
    changeRequests: db.changeRequests.filter(
      (c) => isAdmin || c.requestedBy === me.id || c.decisions?.some((d: any) => d.actorId === me.id)
    ),
    allowedOverlaps: db.allowedOverlaps,
    notifications: db.notifications.filter((n) => n.recipientId === me.id),
    mockEmails: db.mockEmails.filter((m) => m.to?.toLowerCase() === me.email.toLowerCase()),
    auditLogs: isAdmin ? db.auditLogs : [],
  });
});

// -------------------------------------------------------------
// Validation helpers
// -------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const PROJECT_STATUSES = ['PLANNING', 'RECRUITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

function cleanStr(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : null;
}

/** Validates + whitelists the editable project fields. Returns the clean fields or an error. */
function sanitizeProjectFields(input: any, partial: boolean): { fields?: Record<string, any>; error?: string } {
  const body = input ?? {};
  const f: Record<string, any> = {};
  const has = (k: string) => body[k] !== undefined;

  if (!partial || has('name')) {
    const name = cleanStr(body.name, 120);
    if (!name) return { error: '프로젝트명을 입력하세요. (120자 이내)' };
    f.name = name;
  }
  if (has('description')) {
    if (typeof body.description !== 'string' || body.description.length > 2000) return { error: '설명이 올바르지 않습니다.' };
    f.description = body.description;
  } else if (!partial) f.description = '';
  for (const k of ['startDate', 'endDate']) {
    if (!partial || has(k)) {
      if (typeof body[k] !== 'string' || !DATE_RE.test(body[k]) || Number.isNaN(Date.parse(body[k]))) {
        return { error: '날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)' };
      }
      f[k] = body[k];
    }
  }
  if (has('status')) {
    if (!PROJECT_STATUSES.includes(body.status)) return { error: '프로젝트 상태가 올바르지 않습니다.' };
    f.status = body.status;
  } else if (!partial) f.status = 'RECRUITING';
  if (has('headcount')) {
    if (!Number.isInteger(body.headcount) || body.headcount < 1 || body.headcount > 1000) {
      return { error: '필요 인원이 올바르지 않습니다.' };
    }
    f.headcount = body.headcount;
  }
  if (has('color')) {
    if (typeof body.color !== 'string' || !COLOR_RE.test(body.color)) return { error: '색상 형식이 올바르지 않습니다.' };
    f.color = body.color;
  } else if (!partial) f.color = '#2563eb';
  return { fields: f };
}

function sanitizeSessions(input: unknown): { sessions?: any[]; error?: string } {
  if (!Array.isArray(input) || input.length > 50) return { error: '세션 목록이 올바르지 않습니다.' };
  const out: any[] = [];
  for (const s of input as any[]) {
    const title = typeof s?.title === 'string' ? s.title.slice(0, 120) : '';
    const recurring = Array.isArray(s?.daysOfWeek) && s.daysOfWeek.length > 0;
    if (recurring) {
      if (!s.daysOfWeek.every((d: any) => Number.isInteger(d) && d >= 0 && d <= 6)) return { error: '요일 값이 올바르지 않습니다.' };
      if (!TIME_RE.test(s.startTime) || !TIME_RE.test(s.endTime) || s.startTime >= s.endTime) {
        return { error: '세션 시작/종료 시간이 올바르지 않습니다.' };
      }
    } else {
      const a = Date.parse(s?.startAt);
      const b = Date.parse(s?.endAt);
      if (Number.isNaN(a) || Number.isNaN(b) || a >= b) return { error: '세션 시작/종료 일시가 올바르지 않습니다.' };
    }
    out.push({
      title,
      startAt: s.startAt,
      endAt: s.endAt,
      rrule: typeof s.rrule === 'string' ? s.rrule.slice(0, 200) : undefined,
      daysOfWeek: recurring ? [...new Set<number>(s.daysOfWeek)] : undefined,
      startTime: s.startTime,
      endTime: s.endTime,
      timezone: typeof s.timezone === 'string' ? s.timezone : 'Asia/Seoul',
    });
  }
  return { sessions: out };
}

// -------------------------------------------------------------
// Domain helpers (server-side source of truth)
// -------------------------------------------------------------
const ACTIVE_ASSIGNMENT_STATUSES = ['EMPLOYEE_PENDING', 'APPROVAL_PENDING', 'APPROVED'];

function activeApprovers(): UserRecord[] {
  // NOTE: "all approvers" is the current business rule (v1.0). Narrowing it to
  // "project owner + the employee's department head" is an open product decision.
  return db.users.filter((u) => u.role === 'APPROVER' && u.status === 'ACTIVE');
}

/** Recomputes time conflicts for an employee on a project using stored data, never client input. */
function serverConflicts(employeeId: string, projectId: string) {
  const proj = db.projects.find((p) => p.id === projectId);
  if (!proj) return { hasConflict: false, conflicts: [] as any[], pendingCount: 0 };
  return checkEmployeeOverlap(
    employeeId,
    proj,
    db.sessions.filter((s) => s.projectId === projectId),
    db.projects,
    db.sessions,
    db.assignments,
    db.allowedOverlaps,
    db.users as any,
    projectId
  );
}

function notify(recipientId: string, type: string, title: string, message: string, linkTab: string) {
  db.notifications.unshift({
    id: newId('noti'),
    recipientId,
    type,
    title,
    message,
    read: false,
    linkTab,
    createdAt: new Date().toISOString(),
  });
}

// 8. Projects: Create Project (Approver only)
app.post('/api/projects', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'APPROVER') {
    return res.status(403).json({ error: '프로젝트 등록은 허가권자만 가능합니다.' });
  }

  const p = sanitizeProjectFields(req.body?.project, false);
  if (p.error) return res.status(400).json({ error: p.error });
  if (p.fields!.startDate > p.fields!.endDate) return res.status(400).json({ error: '종료일은 시작일 이후여야 합니다.' });
  const s = sanitizeSessions(req.body?.sessions ?? []);
  if (s.error) return res.status(400).json({ error: s.error });

  const projectId = newId('proj');
  const now = new Date().toISOString();
  const newProject: any = { ...p.fields, id: projectId, createdBy: user.id, createdAt: now, updatedAt: now };
  const newSessions = s.sessions!.map((x) => ({ ...x, id: newId('sess'), projectId }));

  db.projects.unshift(newProject);
  db.sessions.push(...newSessions);
  saveDB(db);

  logAudit(user, 'CREATE_PROJECT', 'PROJECT', projectId, `신규 프로젝트 [${newProject.name}] 등록`);
  res.json({ success: true, project: newProject, sessions: newSessions });
});

// 9. Projects: Update Project Metadata (whitelisted fields only)
app.patch('/api/projects/:id', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const proj = db.projects.find((p) => p.id === req.params.id);
  if (!proj) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  if (proj.createdBy !== user.id && user.role !== 'ADMIN') {
    return res.status(403).json({ error: '자신이 등록한 프로젝트만 수정할 수 있습니다.' });
  }

  const p = sanitizeProjectFields(req.body, true);
  if (p.error) return res.status(400).json({ error: p.error });
  const next = { ...proj, ...p.fields };
  if (next.startDate > next.endDate) return res.status(400).json({ error: '종료일은 시작일 이후여야 합니다.' });

  Object.assign(proj, p.fields, { updatedAt: new Date().toISOString() });
  saveDB(db);

  logAudit(user, 'UPDATE_PROJECT', 'PROJECT', proj.id, `[${proj.name}] 정보 수정`);
  res.json({ success: true, project: proj });
});

// 10. Assignments: Assign
app.post('/api/assignments', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { projectId, employeeId, confirmOverlap } = req.body ?? {};

  if (user.role !== 'APPROVER') return res.status(403).json({ error: '배정은 허가권자만 할 수 있습니다.' });

  const proj = db.projects.find((p) => p.id === projectId);
  if (!proj) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
  if (proj.createdBy !== user.id) {
    return res.status(403).json({ error: '자신이 등록한 프로젝트에만 배정할 수 있습니다.' });
  }
  if (proj.status === 'CANCELLED' || proj.status === 'COMPLETED') {
    return res.status(400).json({ error: '종료되었거나 취소된 프로젝트에는 배정할 수 없습니다.' });
  }

  const targetEmp = db.users.find((u) => u.id === employeeId);
  if (!targetEmp || targetEmp.status !== 'ACTIVE' || targetEmp.role === 'ADMIN') {
    return res.status(400).json({ error: '활성 상태의 직원만 배정할 수 있습니다.' });
  }
  if (db.assignments.some((a) => a.projectId === projectId && a.employeeId === employeeId && ACTIVE_ASSIGNMENT_STATUSES.includes(a.status))) {
    return res.status(409).json({ error: '이미 해당 프로젝트에 배정(또는 진행 중)인 직원입니다.' });
  }

  const now = new Date().toISOString();
  const assignmentId = newId('asg');

  // Self Assign: instantly confirmed, but overlapping time must be explicitly acknowledged.
  if (employeeId === user.id) {
    const check = serverConflicts(user.id, projectId);
    if (check.hasConflict && !confirmOverlap) {
      return res.status(409).json({
        error: '다른 확정 프로젝트와 시간이 겹칩니다. 경고 확인 후 투입을 확정할 수 있습니다.',
        needConfirmation: true,
        conflicts: check.conflicts,
      });
    }

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

    // The allowed overlaps are recorded from the server-computed conflicts.
    check.conflicts.forEach((c: any) => {
      db.allowedOverlaps.push({
        id: newId('ao'),
        employeeId: user.id,
        sessionAId: c.targetSession?.sessionId || '',
        sessionBId: c.conflictingSession?.sessionId || '',
        source: 'SELF_ASSIGN',
        sourceId: assignmentId,
        createdAt: now,
      });
    });

    logAudit(user, 'SELF_ASSIGN', 'ASSIGNMENT', assignmentId, `[${proj.name}] 셀프 투입 확정`);
    return res.json({ success: true, assignment: newAsg });
  }

  const isApproverTarget = targetEmp.role === 'APPROVER';
  const newAsg = {
    id: assignmentId,
    projectId,
    employeeId,
    assignedBy: user.id,
    type: isApproverTarget ? 'APPROVER' : 'EMPLOYEE',
    status: 'EMPLOYEE_PENDING',
    createdAt: now,
    updatedAt: now,
    approvalDecisions: isApproverTarget
      ? []
      : activeApprovers().map((a) => ({
          id: newId('dec'),
          assignmentId,
          approverId: a.id,
          decision: 'PENDING',
        })),
  };
  db.assignments.unshift(newAsg);

  notify(
    employeeId,
    'ASSIGNED',
    '프로젝트 배정 요청',
    `${user.name}님이 [${proj.name}] 프로젝트에 배정하였습니다. 수락 여부를 결정해 주세요.`,
    'inbox'
  );

  logAudit(
    user,
    isApproverTarget ? 'ASSIGN_APPROVER' : 'ASSIGN_EMPLOYEE',
    'ASSIGNMENT',
    assignmentId,
    `[${proj.name}]에 ${isApproverTarget ? '허가권자' : '일반 직원'} ${targetEmp.name} 배정`
  );
  res.json({ success: true, assignment: newAsg });
});

// 11. Assignments: Respond (Accept / Decline)
app.post('/api/assignments/:id/response', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { accept, declineReason } = req.body ?? {};
  const asg = db.assignments.find((a) => a.id === req.params.id);

  if (!asg) return res.status(404).json({ error: '배정 내역을 찾을 수 없습니다.' });
  if (asg.employeeId !== user.id) {
    return res.status(403).json({ error: '본인에게 할당된 배정만 수락/거절할 수 있습니다.' });
  }
  if (asg.status !== 'EMPLOYEE_PENDING') {
    return res.status(409).json({ error: '수락 대기 상태의 배정만 응답할 수 있습니다.' });
  }

  const proj = db.projects.find((p) => p.id === asg.projectId);
  const now = new Date().toISOString();

  if (!accept) {
    const reason = typeof declineReason === 'string' && declineReason.trim() ? declineReason.trim().slice(0, 500) : '개인 사정으로 인한 거절';
    asg.status = 'DECLINED';
    asg.declineReason = reason;
    asg.updatedAt = now;

    notify(asg.assignedBy, 'DECLINED', '배정 거절 알림', `${user.name}님이 [${proj?.name}] 배정을 거절하였습니다. 사유: ${reason}`, 'projects');
    logAudit(user, 'DECLINE_ASSIGNMENT', 'ASSIGNMENT', asg.id, `직원 ${user.name} 배정 거절`);
    return res.json({ success: true, assignment: asg });
  }

  // Accepted: approver-to-approver assignments are confirmed immediately, but never over a conflict.
  const check = serverConflicts(asg.employeeId, asg.projectId);
  if (asg.type === 'APPROVER') {
    if (check.hasConflict && !req.body?.confirmOverlap) {
      return res.status(409).json({
        error: '다른 확정 프로젝트와 시간이 겹칩니다. 겹침을 확인한 뒤 수락하세요.',
        needConfirmation: true,
        conflicts: check.conflicts,
      });
    }
    asg.status = 'APPROVED';
    asg.updatedAt = now;
    check.conflicts.forEach((c: any) => {
      db.allowedOverlaps.push({
        id: newId('ao'),
        employeeId: asg.employeeId,
        sessionAId: c.targetSession?.sessionId || '',
        sessionBId: c.conflictingSession?.sessionId || '',
        source: 'APPROVER_ACCEPT',
        sourceId: asg.id,
        createdAt: now,
      });
    });

    notify(asg.assignedBy, 'ACCEPTED', '배정 수락 및 최종 확정', `허가권자 ${user.name}님이 [${proj?.name}] 배정을 수락하여 참여가 최종 확정되었습니다.`, 'calendar');
    logAudit(user, 'APPROVER_ACCEPT', 'ASSIGNMENT', asg.id, `허가권자 ${user.name} 수락으로 [${proj?.name}] 확정`);
    return res.json({ success: true, assignment: asg });
  }

  // General employee: move to the all-approver approval stage.
  asg.status = 'APPROVAL_PENDING';
  asg.updatedAt = now;

  asg.approvalDecisions.forEach((d: any) => {
    notify(d.approverId, 'APPROVAL_REQUEST', '배정 승인 요청', `[${proj?.name}]에 ${user.name} 직원이 배정을 수락하여 허가권자 승인이 필요합니다.`, 'inbox');
  });

  logAudit(user, 'EMPLOYEE_ACCEPT', 'ASSIGNMENT', asg.id, `직원 ${user.name} 수락으로 허가권자 전원 승인 대기`);
  res.json({ success: true, assignment: asg });
});

// 12. Assignments: Approver Decision (Approve / Reject)
app.post('/api/assignments/:id/decision', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'APPROVER') {
    return res.status(403).json({ error: '허가권자만 승인 또는 반려할 수 있습니다.' });
  }

  const { decision, comment } = req.body ?? {};
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return res.status(400).json({ error: '결정 값이 올바르지 않습니다.' });
  }
  const asg = db.assignments.find((a) => a.id === req.params.id);
  if (!asg) return res.status(404).json({ error: '배정 내역을 찾을 수 없습니다.' });
  if (asg.status !== 'APPROVAL_PENDING') {
    return res.status(409).json({ error: '승인 대기 상태의 배정만 승인/반려할 수 있습니다.' });
  }

  const myDec = asg.approvalDecisions.find((d: any) => d.approverId === user.id);
  if (!myDec) return res.status(403).json({ error: '이 배정의 승인 대상 허가권자가 아닙니다.' });
  if (myDec.decision !== 'PENDING') return res.status(409).json({ error: '이미 결정을 내린 건입니다.' });

  const proj = db.projects.find((p) => p.id === asg.projectId);
  const targetEmp = db.users.find((u) => u.id === asg.employeeId);
  const now = new Date().toISOString();
  const note = typeof comment === 'string' ? comment.trim().slice(0, 500) : '';

  if (decision === 'REJECTED') {
    if (!note) return res.status(400).json({ error: '반려 시에는 반려 사유를 필수로 입력해야 합니다.' });

    asg.status = 'REJECTED';
    asg.declineReason = `허가권자 ${user.name} 반려: ${note}`;
    asg.updatedAt = now;
    myDec.decision = 'REJECTED';
    myDec.comment = note;
    myDec.decidedAt = now;

    notify(asg.employeeId, 'REJECTED', '프로젝트 배정 반려', `[${proj?.name}] 배정 건이 ${user.name} 부서장에 의해 반려되었습니다. 사유: ${note}`, 'inbox');
    logAudit(user, 'REJECT_ASSIGNMENT', 'ASSIGNMENT', asg.id, `${targetEmp?.name} 배정 반려 (사유: ${note})`);
    return res.json({ success: true, assignment: asg });
  }

  // Approval is blocked while the employee still has an unresolved time conflict.
  const check = serverConflicts(asg.employeeId, asg.projectId);
  if (check.hasConflict) {
    return res.status(409).json({
      error: '직원의 다른 확정 프로젝트와 시간이 겹쳐 승인할 수 없습니다. 반려하거나 일정 조정 후 다시 시도하세요.',
      conflicts: check.conflicts,
    });
  }

  myDec.decision = 'APPROVED';
  myDec.comment = note || undefined;
  myDec.decidedAt = now;

  const allApproved = asg.approvalDecisions.every((d: any) => d.decision === 'APPROVED');
  if (allApproved) {
    asg.status = 'APPROVED';
    asg.updatedAt = now;
    notify(asg.employeeId, 'APPROVED', '프로젝트 참여 확정!', `[${proj?.name}] 프로젝트 배정이 허가권자 전원의 승인을 받아 최종 확정되었습니다!`, 'calendar');
    logAudit(user, 'FINAL_APPROVE_ASSIGNMENT', 'ASSIGNMENT', asg.id, `전원 승인 달성으로 ${targetEmp?.name} 참여 최종 확정`);
  } else {
    logAudit(user, 'APPROVE_ASSIGNMENT', 'ASSIGNMENT', asg.id, `허가권자 ${user.name} 승인 완료 (타 허가권자 대기)`);
  }

  res.json({ success: true, assignment: asg });
});

// 13. Assignments: Withdraw (before confirmation)
app.post('/api/assignments/:id/withdraw', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const asg = db.assignments.find((a) => a.id === req.params.id);
  if (!asg) return res.status(404).json({ error: '배정 내역을 찾을 수 없습니다.' });

  const proj = db.projects.find((p) => p.id === asg.projectId);
  if (proj?.createdBy !== user.id) {
    return res.status(403).json({ error: '등록한 허가권자만 배정을 취소할 수 있습니다.' });
  }
  if (asg.status !== 'EMPLOYEE_PENDING' && asg.status !== 'APPROVAL_PENDING') {
    return res.status(409).json({ error: '확정 전(대기 중)인 배정만 철회할 수 있습니다.' });
  }

  asg.status = 'WITHDRAWN';
  asg.updatedAt = new Date().toISOString();
  notify(asg.employeeId, 'WITHDRAWN', '배정 철회', `[${proj?.name}] 배정이 ${user.name}님에 의해 철회되었습니다.`, 'inbox');
  logAudit(user, 'WITHDRAW_ASSIGNMENT', 'ASSIGNMENT', asg.id, `[${proj?.name}] 배정 철회`);
  res.json({ success: true });
});

// 14. Assignments: Release (after confirmation)
app.post('/api/assignments/:id/release', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const asg = db.assignments.find((a) => a.id === req.params.id);
  if (!asg) return res.status(404).json({ error: '배정 내역을 찾을 수 없습니다.' });

  const proj = db.projects.find((p) => p.id === asg.projectId);
  if (proj?.createdBy !== user.id) {
    return res.status(403).json({ error: '등록한 허가권자만 참여를 해제할 수 있습니다.' });
  }
  if (asg.status !== 'APPROVED') {
    return res.status(409).json({ error: '확정된 참여만 해제할 수 있습니다.' });
  }

  asg.status = 'RELEASED';
  asg.updatedAt = new Date().toISOString();
  notify(asg.employeeId, 'RELEASED', '참여 해제', `[${proj?.name}] 참여가 ${user.name}님에 의해 해제되었습니다.`, 'calendar');
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

  const s = sanitizeSessions(req.body?.sessions);
  if (s.error) return res.status(400).json({ error: s.error });
  const now = new Date().toISOString();

  const replaceSessions = (projectId: string, list: any[]) => {
    db.sessions = db.sessions.filter((x) => x.projectId !== projectId);
    db.sessions.push(...list.map((x) => ({ ...x, id: newId('sess'), projectId })));
  };

  // Server-side decision on whether a change touches anyone else's schedule: never trust `directApply`.
  const participants = db.assignments.filter((a) => a.projectId === proj.id && ACTIVE_ASSIGNMENT_STATUSES.includes(a.status));
  const savedSessions = db.sessions;
  const savedProposal = db.sessions.filter((x) => x.projectId !== proj.id).concat(s.sessions!.map((x) => ({ ...x, id: `proposed-${x.title}`, projectId: proj.id })));
  let crossOwnerConflict = false;
  try {
    db.sessions = savedProposal;
    crossOwnerConflict = participants.some((a) =>
      serverConflicts(a.employeeId, proj.id).conflicts.some(
        (c: any) => c.conflictingProject.createdBy !== user.id && a.employeeId !== user.id
      )
    );
  } finally {
    db.sessions = savedSessions;
  }

  if (!crossOwnerConflict) {
    replaceSessions(proj.id, s.sessions!);
    saveDB(db);
    logAudit(user, 'UPDATE_SESSIONS_DIRECT', 'SESSION', proj.id, `[${proj.name}] 일정 변경 반영`);
    return res.json({ success: true, appliedDirectly: true });
  }

  // Another approver's project overlaps: a change request with approval + consent is mandatory.
  const decisions: any[] = [];
  const requestId = newId('cr');
  const conflictsList: any[] = [];
  db.sessions = savedProposal;
  try {
    participants.forEach((a) => {
      serverConflicts(a.employeeId, proj.id).conflicts.forEach((c: any) => {
        if (c.conflictingProject.createdBy === user.id || a.employeeId === user.id) return;
        conflictsList.push(c);
        const ownerId = c.conflictingProject.createdBy;
        if (!decisions.some((d) => d.actorId === ownerId && (d.kind === 'APPROVAL' || d.kind === 'BOTH'))) {
          const ex = decisions.find((d) => d.actorId === ownerId);
          if (ex) ex.kind = 'BOTH';
          else decisions.push({ id: newId('cd'), changeRequestId: requestId, actorId: ownerId, kind: 'APPROVAL', decision: 'PENDING' });
        }
        const exE = decisions.find((d) => d.actorId === a.employeeId);
        if (exE) {
          if (exE.kind === 'APPROVAL') exE.kind = 'BOTH';
        } else {
          decisions.push({ id: newId('cd'), changeRequestId: requestId, actorId: a.employeeId, kind: 'CONSENT', decision: 'PENDING' });
        }
      });
    });
  } finally {
    db.sessions = savedSessions;
  }

  const changeReq = {
    id: requestId,
    projectId: proj.id,
    requestedBy: user.id,
    proposedSessions: s.sessions,
    conflicts: conflictsList,
    status: 'CHANGE_PENDING',
    createdAt: now,
    decisions,
  };

  db.changeRequests.unshift(changeReq);
  decisions.forEach((d) =>
    notify(d.actorId, 'CHANGE_REQUEST', '일정 변경 승인/동의 요청', `[${proj.name}] 일정 변경에 대한 ${d.kind === 'CONSENT' ? '동의' : '승인'}가 필요합니다.`, 'inbox')
  );
  saveDB(db);

  logAudit(user, 'CREATE_CHANGE_REQUEST', 'CHANGE_REQUEST', requestId, `[${proj.name}] 일정 변경 요청 생성`);
  res.json({ success: true, appliedDirectly: false, changeRequest: changeReq });
});

// 16. Change Request Decision
app.post('/api/change-requests/:id/decision', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { decision, comment } = req.body ?? {};
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return res.status(400).json({ error: '결정 값이 올바르지 않습니다.' });
  }
  const cr = db.changeRequests.find((c) => c.id === req.params.id);
  if (!cr) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
  if (cr.status !== 'CHANGE_PENDING') return res.status(409).json({ error: '진행 중인 변경 요청이 아닙니다.' });

  const myDec = cr.decisions.find((d: any) => d.actorId === user.id);
  if (!myDec) return res.status(403).json({ error: '본인에게 할당된 승인/동의 요청이 아닙니다.' });
  if (myDec.decision !== 'PENDING') return res.status(409).json({ error: '이미 결정을 내린 건입니다.' });

  const now = new Date().toISOString();
  const note = typeof comment === 'string' ? comment.trim().slice(0, 500) : '';

  if (decision === 'REJECTED') {
    cr.status = 'CHANGE_REJECTED';
    myDec.decision = 'REJECTED';
    myDec.comment = note;
    myDec.decidedAt = now;
    notify(cr.requestedBy, 'CHANGE_REJECTED', '일정 변경 반려', `일정 변경 요청이 ${user.name}님에 의해 반려되었습니다.`, 'inbox');
    logAudit(user, 'REJECT_CHANGE_REQUEST', 'CHANGE_REQUEST', cr.id, `일정 변경 반려 (사유: ${note || '미입력'})`);
    return res.json({ success: true });
  }

  myDec.decision = 'APPROVED';
  myDec.comment = note;
  myDec.decidedAt = now;

  const allApproved = cr.decisions.every((d: any) => d.decision === 'APPROVED');
  if (allApproved) {
    db.sessions = db.sessions.filter((x) => x.projectId !== cr.projectId);
    db.sessions.push(...cr.proposedSessions.map((x: any) => ({ ...x, id: newId('sess'), projectId: cr.projectId })));
    cr.status = 'CHANGE_APPROVED';
    notify(cr.requestedBy, 'CHANGE_APPROVED', '일정 변경 승인', '일정 변경 요청이 최종 승인되어 캘린더에 반영되었습니다.', 'calendar');
    logAudit(user, 'APPROVE_CHANGE_REQUEST_FINAL', 'CHANGE_REQUEST', cr.id, '일정 변경 최종 승인 및 캘린더 반영');
  } else {
    saveDB(db);
  }

  res.json({ success: true, allApproved });
});

// 17. Admin: Create Employee Account (invitation flow; no shared initial password)
app.post('/api/admin/employees', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') {
    return res.status(403).json({ error: '시스템 관리자만 계정을 발급할 수 있습니다.' });
  }

  const name = cleanStr(req.body?.name, 60);
  const email = cleanStr(req.body?.email, 200)?.toLowerCase();
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: '이름과 올바른 이메일을 입력하세요.' });
  }
  if (db.users.some((u) => u.email.toLowerCase() === email)) {
    return res.status(400).json({ error: '이미 존재하는 이메일 계정입니다.' });
  }
  const departmentId = req.body?.departmentId;
  if (!db.departments.some((d) => d.id === departmentId)) {
    return res.status(400).json({ error: '존재하지 않는 부서입니다.' });
  }
  const role = req.body?.role === 'APPROVER' || req.body?.role === 'ADMIN' ? req.body.role : 'EMPLOYEE';

  const salt = generateSalt();
  const newEmp: UserRecord = {
    id: newId('emp'),
    email,
    name,
    departmentId,
    role,
    status: 'INVITED',
    timezone: 'Asia/Seoul',
    avatarColor: 'bg-emerald-600',
    passwordSalt: salt,
    // Random, unknown password: the account only becomes usable through the invitation link.
    passwordHash: await hashPassword(crypto.randomBytes(32).toString('hex'), salt),
    passwordIter: PBKDF2_ITER,
  };
  db.users.push(newEmp);
  await issueResetToken(newEmp, 72 * 60, 'invite');

  logAudit(user, 'CREATE_EMPLOYEE', 'EMPLOYEE', newEmp.id, `신규 직원 [${name} (${email})] 초대 발송`);
  res.json({ success: true, employee: publicUser(newEmp, user) });
});

// 18. Admin: Toggle Employee Status (Active / Disabled)
app.patch('/api/admin/employees/:id/status', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') {
    return res.status(403).json({ error: '시스템 관리자만 계정 상태를 변경할 수 있습니다.' });
  }

  const target = db.users.find((u) => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: '직원을 찾을 수 없습니다.' });
  if (target.id === user.id) return res.status(400).json({ error: '본인 계정은 비활성화할 수 없습니다.' });
  if (target.status === 'INVITED') return res.status(400).json({ error: '아직 활성화되지 않은 초대 계정입니다.' });

  target.status = target.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  if (target.status === 'DISABLED') revokeSessions(target.id);
  saveDB(db);

  logAudit(user, 'TOGGLE_EMPLOYEE_STATUS', 'EMPLOYEE', target.id, `직원 [${target.name}] 상태 -> ${target.status}`);
  res.json({ success: true, status: target.status });
});

// 19. Admin: Create Department
app.post('/api/admin/departments', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') return res.status(403).json({ error: '관리자만 부서를 등록할 수 있습니다.' });
  const name = cleanStr(req.body?.name, 60);
  if (!name) return res.status(400).json({ error: '부서명을 입력하세요.' });
  if (db.departments.some((d) => d.name === name)) return res.status(400).json({ error: '이미 존재하는 부서명입니다.' });

  const dept = { id: newId('dept'), name, headEmployeeId: '' };
  db.departments.push(dept);
  logAudit(user, 'CREATE_DEPARTMENT', 'DEPARTMENT', dept.id, `부서 [${name}] 등록`);
  res.json({ success: true, department: dept });
});

// 20. Admin: Update Department Head
app.patch('/api/admin/departments/:id/head', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') {
    return res.status(403).json({ error: '관리자만 부서장을 임명할 수 있습니다.' });
  }

  const dept = db.departments.find((d) => d.id === req.params.id);
  if (!dept) return res.status(404).json({ error: '부서를 찾을 수 없습니다.' });

  const targetUser = db.users.find((u) => u.id === req.body?.headEmployeeId);
  if (!targetUser || targetUser.status !== 'ACTIVE' || targetUser.role === 'ADMIN') {
    return res.status(400).json({ error: '활성 상태의 직원만 부서장으로 임명할 수 있습니다.' });
  }

  const previousHeadId = dept.headEmployeeId;
  dept.headEmployeeId = targetUser.id;
  targetUser.role = 'APPROVER';

  // Demote the previous head unless they still head another department.
  const prev = db.users.find((u) => u.id === previousHeadId);
  if (prev && prev.id !== targetUser.id && prev.role === 'APPROVER' && !db.departments.some((d) => d.headEmployeeId === prev.id)) {
    prev.role = 'EMPLOYEE';
  }
  saveDB(db);

  logAudit(user, 'UPDATE_DEPT_HEAD', 'DEPARTMENT', dept.id, `[${dept.name}] 부서장 -> ${targetUser.name}`);
  res.json({ success: true });
});

// -------------------------------------------------------------
// Vite Integration & Server Startup
// -------------------------------------------------------------
async function startServer() {
  await bootstrapAdmin();
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
