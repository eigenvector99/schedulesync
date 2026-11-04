/**
 * What moving to PostgreSQL is for: concurrency safety, constraints enforced by the database itself,
 * and migrating the old file database.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareDatabase, startServer, TestDb, TestServer } from './helpers';
import { openDb, migrate, Db } from '../server/db';

const SESSION = (start: string, end: string, day = 1) => ({ title: 's', daysOfWeek: [day], startTime: start, endTime: end, timezone: 'Asia/Seoul' });

describe('concurrent requests', () => {
  let tdb: TestDb;
  let srv: TestServer;
  let admin = '';
  let A: { token: string; id: string };
  let B: { token: string; id: string };
  let p1 = '';
  let p2 = '';
  let dept = '';

  before(async () => {
    tdb = await prepareDatabase('conc');
    srv = await startServer(tdb);
    admin = (await srv.call('POST', '/api/auth/login', null, { email: 'admin@test.local', password: 'Admin12345' })).j.token;
    dept = (await srv.call('GET', '/api/state', admin)).j.departments[0].id;
    A = await srv.createUser(admin, 'A', 'a@test.local', 'APPROVER', dept);
    B = await srv.createUser(admin, 'B', 'b@test.local', 'APPROVER', dept);
    const mk = (t: string, name: string, s: any) =>
      srv.call('POST', '/api/projects', t, { project: { name, startDate: '2026-11-01', endDate: '2026-12-31', color: '#2563eb' }, sessions: [s] });
    p1 = (await mk(A.token, 'P1', SESSION('10:00', '12:00'))).j.project.id;
    p2 = (await mk(B.token, 'P2', SESSION('11:00', '13:00'))).j.project.id; // overlaps P1 on Mondays
  });
  after(async () => {
    await srv?.stop();
    await tdb?.cleanup();
  });

  test('two overlapping assignments approved at the same moment never both get confirmed', async () => {
    const employees: { token: string; id: string }[] = [];
    for (let i = 0; i < 6; i++) employees.push(await srv.createUser(admin, `E${i}`, `e${i}@test.local`, 'EMPLOYEE', dept));

    // every employee holds two pending assignments that overlap in time
    const pairs: [string, string][] = [];
    for (const e of employees) {
      const a1 = (await srv.call('POST', '/api/assignments', A.token, { projectId: p1, employeeId: e.id })).j.assignment.id;
      const a2 = (await srv.call('POST', '/api/assignments', B.token, { projectId: p2, employeeId: e.id })).j.assignment.id;
      assert.equal((await srv.call('POST', `/api/assignments/${a1}/response`, e.token, { accept: true })).s, 200);
      assert.equal((await srv.call('POST', `/api/assignments/${a2}/response`, e.token, { accept: true })).s, 200);
      pairs.push([a1, a2]);
    }

    // fire all 24 approvals at once
    const results = await Promise.all(
      pairs.flatMap(([a1, a2]) => [
        srv.call('POST', `/api/assignments/${a1}/decision`, A.token, { decision: 'APPROVED' }),
        srv.call('POST', `/api/assignments/${a1}/decision`, B.token, { decision: 'APPROVED' }),
        srv.call('POST', `/api/assignments/${a2}/decision`, A.token, { decision: 'APPROVED' }),
        srv.call('POST', `/api/assignments/${a2}/decision`, B.token, { decision: 'APPROVED' }),
      ])
    );
    for (const r of results) assert.ok([200, 409].includes(r.s), `unexpected status ${r.s}: ${JSON.stringify(r.j)}`);

    const state = (await srv.call('GET', '/api/state', admin)).j;
    for (const [i, e] of employees.entries()) {
      const confirmed = state.assignments.filter((a: any) => a.employeeId === e.id && a.status === 'APPROVED');
      assert.equal(confirmed.length, 1, `employee ${i}: exactly one of the two overlapping assignments is confirmed`);
    }
  });

  test('parallel duplicate assignment requests create exactly one live assignment', async () => {
    const e = await srv.createUser(admin, 'Dup', 'dup@test.local', 'EMPLOYEE', dept);
    const rs = await Promise.all(Array.from({ length: 8 }, () => srv.call('POST', '/api/assignments', A.token, { projectId: p1, employeeId: e.id })));
    assert.equal(rs.filter((r) => r.s === 200).length, 1);
    assert.equal(rs.filter((r) => r.s === 409).length, 7);
  });

  test('a one-time reset token can be consumed only once even under a race', async () => {
    const c = await srv.call('POST', '/api/admin/employees', admin, { name: 'Race', email: 'race@test.local', role: 'EMPLOYEE', departmentId: dept });
    assert.equal(c.s, 200);
    const token = new URL(c.j.inviteLink).searchParams.get('resetToken')!;
    const rs = await Promise.all(
      Array.from({ length: 6 }, (_, i) => srv.call('POST', '/api/auth/password-reset-confirm', null, { token, newPassword: `Passw0rd-race-${i}x` }))
    );
    assert.equal(rs.filter((r) => r.s === 200).length, 1);
  });
});

describe('schema guarantees', () => {
  let tdb: TestDb;
  let db: Db;

  before(async () => {
    tdb = await prepareDatabase('schema');
    process.env.DATABASE_URL = tdb.env.DATABASE_URL;
    db = await openDb(tdb.env.DATA_DIR);
    await migrate(db);
    await db.query(`INSERT INTO departments (id, name) VALUES ('d','D')`);
    await db.query(`INSERT INTO users (id,email,name,department_id,role,status,password_salt,password_hash) VALUES ('u','u@x.com','U','d','APPROVER','ACTIVE','s','h')`);
    await db.query(`INSERT INTO projects (id,name,created_by,start_date,end_date,status,color) VALUES ('p','P','u','2026-11-01','2026-12-31','RECRUITING','#000000')`);
  });
  after(async () => {
    await db?.close();
    await tdb?.cleanup();
  });

  test('migrations are idempotent', async () => {
    await migrate(db);
    const n = (await db.query(`SELECT count(*)::int AS n FROM schema_migrations`)).rows[0].n;
    assert.equal(n, 1);
  });

  test('the audit log is append-only', async () => {
    await db.query(`INSERT INTO audit_logs (id,actor_id,actor_name,action,target_type,target_id,details) VALUES ('l','u','U','X','T','1','d')`);
    await assert.rejects(db.query(`UPDATE audit_logs SET details='tampered' WHERE id='l'`), /append-only/);
    await assert.rejects(db.query(`DELETE FROM audit_logs WHERE id='l'`), /append-only/);
  });

  test('the database refuses two live assignments for the same project and employee', async () => {
    const ins = (id: string, status: string) =>
      db.query(`INSERT INTO assignments (id,project_id,employee_id,assigned_by,type,status) VALUES ($1,'p','u','u','SELF',$2)`, [id, status]);
    await ins('a1', 'APPROVED');
    await assert.rejects(ins('a2', 'EMPLOYEE_PENDING'), /unique|duplicate/i);
    await ins('a3', 'DECLINED'); // finished assignments do not count
  });

  test('invalid data is rejected by constraints', async () => {
    await assert.rejects(db.query(`INSERT INTO projects (id,name,created_by,start_date,end_date,status,color) VALUES ('q','Q','u','2026-12-31','2026-11-01','RECRUITING','#000000')`));
    await assert.rejects(db.query(`UPDATE users SET role='ROOT' WHERE id='u'`));
    await assert.rejects(db.query(`INSERT INTO users (id,email,name,department_id,role,status,password_salt,password_hash) VALUES ('v','U@X.COM','V','d','EMPLOYEE','ACTIVE','s','h')`), /unique|duplicate/i);
  });

  test('a failed transaction leaves nothing behind', async () => {
    await assert.rejects(
      db.tx(async (q) => {
        await q.query(`INSERT INTO departments (id, name) VALUES ('tx','TX')`);
        throw new Error('boom');
      }),
      /boom/
    );
    assert.equal((await db.query(`SELECT 1 FROM departments WHERE id='tx'`)).rows.length, 0);
  });
});

describe('importing the legacy database.json', () => {
  let tdb: TestDb;
  let srv: TestServer;
  let file: string;

  const legacyHash = (pw: string, salt: string) => crypto.pbkdf2Sync(pw, salt, 1000, 64, 'sha512').toString('hex');
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/import-json.ts', ...args], { env: { ...process.env, ...env }, encoding: 'utf-8' });

  before(async () => {
    tdb = await prepareDatabase('import');
    const demoSalt = 'common_company_salt_2026';
    const legacy = {
      users: [
        { id: 'u-admin', email: 'admin@company.internal', name: '관리자', departmentId: 'd1', role: 'ADMIN', status: 'ACTIVE', timezone: 'Asia/Seoul', passwordSalt: demoSalt, passwordHash: legacyHash('admin123!', demoSalt) },
        { id: 'u-head', email: 'head@corp.com', name: '부서장', departmentId: 'd1', role: 'APPROVER', status: 'ACTIVE', timezone: 'Asia/Seoul', passwordSalt: 'own-salt', passwordHash: legacyHash('OldPass123', 'own-salt') },
        { id: 'u-emp', email: 'emp@corp.com', name: '직원', departmentId: 'd1', role: 'EMPLOYEE', status: 'ACTIVE', timezone: 'Asia/Seoul', passwordSalt: 'salt2', passwordHash: legacyHash('EmpPass123', 'salt2') },
      ],
      departments: [{ id: 'd1', name: '개발', headEmployeeId: 'u-head' }],
      projects: [{ id: 'p1', name: '프로젝트', description: '', createdBy: 'u-head', startDate: '2026-11-01', endDate: '2026-12-31', status: 'IN_PROGRESS', headcount: 2, color: '#2563eb', createdAt: '2026-11-01T09:00:00Z', updatedAt: '2026-11-01T09:00:00Z' }],
      sessions: [{ id: 's1', projectId: 'p1', title: '정기', startAt: '2026-11-01T14:00:00Z', endAt: '2026-12-31T17:00:00Z', rrule: 'FREQ=WEEKLY;BYDAY=TU', daysOfWeek: [2], startTime: '14:00', endTime: '17:00', timezone: 'Asia/Seoul' }],
      assignments: [
        // the old version allowed duplicates; the newest live one must win
        { id: 'a-old', projectId: 'p1', employeeId: 'u-emp', assignedBy: 'u-head', type: 'EMPLOYEE', status: 'EMPLOYEE_PENDING', createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', approvalDecisions: [] },
        { id: 'a-new', projectId: 'p1', employeeId: 'u-emp', assignedBy: 'u-head', type: 'EMPLOYEE', status: 'APPROVAL_PENDING', createdAt: '2026-11-02T10:00:00Z', updatedAt: '2026-11-02T10:00:00Z', approvalDecisions: [{ id: 'dec1', assignmentId: 'a-new', approverId: 'u-head', decision: 'APPROVED', comment: 'ok', decidedAt: '2026-11-02T11:00:00Z' }] },
      ],
      changeRequests: [], allowedOverlaps: [],
      notifications: [{ id: 'n1', recipientId: 'u-emp', type: 'ASSIGNED', title: 't', message: 'm', read: false, linkTab: 'inbox', createdAt: '2026-11-02T10:00:00Z' }],
      mockEmails: [{ id: 'm1' }],
      auditLogs: [{ id: 'l1', actorId: 'u-admin', actorName: '관리자', action: 'INIT', targetType: 'DEPARTMENT', targetId: 'd1', details: 'init', createdAt: '2026-11-01T08:00:00Z' }],
      tokens: [{ token: 'old', userId: 'u-emp', expiresAt: '2099-01-01T00:00:00Z' }],
    };
    file = path.join(tdb.env.DATA_DIR, 'legacy.json');
    fs.writeFileSync(file, JSON.stringify(legacy));
  });
  after(async () => {
    await srv?.stop();
    await tdb?.cleanup();
  });

  test('imports data, neutralises demo accounts, keeps legacy passwords working and creates an admin', async () => {
    const env = { ...tdb.env, ADMIN_EMAIL: 'new-admin@corp.com', ADMIN_PASSWORD: 'BrandNew12345' };
    const r = run([file], env);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout + r.stderr, /데모 시드 계정/);
    assert.match(r.stdout + r.stderr, /중복 배정 정리/);

    // a second import is refused, the database is not empty any more
    assert.notEqual(run([file], env).status, 0);

    srv = await startServer(tdb);
    // the demo admin keeps its (known) password but can no longer sign in
    const demo = await srv.call('POST', '/api/auth/login', null, { email: 'admin@company.internal', password: 'admin123!' });
    assert.equal(demo.s, 403);
    // the new administrator works
    const admin = (await srv.call('POST', '/api/auth/login', null, { email: 'new-admin@corp.com', password: 'BrandNew12345' })).j.token;
    assert.ok(admin);
    // a legacy 1,000-iteration hash still verifies, and is upgraded transparently
    assert.equal((await srv.call('POST', '/api/auth/login', null, { email: 'emp@corp.com', password: 'EmpPass123' })).s, 200);
    assert.equal((await srv.call('POST', '/api/auth/login', null, { email: 'emp@corp.com', password: 'EmpPass123' })).s, 200);
    assert.equal((await srv.call('POST', '/api/auth/login', null, { email: 'emp@corp.com', password: 'wrong' })).s, 401);

    const state = (await srv.call('GET', '/api/state', admin)).j;
    assert.equal(state.projects.length, 1);
    assert.equal(state.sessions.length, 1);
    assert.deepEqual(state.sessions[0].daysOfWeek, [2]);
    assert.equal(state.departments[0].headEmployeeId, 'u-head');
    const byId = Object.fromEntries(state.assignments.map((a: any) => [a.id, a]));
    assert.equal(byId['a-old'].status, 'WITHDRAWN');
    assert.equal(byId['a-new'].status, 'APPROVAL_PENDING');
    assert.equal(byId['a-new'].approvalDecisions[0].comment, 'ok');
    assert.ok(state.auditLogs.some((l: any) => l.id === 'l1'));
  });
});
