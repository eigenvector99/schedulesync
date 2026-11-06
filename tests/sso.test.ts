/**
 * Sign in with Slack. The real server runs against a local fake of Slack's OpenID Connect and Web APIs.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { prepareDatabase, startServer, TestDb, TestServer } from './helpers';

const CLIENT_ID = 'test-client';
const TEAM = 'T-TEST';
const APP = 'http://app.test';
const KNOWN_IN_SLACK = new Set(['admin@test.local', 'e1@test.local', 'e3@test.local']);

// ---- fake Slack ---------------------------------------------------------------------------------
const codes = new Map<string, Record<string, unknown>>();
const dms: { channel: string; text: string }[] = [];
let slack: http.Server;
let slackBase = '';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;

before(async () => {
  slack = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const reply = (o: unknown) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(o));
      };
      if (req.url === '/openid.connect.token') {
        const f = new URLSearchParams(raw);
        const claims = codes.get(f.get('code') || '');
        if (f.get('client_secret') !== 'test-secret' || f.get('client_id') !== CLIENT_ID || !claims) return reply({ ok: false, error: 'invalid_code' });
        if (f.get('redirect_uri') !== `${APP}/api/auth/slack/callback`) return reply({ ok: false, error: 'bad_redirect_uri' });
        codes.delete(f.get('code')!); // authorization codes are single use
        return reply({ ok: true, id_token: jwt(claims), access_token: 'x' });
      }
      if (req.url === '/users.lookupByEmail') {
        const email = new URLSearchParams(raw).get('email')!.toLowerCase();
        return KNOWN_IN_SLACK.has(email) ? reply({ ok: true, user: { id: `U_${email.split('@')[0]}` } }) : reply({ ok: false, error: 'users_not_found' });
      }
      if (req.url === '/chat.postMessage') {
        const b = JSON.parse(raw);
        dms.push({ channel: b.channel, text: b.text });
        return reply({ ok: true });
      }
      if (req.url === '/auth.test') return reply({ ok: true });
      reply({ ok: false, error: 'unknown_method' });
    });
  });
  await new Promise<void>((r) => slack.listen(0, '127.0.0.1', r));
  slackBase = `http://127.0.0.1:${(slack.address() as any).port}`;
});
after(() => slack?.close());

// ---- helpers ------------------------------------------------------------------------------------
let tdb: TestDb;
let srv: TestServer;
let admin = '';
let dept = '';

const ssoEnv = () => ({
  SLACK_CLIENT_ID: CLIENT_ID,
  SLACK_CLIENT_SECRET: 'test-secret',
  SLACK_TEAM_ID: TEAM,
  SLACK_AUTH_URL: 'http://slack.test/openid/connect/authorize',
  SLACK_API_URL: slackBase,
  SLACK_BOT_TOKEN: 'xoxb-test',
  APP_URL: APP,
});

async function startFlow() {
  const r = await fetch(`${srv.base}/api/auth/slack/login`, { redirect: 'manual' });
  const loc = new URL(r.headers.get('location')!);
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { status: r.status, loc, cookie, setCookie: r.headers.get('set-cookie') || '', state: loc.searchParams.get('state')!, nonce: loc.searchParams.get('nonce')! };
}

type Flow = Awaited<ReturnType<typeof startFlow>>;

async function callback(params: { code: string; state: string }, cookie: string | undefined) {
  const q = new URLSearchParams(params).toString();
  const r = await fetch(`${srv.base}/api/auth/slack/callback?${q}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
  return r.headers.get('location') || '';
}

/** Runs a full, well-formed Slack login for `email`; `claims` lets a test break one thing. */
async function slackLogin(email: string, sub: string, claims: Record<string, unknown> = {}, flow?: Flow) {
  const f = flow ?? (await startFlow());
  const code = `code-${crypto.randomBytes(6).toString('hex')}`;
  codes.set(code, {
    iss: 'https://slack.com',
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: f.nonce,
    email,
    email_verified: true,
    name: email.split('@')[0],
    'https://slack.com/team_id': TEAM,
    'https://slack.com/user_id': sub,
    ...claims,
  });
  return callback({ code, state: f.state }, f.cookie);
}

const exchange = (code: string) => srv.call('POST', '/api/auth/slack/exchange', null, { code });
const codeOf = (location: string) => new URL(location, APP).searchParams.get('ssoCode')!;
const errorOf = (location: string) => new URL(location, APP).searchParams.get('ssoError');
const auditActions = async () => (await srv.call('GET', '/api/state', admin)).j.auditLogs.map((l: any) => l.action);

test('phase 1 (before Slack sign-in exists): a normal account with a password', async () => {
  tdb = await prepareDatabase('sso');
  srv = await startServer(tdb);
  admin = (await srv.call('POST', '/api/auth/login', null, { email: 'admin@test.local', password: 'Admin12345' })).j.token;
  dept = (await srv.call('GET', '/api/state', admin)).j.departments[0].id;
  const legacy = await srv.createUser(admin, 'E2', 'e2@test.local', 'EMPLOYEE', dept); // has a password, like every user did so far
  assert.ok(legacy.token);
  await srv.stop();
});

test('phase 2: restart with Slack sign-in enabled on the same database', async () => {
  srv = await startServer(tdb, ssoEnv());
  const cfg = await srv.call('GET', '/api/auth/config');
  assert.deepEqual(cfg.j, { slack: { enabled: true }, passwordLogin: 'admin-only' });
});

test('passwords are an emergency door for administrators only', async () => {
  const a = await srv.call('POST', '/api/auth/login', null, { email: 'admin@test.local', password: 'Admin12345' });
  assert.equal(a.s, 200, 'administrator keeps password login');
  admin = a.j.token;

  const e = await srv.call('POST', '/api/auth/login', null, { email: 'e2@test.local', password: 'Passw0rd-E2' });
  assert.equal(e.s, 403, 'a correct password no longer works for an ordinary account');
  assert.match(e.j.error, /Slack/);
  assert.equal((await srv.call('POST', '/api/auth/login', null, { email: 'e2@test.local', password: 'wrong-password1' })).s, 401, 'wrong password stays a generic 401');
});

test('the authorization request carries everything Slack and our own CSRF protection need', async () => {
  const f = await startFlow();
  assert.equal(f.status, 302);
  assert.equal(`${f.loc.origin}${f.loc.pathname}`, 'http://slack.test/openid/connect/authorize');
  assert.equal(f.loc.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(f.loc.searchParams.get('response_type'), 'code');
  assert.equal(f.loc.searchParams.get('scope'), 'openid email profile');
  assert.equal(f.loc.searchParams.get('redirect_uri'), `${APP}/api/auth/slack/callback`);
  assert.equal(f.loc.searchParams.get('team'), TEAM);
  assert.ok(f.state.length >= 32 && f.nonce.length >= 32 && f.state !== f.nonce);
  assert.match(f.setCookie, /HttpOnly/);
  assert.match(f.setCookie, /SameSite=Lax/);
  assert.match(f.setCookie, /Path=\/api\/auth\/slack/);
});

test('inviting an ordinary user sends a "sign in with Slack" note instead of a password link', async () => {
  const c = await srv.call('POST', '/api/admin/employees', admin, { name: 'E1', email: 'e1@test.local', role: 'EMPLOYEE', departmentId: dept });
  assert.equal(c.s, 200);
  assert.equal(c.j.delivered, true);
  const dm = dms.find((d) => d.channel === 'U_e1')!;
  assert.ok(dm.text.includes(APP));
  assert.ok(!dm.text.includes('토큰') && !dm.text.includes('resetToken'), 'no password token is issued');
  assert.equal(c.j.employee.status, 'INVITED');
});

test('first Slack login activates an invited account and creates a one-time session code', async () => {
  const loc = await slackLogin('e1@test.local', 'U_E1');
  assert.match(loc, /^\/\?ssoCode=[0-9a-f]{48}$/, 'no session token ever appears in a URL');
  const code = codeOf(loc);

  const ex = await exchange(code);
  assert.equal(ex.s, 200);
  assert.equal(ex.j.user.email, 'e1@test.local');
  assert.equal(ex.j.user.slackUserId, undefined, 'internal fields never reach the client');
  assert.equal((await srv.call('GET', '/api/auth/me', ex.j.token)).j.user.status, 'ACTIVE');

  assert.equal((await exchange(code)).s, 401, 'a code works exactly once');
  assert.ok((await auditActions()).includes('SLACK_LOGIN_ACTIVATED'));
});

test('later logins work, matching on e-mail case-insensitively', async () => {
  const loc = await slackLogin('E1@Test.Local', 'U_E1');
  assert.equal((await exchange(codeOf(loc))).s, 200);
  assert.ok((await auditActions()).includes('SLACK_LOGIN'));
});

test('an existing account that has a password can sign in with Slack too, and is bound to that Slack identity', async () => {
  assert.equal((await exchange(codeOf(await slackLogin('e2@test.local', 'U_E2')))).s, 200);
  // the e-mail address now belongs to a different Slack person (recycled address): refused
  assert.equal(errorOf(await slackLogin('e2@test.local', 'U_SOMEONE_ELSE')), 'identity_mismatch');
  // and one Slack identity cannot be attached to a second account
  await srv.call('POST', '/api/admin/employees', admin, { name: 'E3', email: 'e3@test.local', role: 'EMPLOYEE', departmentId: dept });
  assert.equal(errorOf(await slackLogin('e3@test.local', 'U_E2')), 'identity_mismatch');
});

test('people who are not registered are turned away, and administrators can see the attempt', async () => {
  const loc = await slackLogin('stranger@test.local', 'U_X');
  assert.equal(errorOf(loc), 'not_registered');
  assert.equal(codeOf(loc), null);
  const log = (await srv.call('GET', '/api/state', admin)).j.auditLogs.find((l: any) => l.action === 'SSO_LOGIN_REJECTED' && l.details.includes('stranger@test.local'));
  assert.ok(log, 'rejected attempt is in the audit log');
});

test('a disabled account cannot sign in with Slack', async () => {
  const id = (await srv.call('GET', '/api/state', admin)).j.employees.find((e: any) => e.email === 'e2@test.local').id;
  await srv.call('PATCH', `/api/admin/employees/${id}/status`, admin);
  assert.equal(errorOf(await slackLogin('e2@test.local', 'U_E2')), 'disabled');
});

test('identity claims are validated: workspace, e-mail, nonce, audience, issuer, expiry', async () => {
  const bad = async (claims: Record<string, unknown>) => errorOf(await slackLogin('e1@test.local', 'U_E1', claims));
  assert.equal(await bad({ 'https://slack.com/team_id': 'T-OTHER' }), 'wrong_workspace');
  assert.equal(await bad({ email_verified: false }), 'email_unverified');
  assert.equal(await bad({ nonce: 'something-else' }), 'invalid_id_token');
  assert.equal(await bad({ aud: 'another-app' }), 'invalid_id_token');
  assert.equal(await bad({ iss: 'https://evil.example' }), 'invalid_id_token');
  assert.equal(await bad({ exp: Math.floor(Date.now() / 1000) - 3600 }), 'invalid_id_token');
  assert.equal(await bad({ email: '' }), 'no_email');
});

test('CSRF protection: state is single-use and bound to the browser that started the flow', async () => {
  // replay
  const f = await startFlow();
  assert.match(await slackLogin('e1@test.local', 'U_E1', {}, f), /ssoCode=/);
  assert.equal(errorOf(await slackLogin('e1@test.local', 'U_E1', {}, f)), 'invalid_state', 'second use of the same state');

  // the callback arrives without the cookie (a login-CSRF attempt in another browser)
  const g = await startFlow();
  assert.equal(errorOf(await slackLogin('e1@test.local', 'U_E1', {}, { ...g, cookie: '' })), 'invalid_state');

  // the cookie belongs to a different flow
  const h = await startFlow();
  const other = await startFlow();
  assert.equal(errorOf(await slackLogin('e1@test.local', 'U_E1', {}, { ...h, cookie: other.cookie })), 'invalid_state');

  // nonsense
  assert.equal(errorOf(await callback({ code: 'x', state: 'nope' }, h.cookie)), 'invalid_state');
  const denied = await fetch(`${srv.base}/api/auth/slack/callback?error=access_denied`, { redirect: 'manual' });
  assert.equal(errorOf(denied.headers.get('location')!), 'denied');
});

test('the administrator recovery path: password reset still works for admins, and only issues links to admins', async () => {
  const before = dms.filter((d) => d.channel === 'U_admin').length;
  assert.equal((await srv.call('POST', '/api/auth/password-reset-request', null, { email: 'admin@test.local' })).s, 200);
  const adminDm = await waitForDm('U_admin', before);
  assert.match(adminDm.text, /토큰: [0-9a-f]{64}/);

  const beforeE1 = dms.filter((d) => d.channel === 'U_e1').length;
  await srv.call('POST', '/api/auth/password-reset-request', null, { email: 'e1@test.local' });
  const e1Dm = await waitForDm('U_e1', beforeE1);
  assert.ok(!e1Dm.text.includes('토큰'), 'ordinary users get a sign-in hint, never a reset token');
  assert.ok(e1Dm.text.includes(APP));
});

async function waitForDm(channel: string, before: number) {
  for (let i = 0; i < 100; i++) {
    const list = dms.filter((d) => d.channel === channel);
    if (list.length > before) return list.at(-1)!;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`no DM to ${channel}`);
}

test('cleanup', async () => {
  await srv.stop();
  await tdb.cleanup();
});
