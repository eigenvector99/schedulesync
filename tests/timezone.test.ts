/**
 * Time handling must not depend on the time zone of the machine it runs on (browser, server, container).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { prepareDatabase, startServer, TestDb, TestServer } from './helpers';

const run = (tz: string) => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'tests/tz-cases.ts'], { env: { ...process.env, TZ: tz }, encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

describe('time zone independence', () => {
  const zones = ['UTC', 'Asia/Seoul', 'America/Los_Angeles', 'Pacific/Auckland'];
  const results = Object.fromEntries(zones.map((z) => [z, run(z)]));

  test('results are identical whatever the process time zone is', () => {
    for (const z of zones.slice(1)) assert.deepEqual(results[z], results.UTC, `TZ=${z} differs from TZ=UTC`);
  });

  const r = results.UTC;

  test('wall-clock times convert correctly, including DST edges', () => {
    assert.equal(r.seoul, '2026-11-05T01:00:00.000Z');
    assert.equal(r.nyWinter, '2026-03-06T14:00:00.000Z'); // EST (UTC-5)
    assert.equal(r.nySummer, '2026-03-09T13:00:00.000Z'); // EDT (UTC-4)
    assert.equal(r.nyGap, '2026-03-08T07:30:00.000Z'); // 02:30 does not exist -> shifted forward to 03:30 EDT
    assert.equal(r.nyFold, '2026-11-01T05:30:00.000Z'); // 01:30 happens twice -> first (EDT)
  });

  test('weekly sessions land on the right dates and Seoul times', () => {
    assert.deepEqual(r.tuesdays, [
      '2026-11-03 14:00-17:00 2026-11-03T05:00:00.000Z',
      '2026-11-10 14:00-17:00 2026-11-10T05:00:00.000Z',
      '2026-11-17 14:00-17:00 2026-11-17T05:00:00.000Z',
      '2026-11-24 14:00-17:00 2026-11-24T05:00:00.000Z',
    ]);
  });

  test('an absolute single session collides with a recurring one (this used to be missed on UTC servers)', () => {
    assert.equal(r.mixed.has, true);
    assert.ok(r.mixed.conflicts.includes('2026-11-03 14:00-17:00 vs 2026-11-03 14:00-17:00'));
  });

  test('an early-morning Seoul session is filed under the Seoul date', () => {
    assert.deepEqual(r.earlyMorning, ['2026-11-04 08:30-09:30']);
  });

  test('sessions in different zones are compared as real instants', () => {
    assert.equal(r.crossZone.has, true);
    assert.ok(r.crossZone.conflicts.some((c: string) => c.startsWith('2026-11-04 11:00-13:00')), r.crossZone.conflicts.join('\n'));
  });

  test('back-to-back sessions do not overlap', () => {
    assert.equal(r.adjacent.has, false);
  });

  test('calendar helpers use the company zone', () => {
    assert.deepEqual(r.days, ['2026-11-01:0일', '2026-11-02:1월', '2026-11-03:2화']);
    assert.equal(r.today, '2026-11-04'); // 16:00Z on the 3rd is already the 4th in Seoul
    assert.equal(r.todayNy, '2026-11-03');
    assert.equal(r.fmt, '2026-11-04 01:30');
    assert.match(r.dateTime, /2026\.\s?11\.\s?04\.?\s?01:30/);
  });
});

describe('server validation and behaviour in a foreign time zone', () => {
  let tdb: TestDb;
  let srv: TestServer;
  let admin = '';
  let dept = '';
  let A0: { token: string; id: string }; // created by the first test; every approver must approve

  before(async () => {
    tdb = await prepareDatabase('tz');
    srv = await startServer(tdb, { TZ: 'America/Los_Angeles' });
    admin = (await srv.call('POST', '/api/auth/login', null, { email: 'admin@test.local', password: 'Admin12345' })).j.token;
    dept = (await srv.call('GET', '/api/state', admin)).j.departments[0].id;
  });
  after(async () => {
    await srv?.stop();
    await tdb?.cleanup();
  });

  const project = { name: 'P', startDate: '2026-11-01', endDate: '2026-11-30', color: '#2563eb' };

  test('ambiguous or malformed time input is rejected', async () => {
    const A = (A0 = await srv.createUser(admin, 'A', 'a@test.local', 'APPROVER', dept));
    const post = (session: any, proj: any = project) => srv.call('POST', '/api/projects', A.token, { project: proj, sessions: [session] });

    // a bare local time means something different on every machine
    assert.equal((await post({ title: 's', startAt: '2026-11-03T14:00:00', endAt: '2026-11-03T17:00:00', timezone: 'Asia/Seoul' })).s, 400);
    assert.equal((await post({ title: 's', daysOfWeek: [2], startTime: '14:00', endTime: '17:00', timezone: 'Mars/Olympus' })).s, 400);
    assert.equal((await post({ title: 's', daysOfWeek: [2], startTime: '14:00', endTime: '17:00' }, { ...project, startDate: '2000-01-01', endDate: '2030-01-01' })).s, 400);

    assert.equal((await post({ title: 's', startAt: '2026-11-03T14:00:00+09:00', endAt: '2026-11-03T17:00:00+09:00', timezone: 'Asia/Seoul' })).s, 200);
    assert.equal((await post({ title: 's', daysOfWeek: [2], startTime: '14:00', endTime: '17:00', timezone: 'America/New_York' })).s, 200);
  });

  test('conflicts between a recurring and an absolute session are found by a server running in Los Angeles', async () => {
    const A = await srv.createUser(admin, 'A2', 'a2@test.local', 'APPROVER', dept);
    const B = await srv.createUser(admin, 'B2', 'b2@test.local', 'APPROVER', dept);
    const E = await srv.createUser(admin, 'E2', 'e2@test.local', 'EMPLOYEE', dept);

    const p1 = (await srv.call('POST', '/api/projects', A.token, { project: project, sessions: [{ title: 'weekly', daysOfWeek: [2], startTime: '14:00', endTime: '17:00', timezone: 'Asia/Seoul' }] })).j.project.id;
    // Tue 3 Nov 14:00-17:00 Seoul time written as an absolute instant
    const p2 = (await srv.call('POST', '/api/projects', B.token, { project: project, sessions: [{ title: 'one-off', startAt: '2026-11-03T05:00:00Z', endAt: '2026-11-03T08:00:00Z', timezone: 'Asia/Seoul' }] })).j.project.id;

    const a1 = (await srv.call('POST', '/api/assignments', A.token, { projectId: p1, employeeId: E.id })).j.assignment.id;
    await srv.call('POST', `/api/assignments/${a1}/response`, E.token, { accept: true });
    // "all approvers" rule: A0, A and B must all approve
    await srv.call('POST', `/api/assignments/${a1}/decision`, A0.token, { decision: 'APPROVED' });
    await srv.call('POST', `/api/assignments/${a1}/decision`, A.token, { decision: 'APPROVED' });
    assert.equal((await srv.call('POST', `/api/assignments/${a1}/decision`, B.token, { decision: 'APPROVED' })).j.assignment.status, 'APPROVED');

    const a2 = (await srv.call('POST', '/api/assignments', B.token, { projectId: p2, employeeId: E.id })).j.assignment.id;
    await srv.call('POST', `/api/assignments/${a2}/response`, E.token, { accept: true });
    const blocked = await srv.call('POST', `/api/assignments/${a2}/decision`, A.token, { decision: 'APPROVED' });
    assert.equal(blocked.s, 409);
    assert.ok(blocked.j.conflicts.some((c: any) => c.targetSession.dateStr === '2026-11-03' && c.targetSession.startTime === '14:00'));
  });
});
