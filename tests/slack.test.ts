/**
 * Slack DM delivery. The real server runs against a local fake of the Slack Web API, so the
 * whole path (lookupByEmail -> chat.postMessage, escaping, fallbacks) is exercised end to end.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'admin@test.local', password: 'Admin12345' };
const IN_SLACK = new Set(['admin@test.local', 'a@test.local', 'e1@test.local', 'e2@test.local']);

interface Posted {
  channel: string;
  text: string;
  auth: string;
}
const posted: Posted[] = [];
let lookups: string[] = [];
let slackServer: http.Server;
let slackPort = 0;
let server: ChildProcess;
let dataDir: string;

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

const waitFor = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out waiting for condition');
};

const dmsTo = (email: string) => posted.filter((p) => p.channel === `U_${email.split('@')[0]}`);
const tokenIn = (text: string) => /토큰: ([0-9a-f]{64})/.exec(text)![1];

before(async () => {
  slackServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const auth = req.headers.authorization || '';
      const reply = (o: unknown) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(o));
      };
      if (auth !== 'Bearer xoxb-test') return reply({ ok: false, error: 'invalid_auth' });
      if (req.url === '/auth.test') return reply({ ok: true, team: 'T', user: 'bot' });
      if (req.url === '/users.lookupByEmail') {
        const email = new URLSearchParams(raw).get('email')!.toLowerCase();
        lookups.push(email);
        return IN_SLACK.has(email)
          ? reply({ ok: true, user: { id: `U_${email.split('@')[0]}` } })
          : reply({ ok: false, error: 'users_not_found' });
      }
      if (req.url === '/chat.postMessage') {
        const b = JSON.parse(raw);
        posted.push({ channel: b.channel, text: b.text, auth });
        return reply({ ok: true });
      }
      reply({ ok: false, error: 'unknown_method' });
    });
  });
  await new Promise<void>((r) => slackServer.listen(0, '127.0.0.1', r));
  slackPort = (slackServer.address() as any).port;

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedulesync-slack-'));
  let log = '';
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      DATA_DIR: dataDir,
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      APP_URL: 'http://app.test',
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_API_URL: `http://127.0.0.1:${slackPort}`,
      SMTP_HOST: '',
    },
  });
  server.stdout!.on('data', (d) => (log += d));
  server.stderr!.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(BASE + '/api/auth/me');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('server did not start:\n' + log);
});

after(() => {
  server?.kill('SIGTERM');
  slackServer?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

let admin = '';
let dept = '';
const tok: Record<string, string> = {};
const id: Record<string, string> = {};

test('invitation is delivered as a Slack DM, with Slack control characters escaped', async () => {
  admin = (await call('POST', '/api/auth/login', null, ADMIN)).j.token;
  dept = (await call('GET', '/api/state', admin)).j.departments[0].id;

  const c = await call('POST', '/api/admin/employees', admin, { name: '<!channel>김', email: 'a@test.local', role: 'APPROVER', departmentId: dept });
  assert.equal(c.s, 200);
  assert.equal(c.j.delivered, true);
  assert.equal(c.j.inviteLink, undefined, 'link is not returned when delivery worked');

  const dm = dmsTo('a@test.local');
  assert.equal(dm.length, 1);
  assert.equal(dm[0].auth, 'Bearer xoxb-test');
  assert.ok(!dm[0].text.includes('<!channel>'), 'mention injection must be neutralised');
  assert.ok(dm[0].text.includes('&lt;!channel&gt;'));
  assert.ok(dm[0].text.includes('http://app.test/?resetToken='));

  const act = await call('POST', '/api/auth/password-reset-confirm', null, { token: tokenIn(dm[0].text), newPassword: 'Passw0rd-Axx' });
  assert.equal(act.s, 200, 'token from the DM activates the account');
  const l = await call('POST', '/api/auth/login', null, { email: 'a@test.local', password: 'Passw0rd-Axx' });
  tok.A = l.j.token;
  id.A = l.j.user.id;
});

test('someone who is not in Slack: delivery fails and the admin receives a one-time link instead', async () => {
  const c = await call('POST', '/api/admin/employees', admin, { name: '외부', email: 'ghost@test.local', role: 'EMPLOYEE', departmentId: dept });
  assert.equal(c.s, 200);
  assert.equal(c.j.delivered, false);
  assert.match(c.j.deliveryError, /찾을 수 없음/);
  assert.ok(c.j.inviteLink.includes('?resetToken='));

  const token = new URL(c.j.inviteLink).searchParams.get('resetToken')!;
  assert.equal((await call('POST', '/api/auth/password-reset-confirm', null, { token, newPassword: 'Passw0rd-Gxx' })).s, 200);

  const logs = (await call('GET', '/api/state', admin)).j.auditLogs;
  assert.ok(logs.some((l: any) => l.action === 'CREATE_EMPLOYEE' && l.details.includes('발송 실패')));
});

test('resending an invitation issues a fresh link and invalidates the previous one', async () => {
  const c = await call('POST', '/api/admin/employees', admin, { name: '직원1', email: 'e1@test.local', role: 'EMPLOYEE', departmentId: dept });
  const first = tokenIn(dmsTo('e1@test.local')[0].text);
  assert.equal(c.j.delivered, true);

  const again = await call('POST', `/api/admin/employees/${c.j.employee.id}/invite`, admin);
  assert.equal(again.j.delivered, true);
  const second = tokenIn(dmsTo('e1@test.local')[1].text);
  assert.notEqual(first, second);
  assert.equal((await call('POST', '/api/auth/password-reset-confirm', null, { token: first, newPassword: 'Passw0rd-E1xx' })).s, 400);
  assert.equal((await call('POST', '/api/auth/password-reset-confirm', null, { token: second, newPassword: 'Passw0rd-E1xx' })).s, 200);
  const l = await call('POST', '/api/auth/login', null, { email: 'e1@test.local', password: 'Passw0rd-E1xx' });
  tok.E1 = l.j.token;
  id.E1 = l.j.user.id;

  assert.equal((await call('POST', `/api/admin/employees/${c.j.employee.id}/invite`, tok.A)).s, 403, 'admin only');
});

test('self-service password reset sends the link by DM and never returns it', async () => {
  const before = dmsTo('e1@test.local').length;
  const r = await call('POST', '/api/auth/password-reset-request', null, { email: 'e1@test.local' });
  assert.equal(r.s, 200);
  assert.equal(JSON.stringify(r.j).includes('resetToken'), false);
  await waitFor(() => dmsTo('e1@test.local').length > before);
  assert.match(dmsTo('e1@test.local').at(-1)!.text, /재설정/);

  // unknown address: identical response, nobody is contacted
  const lookupsBefore = lookups.length;
  const unknown = await call('POST', '/api/auth/password-reset-request', null, { email: 'nobody@test.local' });
  assert.deepEqual(unknown.j, r.j);
  assert.equal(lookups.length, lookupsBefore);
});

test('workflow events are mirrored to the recipient as Slack DMs', async () => {
  assert.equal((await call('PATCH', `/api/admin/departments/${dept}/head`, admin, { headEmployeeId: id.A })).s, 200);
  const p = await call('POST', '/api/projects', tok.A, {
    project: { name: '<!here>프로젝트', startDate: '2026-11-01', endDate: '2026-12-31', color: '#2563eb' },
    sessions: [{ title: 's', daysOfWeek: [1], startTime: '10:00', endTime: '12:00', timezone: 'Asia/Seoul' }],
  });
  const before = dmsTo('e1@test.local').length;
  const a = await call('POST', '/api/assignments', tok.A, { projectId: p.j.project.id, employeeId: id.E1 });
  assert.equal(a.s, 200);

  await waitFor(() => dmsTo('e1@test.local').length > before);
  const dm = dmsTo('e1@test.local').at(-1)!;
  assert.match(dm.text, /프로젝트 배정 요청/);
  assert.ok(!dm.text.includes('<!here>'), 'project names are escaped too');
  assert.ok(dm.text.includes('http://app.test'));
});

test('an undeliverable DM never breaks the business request', async () => {
  // e2 is activated while still in Slack, then removed from the fake workspace (e.g. left the company):
  // later DMs cannot be delivered, but the assignment itself must still succeed.
  const c = await call('POST', '/api/admin/employees', admin, { name: '직원2', email: 'e2@test.local', role: 'EMPLOYEE', departmentId: dept });
  assert.equal(c.j.delivered, true);
  const tokenE2 = tokenIn(dmsTo('e2@test.local')[0].text);
  await call('POST', '/api/auth/password-reset-confirm', null, { token: tokenE2, newPassword: 'Passw0rd-E2xx' });
  const l = await call('POST', '/api/auth/login', null, { email: 'e2@test.local', password: 'Passw0rd-E2xx' });
  assert.equal(l.s, 200);
  IN_SLACK.delete('e2@test.local');
  const p = await call('POST', '/api/projects', tok.A, {
    project: { name: 'P2', startDate: '2026-11-01', endDate: '2026-12-31', color: '#7c3aed' },
    sessions: [{ title: 's', daysOfWeek: [3], startTime: '10:00', endTime: '12:00', timezone: 'Asia/Seoul' }],
  });
  const a = await call('POST', '/api/assignments', tok.A, { projectId: p.j.project.id, employeeId: l.j.user.id });
  assert.equal(a.s, 200, 'assignment succeeds even though the DM cannot be delivered');
  const state = await call('GET', '/api/state', l.j.token);
  assert.ok(state.j.notifications.some((n: any) => n.type === 'ASSIGNED'), 'in-app notification still exists');
});
