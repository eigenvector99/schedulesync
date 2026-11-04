import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { deliver, notifyDM, verifySlack, DeliveryResult } from './server/notifier';
import { openDb, migrate, Db, Queryable } from './server/db';
import {
  UserRecord,
  mapUser,
  publicUser,
  mapDepartment,
  mapProject,
  mapSession,
  mapAssignment,
  mapChangeRequest,
  mapAllowedOverlap,
  mapNotification,
  mapAuditLog,
} from './server/mappers';
import { checkEmployeeOverlap, isValidTimeZone, MAX_EXPAND_DAYS, addDaysStr } from './src/utils/dateAndRrule';

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
// Database (PostgreSQL via DATABASE_URL, or embedded PostgreSQL under DATA_DIR)
// -------------------------------------------------------------
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

let db: Db;

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
// HTTP / transaction plumbing
// -------------------------------------------------------------
class HttpError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body.error ?? status));
  }
}
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => new HttpError(status, { error, ...extra });

interface AuthenticatedRequest extends Request {
  user?: UserRecord;
  tokenHash?: string;
}

/** Express 4 does not catch rejected promises; this turns them (and HttpError) into responses. */
const route =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => {
    fn(req as AuthenticatedRequest, res).catch((e) => {
      if (e instanceof HttpError) return res.status(e.status).json(e.body);
      console.error(`[error] ${req.method} ${req.path}:`, e);
      if (!res.headersSent) res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    });
  };

interface Ctx {
  q: Queryable;
  /** Runs after the transaction committed (Slack DMs must never announce rolled-back changes). */
  after: (fn: () => unknown) => void;
}

async function transact<T>(fn: (c: Ctx) => Promise<T>): Promise<T> {
  const hooks: Array<() => unknown> = [];
  const result = await db.tx((q) => fn({ q, after: (f) => hooks.push(f) }));
  for (const h of hooks) {
    try {
      await h();
    } catch (e) {
      console.error('[after-commit] hook failed:', e);
    }
  }
  return result;
}

const isUniqueViolation = (e: any) => e?.code === '23505' || /unique constraint|duplicate key/i.test(String(e?.message));

// -------------------------------------------------------------
// Notifications & audit
// -------------------------------------------------------------
function appUrl(): string {
  return (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
}

async function logAudit(
  q: Queryable,
  actor: Pick<UserRecord, 'id' | 'name'> | undefined,
  action: string,
  targetType: string,
  targetId: string,
  details: string
) {
  await q.query(
    `INSERT INTO audit_logs (id, actor_id, actor_name, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [newId('log'), actor?.id || 'SYSTEM', actor?.name || '시스템', action, targetType, targetId, details]
  );
}

/** In-app notification now; Slack DM after the transaction commits. */
async function notify(c: Ctx, recipientId: string, type: string, title: string, message: string, linkTab: string) {
  await c.q.query(
    `INSERT INTO notifications (id, recipient_id, type, title, message, link_tab) VALUES ($1,$2,$3,$4,$5,$6)`,
    [newId('noti'), recipientId, type, title, message, linkTab]
  );
  const r = await c.q.query(`SELECT email, status FROM users WHERE id = $1`, [recipientId]);
  if (r.rows[0]?.status === 'ACTIVE') c.after(() => notifyDM(r.rows[0].email, title, message));
}

// -------------------------------------------------------------
// First-run bootstrap
// -------------------------------------------------------------
/**
 * The only account that ever exists out of the box is the administrator described by
 * ADMIN_EMAIL / ADMIN_PASSWORD. There are no built-in demo users or passwords.
 */
async function bootstrapAdmin() {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM users`);
  if (rows[0].n > 0) return;

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
  const hash = await hashPassword(password!, salt);
  await db.tx(async (q) => {
    await q.query(`INSERT INTO departments (id, name) VALUES ('dept-1', '기본 부서')`);
    await q.query(
      `INSERT INTO users (id, email, name, department_id, role, status, timezone, avatar_color, password_salt, password_hash, password_iter)
       VALUES ($1,$2,$3,'dept-1','ADMIN','ACTIVE','Asia/Seoul','bg-slate-700',$4,$5,$6)`,
      [newId('emp'), email, process.env.ADMIN_NAME?.trim() || '시스템 관리자', salt, hash, PBKDF2_ITER]
    );
  });
  console.log(`[bootstrap] 최초 관리자 계정을 생성했습니다: ${email}`);
}

/**
 * Issues a one-time token for password reset / account activation and delivers it
 * (Slack DM, falling back to SMTP). Returns the link so an administrator can hand it over
 * manually when delivery failed; callers must never expose it to anonymous requests.
 */
async function issueResetToken(
  user: Pick<UserRecord, 'id' | 'name' | 'email'>,
  ttlMinutes: number,
  kind: 'reset' | 'invite'
): Promise<{ link: string; delivery: DeliveryResult }> {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query(`UPDATE users SET reset_token_hash = $2, reset_token_expires_at = now() + make_interval(mins => $3::int) WHERE id = $1`, [
    user.id,
    sha256(token),
    ttlMinutes,
  ]);

  const link = `${appUrl()}/?resetToken=${token}`;
  const subject = kind === 'invite' ? '[ScheduleSync] 계정이 발급되었습니다' : '[ScheduleSync] 비밀번호 재설정 안내';
  const body =
    kind === 'invite'
      ? `${user.name}님,\n\nScheduleSync 계정이 발급되었습니다. 아래 링크에서 비밀번호를 설정하면 사용할 수 있습니다. (${Math.round(ttlMinutes / 60)}시간 내 1회 사용 가능)\n\n${link}\n\n토큰: ${token}`
      : `${user.name}님,\n\n비밀번호 재설정을 요청하셨습니다. 아래 링크에서 새 비밀번호를 설정하세요. (${ttlMinutes}분 내 1회 사용 가능)\n\n${link}\n\n토큰: ${token}\n\n요청하지 않으셨다면 이 메시지를 무시하셔도 됩니다.`;
  const delivery = await deliver(user.email, subject, body);
  return { link, delivery };
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

// -------------------------------------------------------------
// Authentication Middleware
// -------------------------------------------------------------
const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const r = req as AuthenticatedRequest;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '인증이 필요합니다. (Missing token)' });
  }
  const tokenHash = sha256(authHeader.substring(7));
  db.query(
    `SELECT u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1 AND t.expires_at > now()`,
    [tokenHash]
  )
    .then(({ rows }) => {
      if (rows.length === 0) return res.status(401).json({ error: '유효하지 않거나 만료된 세션입니다.' });
      const user = mapUser(rows[0]);
      if (user.status !== 'ACTIVE') return res.status(403).json({ error: '계정이 비활성화되었거나 존재하지 않습니다.' });
      r.user = user;
      r.tokenHash = tokenHash;
      next();
    })
    .catch((e) => {
      console.error('[auth] lookup failed:', e);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    });
};

const revokeSessions = (q: Queryable, userId: string, exceptTokenHash?: string) =>
  q.query(`DELETE FROM auth_tokens WHERE user_id = $1 AND token_hash IS DISTINCT FROM $2`, [userId, exceptTokenHash ?? null]);

// -------------------------------------------------------------
// REST API Endpoints
// -------------------------------------------------------------

// 0. Health check (load balancers / PaaS probes)
app.get('/api/health', route(async (_req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true, db: db.kind });
}));

// 1. Auth: Login
const LOGIN_ERROR = '이메일 또는 비밀번호가 올바르지 않습니다.';
const DUMMY_SALT = generateSalt();

app.post('/api/auth/login', route(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw fail(400, '이메일과 비밀번호를 모두 입력하세요.');
  }

  // Brute-force protection: per IP and per target account.
  if (
    rateLimited(`login:ip:${req.ip}`, 30, 15 * 60_000) ||
    rateLimited(`login:acct:${email.toLowerCase()}`, 10, 15 * 60_000)
  ) {
    throw fail(429, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.');
  }

  const found = await db.query(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
  const user = found.rows[0] ? mapUser(found.rows[0]) : undefined;
  // Always run a hash so response time does not reveal whether the account exists.
  const iter = user?.passwordIter ?? LEGACY_PBKDF2_ITER;
  const computedHash = await hashPassword(password, user?.passwordSalt ?? DUMMY_SALT, iter);

  if (!user || !safeEqualHex(computedHash, user.passwordHash)) throw fail(401, LOGIN_ERROR);
  if (user.status === 'DISABLED') throw fail(403, '비활성화된 계정입니다. 관리자에게 문의하세요.');
  if (user.status !== 'ACTIVE') {
    throw fail(403, '아직 활성화되지 않은 계정입니다. 초대 메시지의 링크로 비밀번호를 설정하세요.');
  }

  // Transparently upgrade legacy hashes to the current work factor.
  let upgrade: { salt: string; hash: string } | null = null;
  if (iter !== PBKDF2_ITER) {
    const salt = generateSalt();
    upgrade = { salt, hash: await hashPassword(password, salt) };
  }

  const token = `tok_${crypto.randomBytes(32).toString('hex')}`;
  await transact(async ({ q }) => {
    if (upgrade) {
      await q.query(`UPDATE users SET password_salt = $2, password_hash = $3, password_iter = $4 WHERE id = $1`, [
        user.id,
        upgrade.salt,
        upgrade.hash,
        PBKDF2_ITER,
      ]);
    }
    await q.query(`INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES ($1,$2, now() + interval '7 days')`, [sha256(token), user.id]);
    await logAudit(q, user, 'USER_LOGIN', 'EMPLOYEE', user.id, `로그인 성공 (${user.email})`);
  });

  res.json({ token, user: publicUser(user, user) });
}));

// 2. Auth: Get Current User (Me)
app.get('/api/auth/me', authMiddleware, route(async (req, res) => {
  res.json({ user: publicUser(req.user!, req.user!) });
}));

// 3. Auth: Logout
app.post('/api/auth/logout', route(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    await db.query(`DELETE FROM auth_tokens WHERE token_hash = $1`, [sha256(authHeader.substring(7))]);
  }
  res.json({ success: true });
}));

// 4. Auth: Change Password
app.post('/api/auth/change-password', authMiddleware, route(async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  const user = req.user!;

  if (rateLimited(`chpw:${user.id}`, 10, 15 * 60_000)) throw fail(429, '시도가 너무 많습니다. 잠시 후 다시 시도하세요.');
  const pwError = validatePassword(newPassword);
  if (pwError) throw fail(400, pwError);
  if (typeof currentPassword !== 'string') throw fail(400, '현재 비밀번호를 입력하세요.');

  const currentComputed = await hashPassword(currentPassword, user.passwordSalt, user.passwordIter ?? LEGACY_PBKDF2_ITER);
  if (!safeEqualHex(currentComputed, user.passwordHash)) throw fail(400, '현재 비밀번호가 일치하지 않습니다.');

  const salt = generateSalt();
  const hash = await hashPassword(newPassword, salt);
  await transact(async ({ q }) => {
    await q.query(`UPDATE users SET password_salt = $2, password_hash = $3, password_iter = $4 WHERE id = $1`, [user.id, salt, hash, PBKDF2_ITER]);
    await revokeSessions(q, user.id, req.tokenHash); // sign out every other device
    await logAudit(q, user, 'CHANGE_PASSWORD', 'EMPLOYEE', user.id, '비밀번호 변경 완료');
  });
  res.json({ success: true });
}));

// 5. Auth: Reset Password Request. The token is only ever delivered out of band (Slack DM / mail), and the
// response is identical whether or not the address is registered (no account enumeration).
app.post('/api/auth/password-reset-request', route(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const generic = { success: true, message: '입력하신 이메일이 등록되어 있다면 재설정 안내가 발송됩니다.' };
  if (!email) throw fail(400, '이메일을 입력하세요.');

  if (rateLimited(`reset:ip:${req.ip}`, 10, 60 * 60_000) || rateLimited(`reset:acct:${email}`, 3, 60 * 60_000)) {
    return res.json(generic); // silently throttle; do not reveal anything
  }

  const found = await db.query(`SELECT * FROM users WHERE lower(email) = $1`, [email]);
  const user = found.rows[0] ? mapUser(found.rows[0]) : undefined;
  if (user && user.status !== 'DISABLED') {
    await issueResetToken(user, 30, 'reset');
    await logAudit(db, user, 'PASSWORD_RESET_REQUEST', 'EMPLOYEE', user.id, '비밀번호 재설정 링크 발송');
  }
  res.json(generic);
}));

// 6. Auth: Confirm Password Reset / Account Activation with a one-time token
app.post('/api/auth/password-reset-confirm', route(async (req, res) => {
  const { token, newPassword } = req.body ?? {};
  if (typeof token !== 'string' || !token) throw fail(400, '유효하지 않거나 만료된 재설정 토큰입니다.');
  if (rateLimited(`resetc:ip:${req.ip}`, 20, 60 * 60_000)) throw fail(429, '시도가 너무 많습니다. 잠시 후 다시 시도하세요.');
  const pwError = validatePassword(newPassword);
  if (pwError) throw fail(400, pwError);

  const tokenHash = sha256(token.trim());
  const salt = generateSalt();
  const hash = await hashPassword(newPassword, salt);

  await transact(async ({ q }) => {
    // The token is cleared in the same statement that consumes it, so concurrent use can succeed only once.
    const r = await q.query(
      `UPDATE users
          SET password_salt = $2, password_hash = $3, password_iter = $4,
              reset_token_hash = NULL, reset_token_expires_at = NULL,
              status = CASE WHEN status = 'INVITED' THEN 'ACTIVE' ELSE status END
        WHERE reset_token_hash = $1 AND reset_token_expires_at > now() AND status <> 'DISABLED'
        RETURNING id, name`,
      [tokenHash, salt, hash, PBKDF2_ITER]
    );
    if (r.rows.length === 0) throw fail(400, '유효하지 않거나 만료된 재설정 토큰입니다.');
    const u = r.rows[0];
    await revokeSessions(q, u.id);
    await logAudit(q, u, 'RESET_PASSWORD', 'EMPLOYEE', u.id, '토큰을 통한 비밀번호 설정/재설정 완료');
  });
  res.json({ success: true });
}));

// 7. Get System State, scoped to what the caller is allowed to see.
//    Calendar-relevant data (projects, sessions, assignments) is company-wide by design;
//    personal and administrative data is not.
app.get('/api/state', authMiddleware, route(async (req, res) => {
  const me = req.user!;
  const isAdmin = me.role === 'ADMIN';

  const [departments, users, projects, sessions, assignments, decisions, crs, cds, overlaps, notifications, audit] = await Promise.all([
    db.query(`SELECT * FROM departments ORDER BY name`),
    db.query(`SELECT * FROM users ${isAdmin ? '' : `WHERE status <> 'INVITED'`} ORDER BY created_at, id`),
    db.query(`SELECT * FROM projects ORDER BY created_at DESC, id`),
    db.query(`SELECT * FROM sessions ORDER BY project_id, position`),
    db.query(`SELECT * FROM assignments ORDER BY created_at DESC, id`),
    db.query(`SELECT * FROM approval_decisions ORDER BY id`),
    db.query(`SELECT * FROM change_requests ORDER BY created_at DESC, id`),
    db.query(`SELECT * FROM change_decisions ORDER BY id`),
    db.query(`SELECT * FROM allowed_overlaps ORDER BY created_at`),
    db.query(`SELECT * FROM notifications WHERE recipient_id = $1 ORDER BY created_at DESC, id`, [me.id]),
    isAdmin ? db.query(`SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 2000`) : Promise.resolve({ rows: [] as any[] }),
  ]);

  const decisionsByAsg = new Map<string, any[]>();
  for (const d of decisions.rows) (decisionsByAsg.get(d.assignment_id) ?? decisionsByAsg.set(d.assignment_id, []).get(d.assignment_id)!).push(d);
  const decisionsByCr = new Map<string, any[]>();
  for (const d of cds.rows) (decisionsByCr.get(d.change_request_id) ?? decisionsByCr.set(d.change_request_id, []).get(d.change_request_id)!).push(d);

  res.json({
    departments: departments.rows.map(mapDepartment),
    employees: users.rows.map((r) => publicUser(mapUser(r), me)),
    projects: projects.rows.map(mapProject),
    sessions: sessions.rows.map(mapSession),
    // Decline / reject reasons are only shown to the people involved.
    assignments: assignments.rows.map((r) => {
      const decs = decisionsByAsg.get(r.id) ?? [];
      const involved = isAdmin || r.employee_id === me.id || r.assigned_by === me.id || decs.some((d) => d.approver_id === me.id);
      const a = mapAssignment(r, decs);
      if (involved) return a;
      const { declineReason, ...rest } = a;
      return { ...rest, approvalDecisions: a.approvalDecisions.map(({ comment, ...d }) => d) };
    }),
    changeRequests: crs.rows
      .map((r) => mapChangeRequest(r, decisionsByCr.get(r.id) ?? []))
      .filter((c) => isAdmin || c.requestedBy === me.id || c.decisions.some((d) => d.actorId === me.id)),
    allowedOverlaps: overlaps.rows.map(mapAllowedOverlap),
    notifications: notifications.rows.map(mapNotification),
    mockEmails: [],
    auditLogs: audit.rows.map(mapAuditLog),
  });
}));

// -------------------------------------------------------------
// Validation helpers
// -------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** Absolute instants must say which zone they are in; a bare local time would mean something else on every machine. */
const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
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
  if (f.startDate && f.endDate && addDaysStr(f.startDate, MAX_EXPAND_DAYS) < f.endDate) {
    return { error: '프로젝트 기간이 너무 깁니다. (최대 약 10년)' };
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

interface SessionInput {
  title: string;
  startAt?: string;
  endAt?: string;
  rrule?: string;
  daysOfWeek?: number[];
  startTime?: string;
  endTime?: string;
  timezone: string;
}

function sanitizeSessions(input: unknown): { sessions?: SessionInput[]; error?: string } {
  if (!Array.isArray(input) || input.length > 50) return { error: '세션 목록이 올바르지 않습니다.' };
  const out: SessionInput[] = [];
  for (const s of input as any[]) {
    const title = typeof s?.title === 'string' ? s.title.slice(0, 120) : '';
    const recurring = Array.isArray(s?.daysOfWeek) && s.daysOfWeek.length > 0;
    if (recurring) {
      if (!s.daysOfWeek.every((d: any) => Number.isInteger(d) && d >= 0 && d <= 6)) return { error: '요일 값이 올바르지 않습니다.' };
      if (!TIME_RE.test(s.startTime) || !TIME_RE.test(s.endTime) || s.startTime >= s.endTime) {
        return { error: '세션 시작/종료 시간이 올바르지 않습니다.' };
      }
    } else {
      if (!ISO_WITH_OFFSET_RE.test(s?.startAt) || !ISO_WITH_OFFSET_RE.test(s?.endAt)) {
        return { error: '단일 세션의 일시는 타임존(Z 또는 +09:00)을 포함한 형식이어야 합니다.' };
      }
      const a = Date.parse(s.startAt);
      const b = Date.parse(s.endAt);
      if (Number.isNaN(a) || Number.isNaN(b) || a >= b) return { error: '세션 시작/종료 일시가 올바르지 않습니다.' };
    }
    if (s?.timezone !== undefined && !isValidTimeZone(s.timezone)) return { error: '타임존이 올바르지 않습니다. (예: Asia/Seoul)' };
    out.push({
      title,
      startAt: typeof s.startAt === 'string' ? s.startAt : undefined,
      endAt: typeof s.endAt === 'string' ? s.endAt : undefined,
      rrule: typeof s.rrule === 'string' ? s.rrule.slice(0, 200) : undefined,
      daysOfWeek: recurring ? [...new Set<number>(s.daysOfWeek)] : undefined,
      startTime: typeof s.startTime === 'string' ? s.startTime : undefined,
      endTime: typeof s.endTime === 'string' ? s.endTime : undefined,
      timezone: typeof s.timezone === 'string' ? s.timezone : 'Asia/Seoul',
    });
  }
  return { sessions: out };
}

// -------------------------------------------------------------
// Domain helpers (the server is the source of truth)
// -------------------------------------------------------------
const ACTIVE_ASSIGNMENT_STATUSES = ['EMPLOYEE_PENDING', 'APPROVAL_PENDING', 'APPROVED'];

/**
 * "All approvers" is the current business rule (v1.0): every active APPROVER must approve.
 * Narrowing it (e.g. project owner + the employee's department head) is an open product decision and
 * would be changed only here.
 */
async function activeApprovers(q: Queryable): Promise<{ id: string }[]> {
  return (await q.query(`SELECT id FROM users WHERE role = 'APPROVER' AND status = 'ACTIVE' ORDER BY id`)).rows;
}

/** Locks (FOR SHARE / FOR UPDATE) a project row. Lock order is always project first, then employees by id. */
async function lockProject(q: Queryable, projectId: string, mode: 'SHARE' | 'UPDATE') {
  await q.query(`SELECT id FROM projects WHERE id = $1 FOR ${mode}`, [projectId]);
}

/** Serialises schedule-affecting work for the given employees (conflict check + status change = one unit). */
async function lockEmployees(q: Queryable, employeeIds: string[]) {
  const ids = [...new Set(employeeIds)].sort();
  if (ids.length) await q.query(`SELECT id FROM users WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, [ids]);
}

/**
 * Recomputes time conflicts for an employee from stored data, never from client input.
 * `proposedSessions` lets callers ask "what if this project had this schedule instead?".
 */
async function serverConflicts(q: Queryable, employeeId: string, projectId: string, proposedSessions?: SessionInput[]) {
  const projRow = (await q.query(`SELECT * FROM projects WHERE id = $1`, [projectId])).rows[0];
  if (!projRow) return { hasConflict: false, conflicts: [] as any[], pendingCount: 0 };
  const proj = mapProject(projRow);

  const asgRows = (await q.query(`SELECT * FROM assignments WHERE employee_id = $1`, [employeeId])).rows;
  const projectIds = [...new Set([projectId, ...asgRows.map((a) => a.project_id)])];
  const projRows = (await q.query(`SELECT * FROM projects WHERE id = ANY($1::text[])`, [projectIds])).rows;
  const sessRows = (await q.query(`SELECT * FROM sessions WHERE project_id = ANY($1::text[]) ORDER BY project_id, position`, [projectIds])).rows;
  const creatorIds = [...new Set(projRows.map((p) => p.created_by))];
  const userRows = (await q.query(`SELECT * FROM users WHERE id = ANY($1::text[])`, [creatorIds])).rows;
  const overlapRows = (await q.query(`SELECT * FROM allowed_overlaps WHERE employee_id = $1`, [employeeId])).rows;

  const allSessions = sessRows.map(mapSession);
  const targetSessions = proposedSessions
    ? proposedSessions.map((s, i) => ({ ...s, id: `proposed-${i}`, projectId }))
    : allSessions.filter((s) => s.projectId === projectId);

  return checkEmployeeOverlap(
    employeeId,
    proj as any,
    targetSessions as any,
    projRows.map(mapProject) as any,
    allSessions as any,
    asgRows.map((a) => mapAssignment(a)) as any,
    overlapRows.map(mapAllowedOverlap) as any,
    userRows.map((u) => mapUser(u)) as any,
    projectId
  );
}

async function recordAllowedOverlaps(q: Queryable, employeeId: string, conflicts: any[], source: string, sourceId: string) {
  for (const c of conflicts) {
    await q.query(
      `INSERT INTO allowed_overlaps (id, employee_id, session_a_id, session_b_id, source, source_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [newId('ao'), employeeId, c.targetSession?.sessionId || '', c.conflictingSession?.sessionId || '', source, sourceId]
    );
  }
}

async function insertSessions(q: Queryable, projectId: string, list: SessionInput[]) {
  let position = 0;
  for (const s of list) {
    await q.query(
      `INSERT INTO sessions (id, project_id, position, title, start_at, end_at, rrule, days_of_week, start_time, end_time, timezone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [newId('sess'), projectId, position++, s.title, s.startAt ?? null, s.endAt ?? null, s.rrule ?? null, s.daysOfWeek ?? null, s.startTime ?? null, s.endTime ?? null, s.timezone]
    );
  }
}

async function replaceSessions(q: Queryable, projectId: string, list: SessionInput[]) {
  await q.query(`DELETE FROM sessions WHERE project_id = $1`, [projectId]);
  await insertSessions(q, projectId, list);
}

async function getProject(q: Queryable, id: string, lock?: 'SHARE' | 'UPDATE') {
  const r = await q.query(`SELECT * FROM projects WHERE id = $1 ${lock ? `FOR ${lock}` : ''}`, [id]);
  if (!r.rows[0]) throw fail(404, '프로젝트를 찾을 수 없습니다.');
  return mapProject(r.rows[0]);
}

async function getAssignment(q: Queryable, id: string, lock = false) {
  const r = await q.query(`SELECT * FROM assignments WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!r.rows[0]) throw fail(404, '배정 내역을 찾을 수 없습니다.');
  return r.rows[0];
}

async function assignmentView(q: Queryable, id: string) {
  const a = (await q.query(`SELECT * FROM assignments WHERE id = $1`, [id])).rows[0];
  const d = (await q.query(`SELECT * FROM approval_decisions WHERE assignment_id = $1 ORDER BY id`, [id])).rows;
  return mapAssignment(a, d);
}

// 8. Projects: Create Project (Approver only)
app.post('/api/projects', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  if (user.role !== 'APPROVER') throw fail(403, '프로젝트 등록은 허가권자만 가능합니다.');

  const p = sanitizeProjectFields(req.body?.project, false);
  if (p.error) throw fail(400, p.error);
  if (p.fields!.startDate > p.fields!.endDate) throw fail(400, '종료일은 시작일 이후여야 합니다.');
  const s = sanitizeSessions(req.body?.sessions ?? []);
  if (s.error) throw fail(400, s.error);

  const f = p.fields!;
  const projectId = newId('proj');
  await transact(async ({ q }) => {
    await q.query(
      `INSERT INTO projects (id, name, description, created_by, start_date, end_date, status, headcount, color) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [projectId, f.name, f.description, user.id, f.startDate, f.endDate, f.status, f.headcount ?? null, f.color]
    );
    await insertSessions(q, projectId, s.sessions!);
    await logAudit(q, user, 'CREATE_PROJECT', 'PROJECT', projectId, `신규 프로젝트 [${f.name}] 등록`);
  });

  const project = mapProject((await db.query(`SELECT * FROM projects WHERE id = $1`, [projectId])).rows[0]);
  const sessions = (await db.query(`SELECT * FROM sessions WHERE project_id = $1 ORDER BY position`, [projectId])).rows.map(mapSession);
  res.json({ success: true, project, sessions });
}));

// 9. Projects: Update Project Metadata (whitelisted fields only)
app.patch('/api/projects/:id', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  const p = sanitizeProjectFields(req.body, true);
  if (p.error) throw fail(400, p.error);

  const project = await transact(async ({ q }) => {
    const proj = await getProject(q, req.params.id, 'UPDATE');
    if (proj.createdBy !== user.id && user.role !== 'ADMIN') throw fail(403, '자신이 등록한 프로젝트만 수정할 수 있습니다.');
    const next = { ...proj, ...p.fields };
    if (next.startDate > next.endDate) throw fail(400, '종료일은 시작일 이후여야 합니다.');

    await q.query(
      `UPDATE projects SET name=$2, description=$3, start_date=$4, end_date=$5, status=$6, headcount=$7, color=$8, updated_at=now() WHERE id=$1`,
      [proj.id, next.name, next.description, next.startDate, next.endDate, next.status, next.headcount ?? null, next.color]
    );
    await logAudit(q, user, 'UPDATE_PROJECT', 'PROJECT', proj.id, `[${next.name}] 정보 수정`);
    return mapProject((await q.query(`SELECT * FROM projects WHERE id = $1`, [proj.id])).rows[0]);
  });
  res.json({ success: true, project });
}));

// 10. Assignments: Assign
app.post('/api/assignments', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  const { projectId, employeeId, confirmOverlap } = req.body ?? {};
  if (user.role !== 'APPROVER') throw fail(403, '배정은 허가권자만 할 수 있습니다.');
  if (typeof projectId !== 'string' || typeof employeeId !== 'string') throw fail(400, '프로젝트와 직원을 지정하세요.');

  const assignment = await transact(async (c) => {
    const { q } = c;
    const proj = await getProject(q, projectId, 'SHARE');
    if (proj.createdBy !== user.id) throw fail(403, '자신이 등록한 프로젝트에만 배정할 수 있습니다.');
    if (proj.status === 'CANCELLED' || proj.status === 'COMPLETED') throw fail(400, '종료되었거나 취소된 프로젝트에는 배정할 수 없습니다.');

    await lockEmployees(q, [employeeId]);
    const target = (await q.query(`SELECT * FROM users WHERE id = $1`, [employeeId])).rows[0];
    if (!target || target.status !== 'ACTIVE' || target.role === 'ADMIN') throw fail(400, '활성 상태의 직원만 배정할 수 있습니다.');

    const assignmentId = newId('asg');

    // Self Assign: instantly confirmed, but overlapping time must be explicitly acknowledged.
    if (employeeId === user.id) {
      const check = await serverConflicts(q, user.id, projectId);
      if (check.hasConflict && !confirmOverlap) {
        throw fail(409, '다른 확정 프로젝트와 시간이 겹칩니다. 경고 확인 후 투입을 확정할 수 있습니다.', {
          needConfirmation: true,
          conflicts: check.conflicts,
        });
      }
      await insertAssignment(q, { id: assignmentId, projectId, employeeId, assignedBy: user.id, type: 'SELF', status: 'APPROVED' });
      await recordAllowedOverlaps(q, user.id, check.conflicts, 'SELF_ASSIGN', assignmentId); // from server-computed conflicts
      await logAudit(q, user, 'SELF_ASSIGN', 'ASSIGNMENT', assignmentId, `[${proj.name}] 셀프 투입 확정`);
      return assignmentView(q, assignmentId);
    }

    const isApproverTarget = target.role === 'APPROVER';
    await insertAssignment(q, {
      id: assignmentId,
      projectId,
      employeeId,
      assignedBy: user.id,
      type: isApproverTarget ? 'APPROVER' : 'EMPLOYEE',
      status: 'EMPLOYEE_PENDING',
    });
    if (!isApproverTarget) {
      for (const a of await activeApprovers(q)) {
        await q.query(`INSERT INTO approval_decisions (id, assignment_id, approver_id, decision) VALUES ($1,$2,$3,'PENDING')`, [newId('dec'), assignmentId, a.id]);
      }
    }

    await notify(c, employeeId, 'ASSIGNED', '프로젝트 배정 요청', `${user.name}님이 [${proj.name}] 프로젝트에 배정하였습니다. 수락 여부를 결정해 주세요.`, 'inbox');
    await logAudit(q, user, isApproverTarget ? 'ASSIGN_APPROVER' : 'ASSIGN_EMPLOYEE', 'ASSIGNMENT', assignmentId, `[${proj.name}]에 ${isApproverTarget ? '허가권자' : '일반 직원'} ${target.name} 배정`);
    return assignmentView(q, assignmentId);
  }).catch((e) => {
    // The partial unique index is the last line of defence against a duplicate live assignment.
    if (isUniqueViolation(e)) throw fail(409, '이미 해당 프로젝트에 배정(또는 진행 중)인 직원입니다.');
    throw e;
  });
  res.json({ success: true, assignment });
}));

async function insertAssignment(
  q: Queryable,
  a: { id: string; projectId: string; employeeId: string; assignedBy: string; type: string; status: string }
) {
  await q.query(`INSERT INTO assignments (id, project_id, employee_id, assigned_by, type, status) VALUES ($1,$2,$3,$4,$5,$6)`, [
    a.id,
    a.projectId,
    a.employeeId,
    a.assignedBy,
    a.type,
    a.status,
  ]);
}

// 11. Assignments: Respond (Accept / Decline)
app.post('/api/assignments/:id/response', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  const { accept, declineReason } = req.body ?? {};

  const assignment = await transact(async (c) => {
    const { q } = c;
    const peek = await getAssignment(q, req.params.id);
    if (peek.employee_id !== user.id) throw fail(403, '본인에게 할당된 배정만 수락/거절할 수 있습니다.');

    await lockProject(q, peek.project_id, 'SHARE');
    await lockEmployees(q, [peek.employee_id]);
    const asg = await getAssignment(q, req.params.id, true);
    if (asg.status !== 'EMPLOYEE_PENDING') throw fail(409, '수락 대기 상태의 배정만 응답할 수 있습니다.');
    const proj = await getProject(q, asg.project_id);

    if (!accept) {
      const reason = typeof declineReason === 'string' && declineReason.trim() ? declineReason.trim().slice(0, 500) : '개인 사정으로 인한 거절';
      await q.query(`UPDATE assignments SET status='DECLINED', decline_reason=$2, updated_at=now() WHERE id=$1`, [asg.id, reason]);
      await notify(c, asg.assigned_by, 'DECLINED', '배정 거절 알림', `${user.name}님이 [${proj.name}] 배정을 거절하였습니다. 사유: ${reason}`, 'projects');
      await logAudit(q, user, 'DECLINE_ASSIGNMENT', 'ASSIGNMENT', asg.id, `직원 ${user.name} 배정 거절`);
      return assignmentView(q, asg.id);
    }

    // Accepted: approver-to-approver assignments are confirmed immediately, but never silently over a conflict.
    if (asg.type === 'APPROVER') {
      const check = await serverConflicts(q, asg.employee_id, asg.project_id);
      if (check.hasConflict && !req.body?.confirmOverlap) {
        throw fail(409, '다른 확정 프로젝트와 시간이 겹칩니다. 겹침을 확인한 뒤 수락하세요.', { needConfirmation: true, conflicts: check.conflicts });
      }
      await q.query(`UPDATE assignments SET status='APPROVED', updated_at=now() WHERE id=$1`, [asg.id]);
      await recordAllowedOverlaps(q, asg.employee_id, check.conflicts, 'APPROVER_ACCEPT', asg.id);
      await notify(c, asg.assigned_by, 'ACCEPTED', '배정 수락 및 최종 확정', `허가권자 ${user.name}님이 [${proj.name}] 배정을 수락하여 참여가 최종 확정되었습니다.`, 'calendar');
      await logAudit(q, user, 'APPROVER_ACCEPT', 'ASSIGNMENT', asg.id, `허가권자 ${user.name} 수락으로 [${proj.name}] 확정`);
      return assignmentView(q, asg.id);
    }

    // General employee: move to the all-approver approval stage.
    await q.query(`UPDATE assignments SET status='APPROVAL_PENDING', updated_at=now() WHERE id=$1`, [asg.id]);
    const decs = (await q.query(`SELECT approver_id FROM approval_decisions WHERE assignment_id = $1`, [asg.id])).rows;
    for (const d of decs) {
      await notify(c, d.approver_id, 'APPROVAL_REQUEST', '배정 승인 요청', `[${proj.name}]에 ${user.name} 직원이 배정을 수락하여 허가권자 승인이 필요합니다.`, 'inbox');
    }
    await logAudit(q, user, 'EMPLOYEE_ACCEPT', 'ASSIGNMENT', asg.id, `직원 ${user.name} 수락으로 허가권자 전원 승인 대기`);
    return assignmentView(q, asg.id);
  });
  res.json({ success: true, assignment });
}));

// 12. Assignments: Approver Decision (Approve / Reject)
app.post('/api/assignments/:id/decision', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  if (user.role !== 'APPROVER') throw fail(403, '허가권자만 승인 또는 반려할 수 있습니다.');
  const { decision, comment } = req.body ?? {};
  if (decision !== 'APPROVED' && decision !== 'REJECTED') throw fail(400, '결정 값이 올바르지 않습니다.');
  const note = typeof comment === 'string' ? comment.trim().slice(0, 500) : '';

  const assignment = await transact(async (c) => {
    const { q } = c;
    const peek = await getAssignment(q, req.params.id);
    await lockProject(q, peek.project_id, 'SHARE');
    await lockEmployees(q, [peek.employee_id]);
    const asg = await getAssignment(q, req.params.id, true);
    if (asg.status !== 'APPROVAL_PENDING') throw fail(409, '승인 대기 상태의 배정만 승인/반려할 수 있습니다.');

    const my = (await q.query(`SELECT * FROM approval_decisions WHERE assignment_id = $1 AND approver_id = $2 FOR UPDATE`, [asg.id, user.id])).rows[0];
    if (!my) throw fail(403, '이 배정의 승인 대상 허가권자가 아닙니다.');
    if (my.decision !== 'PENDING') throw fail(409, '이미 결정을 내린 건입니다.');

    const proj = await getProject(q, asg.project_id);
    const target = (await q.query(`SELECT name FROM users WHERE id = $1`, [asg.employee_id])).rows[0];

    if (decision === 'REJECTED') {
      if (!note) throw fail(400, '반려 시에는 반려 사유를 필수로 입력해야 합니다.');
      await q.query(`UPDATE assignments SET status='REJECTED', decline_reason=$2, updated_at=now() WHERE id=$1`, [asg.id, `허가권자 ${user.name} 반려: ${note}`]);
      await q.query(`UPDATE approval_decisions SET decision='REJECTED', comment=$2, decided_at=now() WHERE id=$1`, [my.id, note]);
      await notify(c, asg.employee_id, 'REJECTED', '프로젝트 배정 반려', `[${proj.name}] 배정 건이 ${user.name} 부서장에 의해 반려되었습니다. 사유: ${note}`, 'inbox');
      await logAudit(q, user, 'REJECT_ASSIGNMENT', 'ASSIGNMENT', asg.id, `${target?.name} 배정 반려 (사유: ${note})`);
      return assignmentView(q, asg.id);
    }

    // Approval is blocked while the employee still has an unresolved time conflict.
    const check = await serverConflicts(q, asg.employee_id, asg.project_id);
    if (check.hasConflict) {
      throw fail(409, '직원의 다른 확정 프로젝트와 시간이 겹쳐 승인할 수 없습니다. 반려하거나 일정 조정 후 다시 시도하세요.', { conflicts: check.conflicts });
    }

    await q.query(`UPDATE approval_decisions SET decision='APPROVED', comment=$2, decided_at=now() WHERE id=$1`, [my.id, note || null]);
    const open = (await q.query(`SELECT count(*)::int AS n FROM approval_decisions WHERE assignment_id = $1 AND decision <> 'APPROVED'`, [asg.id])).rows[0].n;
    if (open === 0) {
      await q.query(`UPDATE assignments SET status='APPROVED', updated_at=now() WHERE id=$1`, [asg.id]);
      await notify(c, asg.employee_id, 'APPROVED', '프로젝트 참여 확정!', `[${proj.name}] 프로젝트 배정이 허가권자 전원의 승인을 받아 최종 확정되었습니다!`, 'calendar');
      await logAudit(q, user, 'FINAL_APPROVE_ASSIGNMENT', 'ASSIGNMENT', asg.id, `전원 승인 달성으로 ${target?.name} 참여 최종 확정`);
    } else {
      await logAudit(q, user, 'APPROVE_ASSIGNMENT', 'ASSIGNMENT', asg.id, `허가권자 ${user.name} 승인 완료 (타 허가권자 대기)`);
    }
    return assignmentView(q, asg.id);
  });
  res.json({ success: true, assignment });
}));

// 13. Assignments: Withdraw (before confirmation)
app.post('/api/assignments/:id/withdraw', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  await transact(async (c) => {
    const { q } = c;
    const asg = await getAssignment(q, req.params.id, true);
    const proj = await getProject(q, asg.project_id);
    if (proj.createdBy !== user.id) throw fail(403, '등록한 허가권자만 배정을 취소할 수 있습니다.');
    if (asg.status !== 'EMPLOYEE_PENDING' && asg.status !== 'APPROVAL_PENDING') throw fail(409, '확정 전(대기 중)인 배정만 철회할 수 있습니다.');

    await q.query(`UPDATE assignments SET status='WITHDRAWN', updated_at=now() WHERE id=$1`, [asg.id]);
    await notify(c, asg.employee_id, 'WITHDRAWN', '배정 철회', `[${proj.name}] 배정이 ${user.name}님에 의해 철회되었습니다.`, 'inbox');
    await logAudit(q, user, 'WITHDRAW_ASSIGNMENT', 'ASSIGNMENT', asg.id, `[${proj.name}] 배정 철회`);
  });
  res.json({ success: true });
}));

// 14. Assignments: Release (after confirmation)
app.post('/api/assignments/:id/release', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  await transact(async (c) => {
    const { q } = c;
    const asg = await getAssignment(q, req.params.id, true);
    const proj = await getProject(q, asg.project_id);
    if (proj.createdBy !== user.id) throw fail(403, '등록한 허가권자만 참여를 해제할 수 있습니다.');
    if (asg.status !== 'APPROVED') throw fail(409, '확정된 참여만 해제할 수 있습니다.');

    await q.query(`UPDATE assignments SET status='RELEASED', updated_at=now() WHERE id=$1`, [asg.id]);
    await notify(c, asg.employee_id, 'RELEASED', '참여 해제', `[${proj.name}] 참여가 ${user.name}님에 의해 해제되었습니다.`, 'calendar');
    await logAudit(q, user, 'RELEASE_ASSIGNMENT', 'ASSIGNMENT', asg.id, `[${proj.name}]에서 참여 해제`);
  });
  res.json({ success: true });
}));

// -------------------------------------------------------------
// Schedule changes & change requests
//
// A change request is a decision about a *specific* situation: the schedule as it was, and the conflicts the
// approvers were shown. Before it is approved (and again right before it is applied) the server checks that
// this situation still holds; otherwise the request is closed instead of silently overwriting newer state.
// -------------------------------------------------------------
type CloseReason = 'BASE_CHANGED' | 'NEW_CONFLICT' | 'PROJECT_CLOSED' | 'OWNER_CHANGED' | 'REQUESTER_INACTIVE' | 'WITHDRAWN_BY_REQUESTER';

const CLOSE_MESSAGES: Record<CloseReason, string> = {
  BASE_CHANGED: '요청 이후 프로젝트 일정이 바뀌어 요청이 무효화되었습니다. 다시 요청해 주세요.',
  NEW_CONFLICT: '요청 이후 승인받지 않은 새로운 시간 겹침이 생겨 요청이 무효화되었습니다. 다시 요청해 주세요.',
  PROJECT_CLOSED: '프로젝트가 취소되었거나 종료되어 요청이 무효화되었습니다.',
  OWNER_CHANGED: '프로젝트 등록자가 바뀌어 요청이 무효화되었습니다.',
  REQUESTER_INACTIVE: '요청자가 더 이상 허가권자가 아니거나 비활성화되어 요청이 무효화되었습니다.',
  WITHDRAWN_BY_REQUESTER: '요청자가 변경 요청을 철회했습니다.',
};

/** Fingerprint of everything a schedule change is based on: the project's date range and its sessions (ids excluded). */
async function scheduleFingerprint(q: Queryable, projectId: string): Promise<string> {
  const p = (await q.query(`SELECT start_date, end_date FROM projects WHERE id = $1`, [projectId])).rows[0];
  const s = (
    await q.query(
      `SELECT title, start_at, end_at, rrule, days_of_week, start_time, end_time, timezone FROM sessions WHERE project_id = $1 ORDER BY position`,
      [projectId]
    )
  ).rows;
  return sha256(JSON.stringify([p?.start_date, p?.end_date, s]));
}

async function activeParticipants(q: Queryable, projectId: string): Promise<string[]> {
  return (
    await q.query(`SELECT DISTINCT employee_id FROM assignments WHERE project_id = $1 AND status = ANY($2::text[]) ORDER BY employee_id`, [projectId, ACTIVE_ASSIGNMENT_STATUSES])
  ).rows.map((r) => r.employee_id as string);
}

/** Identifies one conflict between an employee, another project and two concrete time slots. */
const conflictKey = (employeeId: string, c: any) =>
  [
    employeeId,
    c.conflictingProject.id,
    `${c.targetSession.dateStr} ${c.targetSession.startTime}-${c.targetSession.endTime}`,
    `${c.conflictingSession.dateStr} ${c.conflictingSession.startTime}-${c.conflictingSession.endTime}`,
  ].join('|');

/**
 * Conflicts that the proposed schedule would create with projects owned by *other* approvers. Those are the ones
 * that need the other approver's approval and the employee's consent. Conflicts with the requester's own projects,
 * or involving the requester personally, only need a warning acknowledgement (handled in the client).
 * Participants must already be locked by the caller.
 */
async function crossOwnerConflicts(q: Queryable, projectId: string, requesterId: string, proposed: SessionInput[], participants: string[]) {
  const out: { employeeId: string; conflict: any }[] = [];
  for (const employeeId of participants) {
    const check = await serverConflicts(q, employeeId, projectId, proposed);
    for (const conflict of check.conflicts) {
      if (conflict.conflictingProject.createdBy === requesterId || employeeId === requesterId) continue;
      out.push({ employeeId, conflict });
    }
  }
  return out;
}

/** Why a pending change request can no longer be applied as approved, or null when it still holds. */
async function findStaleReason(q: Queryable, cr: any): Promise<CloseReason | null> {
  const proj = (await q.query(`SELECT * FROM projects WHERE id = $1`, [cr.project_id])).rows[0];
  if (!proj || proj.status === 'CANCELLED' || proj.status === 'COMPLETED') return 'PROJECT_CLOSED';
  if (proj.created_by !== cr.requested_by) return 'OWNER_CHANGED';
  const requester = (await q.query(`SELECT role, status FROM users WHERE id = $1`, [cr.requested_by])).rows[0];
  if (!requester || requester.status !== 'ACTIVE' || requester.role !== 'APPROVER') return 'REQUESTER_INACTIVE';
  // NULL on requests created before re-validation existed: nothing to compare, the conflict check below still applies.
  if (cr.base_hash && cr.base_hash !== (await scheduleFingerprint(q, cr.project_id))) return 'BASE_CHANGED';

  // Every conflict that exists now must be one the approvers have been shown ('*' = stored without employee id).
  const shown = new Set<string>((cr.conflicts as any[]).map((c) => conflictKey(c.employeeId ?? '*', c)));
  const participants = await activeParticipants(q, cr.project_id);
  for (const { employeeId, conflict } of await crossOwnerConflicts(q, cr.project_id, cr.requested_by, cr.proposed_sessions, participants)) {
    if (!shown.has(conflictKey(employeeId, conflict)) && !shown.has(conflictKey('*', conflict))) return 'NEW_CONFLICT';
  }
  return null;
}

/** Closes a pending request without a decision and tells everyone who was involved. */
async function closeChangeRequest(c: Ctx, cr: any, projectName: string, reason: CloseReason, actor: Pick<UserRecord, 'id' | 'name'>) {
  await c.q.query(`UPDATE change_requests SET status = 'CHANGE_WITHDRAWN', closed_reason = $2, closed_at = now() WHERE id = $1`, [cr.id, reason]);
  const decs = (await c.q.query(`SELECT actor_id FROM change_decisions WHERE change_request_id = $1`, [cr.id])).rows;
  const recipients = new Set<string>([cr.requested_by, ...decs.map((d) => d.actor_id as string)]);
  recipients.delete(actor.id);
  for (const r of recipients) {
    await notify(c, r, 'CHANGE_CLOSED', '일정 변경 요청 종료', `[${projectName}] ${CLOSE_MESSAGES[reason]}`, 'inbox');
  }
  await logAudit(c.q, actor, reason === 'WITHDRAWN_BY_REQUESTER' ? 'WITHDRAW_CHANGE_REQUEST' : 'CLOSE_CHANGE_REQUEST_STALE', 'CHANGE_REQUEST', cr.id, `[${projectName}] 일정 변경 요청 종료 (${reason})`);
}

// 15. Schedule Sessions & Change Requests
app.put('/api/projects/:id/sessions', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  const s = sanitizeSessions(req.body?.sessions);
  if (s.error) throw fail(400, s.error);
  const proposed = s.sessions!;

  const result = await transact(async (c) => {
    const { q } = c;
    const proj = await getProject(q, req.params.id, 'UPDATE');
    if (proj.createdBy !== user.id) throw fail(403, '자신이 등록한 프로젝트의 일정만 수정할 수 있습니다.');

    const participants = await activeParticipants(q, proj.id);
    await lockEmployees(q, participants);

    // Only one request at a time: a second one would be based on a schedule that is about to change.
    // A pending request that is no longer valid is closed automatically so it never blocks anyone.
    const pending = (await q.query(`SELECT * FROM change_requests WHERE project_id = $1 AND status = 'CHANGE_PENDING' FOR UPDATE`, [proj.id])).rows[0];
    if (pending) {
      const stale = await findStaleReason(q, pending);
      if (!stale) throw fail(409, '이미 진행 중인 일정 변경 요청이 있습니다. 처리 결과를 기다리거나 요청을 철회한 뒤 다시 시도하세요.', { pendingRequestId: pending.id });
      await closeChangeRequest(c, pending, proj.name, stale, user);
    }

    // Server-side decision on whether the change touches anyone else's schedule: `directApply` is never trusted.
    const found = await crossOwnerConflicts(q, proj.id, user.id, proposed, participants);

    if (found.length === 0) {
      await replaceSessions(q, proj.id, proposed);
      await logAudit(q, user, 'UPDATE_SESSIONS_DIRECT', 'SESSION', proj.id, `[${proj.name}] 일정 변경 반영`);
      return { appliedDirectly: true as const };
    }

    // Another approver's project overlaps: a change request with approval + consent is mandatory.
    const decisions: { id: string; actorId: string; kind: 'APPROVAL' | 'CONSENT' | 'BOTH' }[] = [];
    for (const { employeeId, conflict } of found) {
      const ownerId = conflict.conflictingProject.createdBy;
      if (!decisions.some((d) => d.actorId === ownerId)) decisions.push({ id: newId('cd'), actorId: ownerId, kind: 'APPROVAL' });
      const empDec = decisions.find((d) => d.actorId === employeeId);
      if (empDec) {
        if (empDec.kind === 'APPROVAL') empDec.kind = 'BOTH';
      } else {
        decisions.push({ id: newId('cd'), actorId: employeeId, kind: 'CONSENT' });
      }
    }

    const requestId = newId('cr');
    await q.query(
      `INSERT INTO change_requests (id, project_id, requested_by, proposed_sessions, conflicts, status, base_hash) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'CHANGE_PENDING',$6)`,
      [
        requestId,
        proj.id,
        user.id,
        JSON.stringify(proposed),
        JSON.stringify(found.map((f) => ({ ...f.conflict, employeeId: f.employeeId }))),
        await scheduleFingerprint(q, proj.id),
      ]
    );
    for (const d of decisions) {
      await q.query(`INSERT INTO change_decisions (id, change_request_id, actor_id, kind, decision) VALUES ($1,$2,$3,$4,'PENDING')`, [d.id, requestId, d.actorId, d.kind]);
      await notify(c, d.actorId, 'CHANGE_REQUEST', '일정 변경 승인/동의 요청', `[${proj.name}] 일정 변경에 대한 ${d.kind === 'CONSENT' ? '동의' : '승인'}가 필요합니다.`, 'inbox');
    }
    await logAudit(q, user, 'CREATE_CHANGE_REQUEST', 'CHANGE_REQUEST', requestId, `[${proj.name}] 일정 변경 요청 생성`);

    const cr = (await q.query(`SELECT * FROM change_requests WHERE id = $1`, [requestId])).rows[0];
    const cds = (await q.query(`SELECT * FROM change_decisions WHERE change_request_id = $1 ORDER BY id`, [requestId])).rows;
    return { appliedDirectly: false as const, changeRequest: mapChangeRequest(cr, cds) };
  }).catch((e) => {
    if (isUniqueViolation(e)) throw fail(409, '이미 진행 중인 일정 변경 요청이 있습니다. 처리 결과를 기다리거나 요청을 철회한 뒤 다시 시도하세요.');
    throw e;
  });
  res.json({ success: true, ...result });
}));

// 16. Change Request Decision
app.post('/api/change-requests/:id/decision', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  const { decision, comment } = req.body ?? {};
  if (decision !== 'APPROVED' && decision !== 'REJECTED') throw fail(400, '결정 값이 올바르지 않습니다.');
  const note = typeof comment === 'string' ? comment.trim().slice(0, 500) : '';

  const result = await transact(async (c) => {
    const { q } = c;
    const crPeek = (await q.query(`SELECT project_id FROM change_requests WHERE id = $1`, [req.params.id])).rows[0];
    if (!crPeek) throw fail(404, '요청을 찾을 수 없습니다.');
    const proj = await getProject(q, crPeek.project_id, 'UPDATE');
    // Same lock order as everywhere else: project first, then the employees whose schedules are affected.
    await lockEmployees(q, await activeParticipants(q, proj.id));

    const cr = (await q.query(`SELECT * FROM change_requests WHERE id = $1 FOR UPDATE`, [req.params.id])).rows[0];
    if (cr.status !== 'CHANGE_PENDING') throw fail(409, '진행 중인 변경 요청이 아닙니다.', { closedReason: cr.closed_reason ?? undefined });

    const my = (await q.query(`SELECT * FROM change_decisions WHERE change_request_id = $1 AND actor_id = $2 FOR UPDATE`, [cr.id, user.id])).rows[0];
    if (!my) throw fail(403, '본인에게 할당된 승인/동의 요청이 아닙니다.');
    if (my.decision !== 'PENDING') throw fail(409, '이미 결정을 내린 건입니다.');

    if (decision === 'REJECTED') {
      await q.query(`UPDATE change_decisions SET decision='REJECTED', comment=$2, decided_at=now() WHERE id=$1`, [my.id, note]);
      await q.query(`UPDATE change_requests SET status='CHANGE_REJECTED' WHERE id=$1`, [cr.id]);
      await notify(c, cr.requested_by, 'CHANGE_REJECTED', '일정 변경 반려', `일정 변경 요청이 ${user.name}님에 의해 반려되었습니다.`, 'inbox');
      await logAudit(q, user, 'REJECT_CHANGE_REQUEST', 'CHANGE_REQUEST', cr.id, `일정 변경 반려 (사유: ${note || '미입력'})`);
      return { stale: false as const };
    }

    // Approving something that no longer holds would be a decision about a situation that no longer exists.
    const stale = await findStaleReason(q, cr);
    if (stale) {
      await closeChangeRequest(c, cr, proj.name, stale, user);
      return { stale: true as const, reason: stale };
    }

    await q.query(`UPDATE change_decisions SET decision='APPROVED', comment=$2, decided_at=now() WHERE id=$1`, [my.id, note]);
    const open = (await q.query(`SELECT count(*)::int AS n FROM change_decisions WHERE change_request_id = $1 AND decision <> 'APPROVED'`, [cr.id])).rows[0].n;
    if (open > 0) return { stale: false as const, allApproved: false };

    // Everyone agreed and everything was just re-validated under the same locks: apply the proposed schedule.
    await replaceSessions(q, cr.project_id, cr.proposed_sessions as SessionInput[]);
    await q.query(`UPDATE change_requests SET status='CHANGE_APPROVED' WHERE id=$1`, [cr.id]);
    await notify(c, cr.requested_by, 'CHANGE_APPROVED', '일정 변경 승인', '일정 변경 요청이 최종 승인되어 캘린더에 반영되었습니다.', 'calendar');
    await logAudit(q, user, 'APPROVE_CHANGE_REQUEST_FINAL', 'CHANGE_REQUEST', cr.id, '일정 변경 최종 승인 및 캘린더 반영');
    return { stale: false as const, allApproved: true };
  });

  // The request was closed (and everybody notified) in the transaction above; tell the caller why nothing was approved.
  if (result.stale) throw fail(409, CLOSE_MESSAGES[result.reason], { stale: true, closedReason: result.reason });
  res.json({ success: true, allApproved: (result as any).allApproved });
}));

// 16-b. Change Request Withdraw (by the requester, while pending)
app.post('/api/change-requests/:id/withdraw', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  await transact(async (c) => {
    const { q } = c;
    const crPeek = (await q.query(`SELECT project_id FROM change_requests WHERE id = $1`, [req.params.id])).rows[0];
    if (!crPeek) throw fail(404, '요청을 찾을 수 없습니다.');
    const proj = await getProject(q, crPeek.project_id, 'UPDATE');
    const cr = (await q.query(`SELECT * FROM change_requests WHERE id = $1 FOR UPDATE`, [req.params.id])).rows[0];
    if (cr.requested_by !== user.id) throw fail(403, '요청한 허가권자만 철회할 수 있습니다.');
    if (cr.status !== 'CHANGE_PENDING') throw fail(409, '진행 중인 변경 요청만 철회할 수 있습니다.');
    await closeChangeRequest(c, cr, proj.name, 'WITHDRAWN_BY_REQUESTER', user);
  });
  res.json({ success: true });
}));

// 17. Admin: Create Employee Account (invitation flow; no shared initial password)
app.post('/api/admin/employees', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') throw fail(403, '시스템 관리자만 계정을 발급할 수 있습니다.');

  const name = cleanStr(req.body?.name, 60);
  const email = cleanStr(req.body?.email, 200)?.toLowerCase();
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, '이름과 올바른 이메일을 입력하세요.');
  const departmentId = req.body?.departmentId;
  const role = req.body?.role === 'APPROVER' || req.body?.role === 'ADMIN' ? req.body.role : 'EMPLOYEE';

  const salt = generateSalt();
  // Random, unknown password: the account only becomes usable through the invitation link.
  const hash = await hashPassword(crypto.randomBytes(32).toString('hex'), salt);
  const id = newId('emp');

  await transact(async ({ q }) => {
    const dept = await q.query(`SELECT id FROM departments WHERE id = $1`, [departmentId]);
    if (typeof departmentId !== 'string' || dept.rows.length === 0) throw fail(400, '존재하지 않는 부서입니다.');
    await q.query(
      `INSERT INTO users (id, email, name, department_id, role, status, timezone, avatar_color, password_salt, password_hash, password_iter)
       VALUES ($1,$2,$3,$4,$5,'INVITED','Asia/Seoul','bg-emerald-600',$6,$7,$8)`,
      [id, email, name, departmentId, role, salt, hash, PBKDF2_ITER]
    );
    await logAudit(q, user, 'CREATE_EMPLOYEE', 'EMPLOYEE', id, `신규 직원 [${name} (${email})] 계정 생성`);
  }).catch((e) => {
    if (isUniqueViolation(e)) throw fail(400, '이미 존재하는 이메일 계정입니다.');
    throw e;
  });

  const { link, delivery } = await issueResetToken({ id, name, email }, 72 * 60, 'invite');
  await logAudit(db, user, delivery.ok ? 'INVITE_SENT' : 'INVITE_DELIVERY_FAILED', 'EMPLOYEE', id, `[${name}] 초대 ${delivery.ok ? `발송 (${delivery.channel})` : '발송 실패 - 관리자가 링크를 직접 전달해야 함'}`);

  const created = mapUser((await db.query(`SELECT * FROM users WHERE id = $1`, [id])).rows[0]);
  res.json({
    success: true,
    employee: publicUser(created, user),
    delivered: delivery.ok,
    deliveryError: delivery.ok ? undefined : delivery.error,
    // Only when automatic delivery failed: lets the administrator pass the link on personally.
    inviteLink: delivery.ok ? undefined : link,
  });
}));

// 17-b. Admin: (Re)send an invitation or password-reset link
app.post('/api/admin/employees/:id/invite', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') throw fail(403, '시스템 관리자만 사용할 수 있습니다.');
  const found = await db.query(`SELECT * FROM users WHERE id = $1`, [req.params.id]);
  if (!found.rows[0]) throw fail(404, '직원을 찾을 수 없습니다.');
  const target = mapUser(found.rows[0]);
  if (target.status === 'DISABLED') throw fail(400, '비활성화된 계정입니다.');

  const kind = target.status === 'INVITED' ? 'invite' : 'reset';
  const { link, delivery } = await issueResetToken(target, kind === 'invite' ? 72 * 60 : 30, kind);
  await logAudit(
    db,
    user,
    kind === 'invite' ? 'RESEND_INVITE' : 'ADMIN_RESET_LINK',
    'EMPLOYEE',
    target.id,
    `[${target.name}] ${kind === 'invite' ? '초대' : '비밀번호 재설정'} 링크 발급 (${delivery.ok ? delivery.channel : '자동 발송 실패 - 수동 전달'})`
  );
  res.json({
    success: true,
    delivered: delivery.ok,
    deliveryError: delivery.ok ? undefined : delivery.error,
    inviteLink: delivery.ok ? undefined : link,
  });
}));

// 18. Admin: Toggle Employee Status (Active / Disabled)
app.patch('/api/admin/employees/:id/status', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') throw fail(403, '시스템 관리자만 계정 상태를 변경할 수 있습니다.');

  const status = await transact(async ({ q }) => {
    const found = await q.query(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!found.rows[0]) throw fail(404, '직원을 찾을 수 없습니다.');
    const target = mapUser(found.rows[0]);
    if (target.id === user.id) throw fail(400, '본인 계정은 비활성화할 수 없습니다.');
    if (target.status === 'INVITED') throw fail(400, '아직 활성화되지 않은 초대 계정입니다.');

    const next = target.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    await q.query(`UPDATE users SET status = $2 WHERE id = $1`, [target.id, next]);
    if (next === 'DISABLED') await revokeSessions(q, target.id);
    await logAudit(q, user, 'TOGGLE_EMPLOYEE_STATUS', 'EMPLOYEE', target.id, `직원 [${target.name}] 상태 -> ${next}`);
    return next;
  });
  res.json({ success: true, status });
}));

// 19. Admin: Create Department
app.post('/api/admin/departments', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') throw fail(403, '관리자만 부서를 등록할 수 있습니다.');
  const name = cleanStr(req.body?.name, 60);
  if (!name) throw fail(400, '부서명을 입력하세요.');

  const id = newId('dept');
  await transact(async ({ q }) => {
    await q.query(`INSERT INTO departments (id, name) VALUES ($1,$2)`, [id, name]);
    await logAudit(q, user, 'CREATE_DEPARTMENT', 'DEPARTMENT', id, `부서 [${name}] 등록`);
  }).catch((e) => {
    if (isUniqueViolation(e)) throw fail(400, '이미 존재하는 부서명입니다.');
    throw e;
  });
  res.json({ success: true, department: { id, name, headEmployeeId: '' } });
}));

// 20. Admin: Update Department Head
app.patch('/api/admin/departments/:id/head', authMiddleware, route(async (req, res) => {
  const user = req.user!;
  if (user.role !== 'ADMIN') throw fail(403, '관리자만 부서장을 임명할 수 있습니다.');

  await transact(async ({ q }) => {
    const dept = (await q.query(`SELECT * FROM departments WHERE id = $1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!dept) throw fail(404, '부서를 찾을 수 없습니다.');

    const target = (await q.query(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [req.body?.headEmployeeId])).rows[0];
    if (!target || target.status !== 'ACTIVE' || target.role === 'ADMIN') throw fail(400, '활성 상태의 직원만 부서장으로 임명할 수 있습니다.');

    const previousHeadId: string | null = dept.head_employee_id;
    await q.query(`UPDATE departments SET head_employee_id = $2 WHERE id = $1`, [dept.id, target.id]);
    await q.query(`UPDATE users SET role = 'APPROVER' WHERE id = $1`, [target.id]);

    // Demote the previous head unless they still head another department.
    if (previousHeadId && previousHeadId !== target.id) {
      const still = await q.query(`SELECT 1 FROM departments WHERE head_employee_id = $1`, [previousHeadId]);
      if (still.rows.length === 0) await q.query(`UPDATE users SET role = 'EMPLOYEE' WHERE id = $1 AND role = 'APPROVER'`, [previousHeadId]);
    }
    await logAudit(q, user, 'UPDATE_DEPT_HEAD', 'DEPARTMENT', dept.id, `[${dept.name}] 부서장 -> ${target.name}`);
  });
  res.json({ success: true });
}));

// -------------------------------------------------------------
// Vite Integration & Server Startup
// -------------------------------------------------------------
async function startServer() {
  db = await openDb(DATA_DIR);
  await migrate(db);

  const users = (await db.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n;
  if (users === 0 && fs.existsSync(path.join(DATA_DIR, 'database.json'))) {
    console.warn(
      `[db] ${path.join(DATA_DIR, 'database.json')} 가 있습니다. 기존 데이터를 옮기려면 서버를 시작하기 전에 \`npm run db:import\` 를 먼저 실행하세요. (그대로 시작하면 빈 데이터베이스로 시작합니다)`
    );
  }
  if (db.kind === 'embedded' && isProduction) {
    console.warn('[db] DATABASE_URL 이 없어 내장 PostgreSQL(단일 인스턴스 전용)을 사용합니다. 운영에서는 관리형 PostgreSQL(DATABASE_URL)을 권장합니다.');
  }

  await bootstrapAdmin();
  await verifySlack();

  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of rateBuckets) if (b.resetAt <= now) rateBuckets.delete(k);
    db.query(`DELETE FROM auth_tokens WHERE expires_at < now()`).catch((e) => console.error('[db] token purge failed:', e.message));
  }, 10 * 60_000).unref();

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

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ScheduleSync Pro Server] listening on http://0.0.0.0:${PORT} (env: ${process.env.NODE_ENV || 'dev'}, db: ${db.kind})`);
  });

  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} 수신, 종료합니다.`);
    server.close(() => db.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((e) => {
  console.error('[FATAL] 서버를 시작하지 못했습니다:', e);
  process.exit(1);
});
