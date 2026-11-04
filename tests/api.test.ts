/**
 * End-to-end API tests. Boots the real server as a child process against a throw-away data
 * directory and drives it over HTTP. Invitation / reset mails are read from the dev console log.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { prepareDatabase, TestDb } from './helpers';

const PORT = 3200 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'admin@test.local', password: 'Admin12345' };
let server: ChildProcess;
let logBuf = '';
let testDb: TestDb;

async function call(method: string, url: string, token?: string | null, body?: unknown) {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j: any = {};
  try {
    j = await r.json();
  } catch {}
  return { s: r.status, j };
}

function mailToken(email: string): string {
  const re = new RegExp(`to=${email.replace(/\./g, '\\.')}[\\s\\S]*?토큰: ([0-9a-f]{64})`, 'g');
  let m: RegExpExecArray | null;
  let last: string | undefined;
  while ((m = re.exec(logBuf))) last = m[1];
  assert.ok(last, `no mail token for ${email}`);
  return last!;
}

before(async () => {
  testDb = await prepareDatabase('api');
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      ...testDb.env,
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      APP_URL: 'http://app.test',
      SMTP_HOST: '',
    },
  });
  server.stdout!.on('data', (d) => (logBuf += d));
  server.stderr!.on('data', (d) => (logBuf += d));
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(BASE + '/api/auth/me');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('server did not start:\n' + logBuf);
});

after(async () => {
  server?.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  await testDb?.cleanup();
});

// shared fixtures, filled by the first test
const tok: Record<string, string> = {};
const id: Record<string, string> = {};
let admin = '';
let dept1 = '';
let dept2 = '';

test('login errors are generic and the demo reset endpoint is gone', async () => {
  assert.equal((await call('POST', '/api/auth/login', null, { email: ADMIN.email, password: 'wrong' })).s, 401);
  const unknown = await call('POST', '/api/auth/login', null, { email: 'nobody@test.local', password: 'wrong' });
  assert.equal(unknown.s, 401);
  assert.match(unknown.j.error, /올바르지/);
  const ok = await call('POST', '/api/auth/login', null, ADMIN);
  assert.equal(ok.s, 200);
  admin = ok.j.token;
  assert.equal((await call('POST', '/api/system/reset-demo', admin)).s, 404);
});

test('invitation flow: accounts are inactive until the one-time link is used', async () => {
  dept1 = (await call('GET', '/api/state', admin)).j.departments[0].id;
  dept2 = (await call('POST', '/api/admin/departments', admin, { name: '디자인' })).j.department.id;

  const people: [string, string, string, string][] = [
    ['A', 'a@test.local', 'APPROVER', dept1],
    ['B', 'b@test.local', 'APPROVER', dept2],
    ['E1', 'e1@test.local', 'EMPLOYEE', dept1],
    ['E2', 'e2@test.local', 'EMPLOYEE', dept2],
  ];
  for (const [name, email, role, departmentId] of people) {
    const c = await call('POST', '/api/admin/employees', admin, { name, email, role, departmentId });
    assert.equal(c.s, 200);
    assert.equal(c.j.employee.status, 'INVITED');
    assert.equal((await call('POST', '/api/auth/login', null, { email, password: 'Whatever12345' })).s, 401);

    const t = mailToken(email);
    const pw = `Passw0rd-${name}xx`;
    assert.equal((await call('POST', '/api/auth/password-reset-confirm', null, { token: t, newPassword: 'weak' })).s, 400);
    assert.equal((await call('POST', '/api/auth/password-reset-confirm', null, { token: t, newPassword: pw })).s, 200);
    assert.equal((await call('POST', '/api/auth/password-reset-confirm', null, { token: t, newPassword: pw + 'z' })).s, 400, 'token is single use');
    const l = await call('POST', '/api/auth/login', null, { email, password: pw });
    assert.equal(l.s, 200);
    tok[name] = l.j.token;
    id[name] = l.j.user.id;
  }
});

test('password reset never leaks the token or whether an address exists', async () => {
  const known = await call('POST', '/api/auth/password-reset-request', null, { email: 'e1@test.local' });
  const unknown = await call('POST', '/api/auth/password-reset-request', null, { email: 'ghost@test.local' });
  assert.equal(known.s, 200);
  assert.equal(known.j.token, undefined);
  assert.deepEqual(known.j, unknown.j);
});

test('state is scoped per role', async () => {
  const emp = await call('GET', '/api/state', tok.E1);
  assert.equal(emp.j.auditLogs.length, 0);
  assert.ok(emp.j.employees.every((e: any) => e.email === '' || e.id === id.E1));
  assert.equal(emp.j.mockEmails.length, 0);
  assert.equal(emp.j.notifications.length, 0);
  const raw = JSON.stringify(emp.j);
  assert.ok(!raw.includes('passwordHash') && !raw.includes('resetTokenHash'));
  assert.ok((await call('GET', '/api/state', admin)).j.auditLogs.length > 0);
});

const SESSION = { title: 's', daysOfWeek: [1], startTime: '10:00', endTime: '12:00', timezone: 'Asia/Seoul' };
let p1 = '';
let p2 = '';

test('projects: authorization, validation and no field spoofing', async () => {
  assert.equal((await call('PATCH', `/api/admin/departments/${dept1}/head`, admin, { headEmployeeId: id.A })).s, 200);
  assert.equal((await call('POST', '/api/projects', tok.E1, { project: { name: 'x' }, sessions: [] })).s, 403);
  const bad = await call('POST', '/api/projects', tok.A, { project: { name: 'P', startDate: '2026-12-31', endDate: '2026-11-01' }, sessions: [SESSION] });
  assert.equal(bad.s, 400);

  const c1 = await call('POST', '/api/projects', tok.A, {
    project: { name: 'P1', startDate: '2026-11-01', endDate: '2026-12-31', color: '#2563eb', createdBy: 'hack' },
    sessions: [SESSION],
  });
  assert.equal(c1.s, 200);
  assert.equal(c1.j.project.createdBy, id.A);
  p1 = c1.j.project.id;
  const c2 = await call('POST', '/api/projects', tok.B, {
    project: { name: 'P2', startDate: '2026-11-01', endDate: '2026-12-31', color: '#7c3aed' },
    sessions: [{ ...SESSION, startTime: '11:00', endTime: '13:00' }],
  });
  p2 = c2.j.project.id;
  const patch = await call('PATCH', `/api/projects/${p1}`, tok.A, { createdBy: id.B, name: 'P1b' });
  assert.equal(patch.j.project.createdBy, id.A);
});

test('assignment workflow: employee accepts, then every approver approves', async () => {
  const a = await call('POST', '/api/assignments', tok.A, { projectId: p1, employeeId: id.E1 });
  assert.equal(a.s, 200);
  const aid = a.j.assignment.id;
  assert.equal(a.j.assignment.approvalDecisions.length, 2);
  assert.equal((await call('POST', '/api/assignments', tok.A, { projectId: p1, employeeId: id.E1 })).s, 409, 'duplicate');
  assert.equal((await call('POST', `/api/assignments/${aid}/decision`, tok.A, { decision: 'APPROVED' })).s, 409, 'before accept');
  assert.equal((await call('POST', `/api/assignments/${aid}/response`, tok.E2, { accept: true })).s, 403);
  const acc = await call('POST', `/api/assignments/${aid}/response`, tok.E1, { accept: true });
  assert.equal(acc.j.assignment.status, 'APPROVAL_PENDING');
  assert.equal((await call('POST', `/api/assignments/${aid}/response`, tok.E1, { accept: true })).s, 409);
  assert.equal((await call('POST', `/api/assignments/${aid}/decision`, tok.E2, { decision: 'APPROVED' })).s, 403);
  const d1 = await call('POST', `/api/assignments/${aid}/decision`, tok.A, { decision: 'APPROVED' });
  assert.equal(d1.j.assignment.status, 'APPROVAL_PENDING');
  assert.equal((await call('POST', `/api/assignments/${aid}/decision`, tok.A, { decision: 'APPROVED' })).s, 409);
  const d2 = await call('POST', `/api/assignments/${aid}/decision`, tok.B, { decision: 'APPROVED' });
  assert.equal(d2.j.assignment.status, 'APPROVED');
});

test('server blocks approval when the employee has a time conflict', async () => {
  const a = await call('POST', '/api/assignments', tok.B, { projectId: p2, employeeId: id.E1 });
  const aid = a.j.assignment.id;
  await call('POST', `/api/assignments/${aid}/response`, tok.E1, { accept: true });
  const blocked = await call('POST', `/api/assignments/${aid}/decision`, tok.A, { decision: 'APPROVED' });
  assert.equal(blocked.s, 409);
  assert.ok(blocked.j.conflicts.length > 0);
  assert.equal((await call('POST', `/api/assignments/${aid}/decision`, tok.A, { decision: 'REJECTED' })).s, 400, 'reason required');
  const rej = await call('POST', `/api/assignments/${aid}/decision`, tok.A, { decision: 'REJECTED', comment: '겹침' });
  assert.equal(rej.j.assignment.status, 'REJECTED');
  assert.equal((await call('POST', `/api/assignments/${aid}/withdraw`, tok.B)).s, 409);
});

test('self-assign over a conflict needs explicit confirmation, recorded from server data', async () => {
  assert.equal((await call('POST', '/api/assignments', tok.B, { projectId: p2, employeeId: id.B })).s, 200);
  const p3 = (await call('POST', '/api/projects', tok.B, { project: { name: 'P3', startDate: '2026-11-01', endDate: '2026-12-31' }, sessions: [SESSION] })).j.project.id;
  const need = await call('POST', '/api/assignments', tok.B, { projectId: p3, employeeId: id.B });
  assert.equal(need.s, 409);
  assert.equal(need.j.needConfirmation, true);
  assert.equal((await call('POST', '/api/assignments', tok.B, { projectId: p3, employeeId: id.B, confirmOverlap: true, conflicts: [] })).s, 200);
  assert.ok((await call('GET', '/api/state', admin)).j.allowedOverlaps.length > 0);
});

test('disabling an account revokes its session; admins cannot disable themselves', async () => {
  assert.equal((await call('PATCH', `/api/admin/employees/${id.E2}/status`, admin)).j.status, 'DISABLED');
  assert.ok([401, 403].includes((await call('GET', '/api/state', tok.E2)).s));
  const me = (await call('GET', '/api/auth/me', admin)).j.user.id;
  assert.equal((await call('PATCH', `/api/admin/employees/${me}/status`, admin)).s, 400);
});

test('login is rate limited', async () => {
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await call('POST', '/api/auth/login', null, { email: 'e1@test.local', password: `nope${i}` })).s;
  assert.equal(last, 429);
});
