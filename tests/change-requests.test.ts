/**
 * A schedule change request is a decision about a specific situation. These tests make sure it can no longer be
 * approved or applied once that situation has changed.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepareDatabase, startServer, TestDb, TestServer } from './helpers';

let tdb: TestDb;
let srv: TestServer;
let admin = '';
let dept = '';
let A: { token: string; id: string }; // owns P1 (the project that gets changed)
let B: { token: string; id: string }; // owns P2 (the project it would collide with)
let n = 0;

const slot = (day: number, start: string, end: string) => ({ title: 's', daysOfWeek: [day], startTime: start, endTime: end, timezone: 'Asia/Seoul' });
const range = { startDate: '2026-11-01', endDate: '2026-12-31', color: '#2563eb' };

before(async () => {
  tdb = await prepareDatabase('cr');
  srv = await startServer(tdb);
  admin = (await srv.call('POST', '/api/auth/login', null, { email: 'admin@test.local', password: 'Admin12345' })).j.token;
  dept = (await srv.call('GET', '/api/state', admin)).j.departments[0].id;
  A = await srv.createUser(admin, 'A', 'a@test.local', 'APPROVER', dept);
  B = await srv.createUser(admin, 'B', 'b@test.local', 'APPROVER', dept);
});
after(async () => {
  await srv?.stop();
  await tdb?.cleanup();
});

/** Confirms an employee on a project through the real workflow (assign, accept, every approver approves). */
async function confirm(owner: { token: string }, projectId: string, emp: { token: string; id: string }) {
  const a = (await srv.call('POST', '/api/assignments', owner.token, { projectId, employeeId: emp.id })).j.assignment.id;
  await srv.call('POST', `/api/assignments/${a}/response`, emp.token, { accept: true });
  await srv.call('POST', `/api/assignments/${a}/decision`, A.token, { decision: 'APPROVED' });
  const last = await srv.call('POST', `/api/assignments/${a}/decision`, B.token, { decision: 'APPROVED' });
  assert.equal(last.j.assignment.status, 'APPROVED');
}

/**
 * Fresh world: employee E confirmed on P1 (A, Mondays 10-12) and P2 (B, Wednesdays 10-12).
 * A then asks to move P1 to Wednesday 10-14, which collides with P2 -> needs B's approval and E's consent.
 */
async function world() {
  n++;
  const E = await srv.createUser(admin, `E${n}`, `e${n}@test.local`, 'EMPLOYEE', dept);
  const mk = async (owner: { token: string }, name: string, s: any) =>
    (await srv.call('POST', '/api/projects', owner.token, { project: { name: `${name}-${n}`, ...range }, sessions: [s] })).j.project.id as string;
  const p1 = await mk(A, 'P1', slot(1, '10:00', '12:00'));
  const p2 = await mk(B, 'P2', slot(3, '10:00', '12:00'));
  await confirm(A, p1, E);
  await confirm(B, p2, E);
  const propose = (sessions = [slot(3, '10:00', '14:00')]) => srv.call('PUT', `/api/projects/${p1}/sessions`, A.token, { sessions });
  return { E, p1, p2, propose };
}

const stateOf = async (token: string) => (await srv.call('GET', '/api/state', token)).j;
const sessionsOf = async (p: string) => (await stateOf(admin)).sessions.filter((s: any) => s.projectId === p);
const requestOf = async (id: string) => (await stateOf(admin)).changeRequests.find((c: any) => c.id === id);

test('baseline: a colliding change needs the other approver and the employee, then it is applied', async () => {
  const w = await world();
  const r = await w.propose();
  assert.equal(r.s, 200);
  assert.equal(r.j.appliedDirectly, false);
  const id = r.j.changeRequest.id;
  assert.deepEqual(r.j.changeRequest.decisions.map((d: any) => d.actorId).sort(), [B.id, w.E.id].sort());

  assert.equal((await srv.call('POST', `/api/change-requests/${id}/decision`, B.token, { decision: 'APPROVED' })).j.allApproved, false);
  assert.deepEqual((await sessionsOf(w.p1)).map((s: any) => s.daysOfWeek), [[1]], 'not applied before everyone agreed');
  assert.equal((await srv.call('POST', `/api/change-requests/${id}/decision`, w.E.token, { decision: 'APPROVED' })).j.allApproved, true);
  assert.deepEqual((await sessionsOf(w.p1)).map((s: any) => s.daysOfWeek), [[3]]);
  assert.equal((await requestOf(id)).status, 'CHANGE_APPROVED');
});

test('only one pending request per project; the requester can withdraw it, nobody else can', async () => {
  const w = await world();
  const id = (await w.propose()).j.changeRequest.id;

  const second = await w.propose([slot(4, '10:00', '12:00')]);
  assert.equal(second.s, 409);
  assert.equal(second.j.pendingRequestId, id);

  assert.equal((await srv.call('POST', `/api/change-requests/${id}/withdraw`, B.token)).s, 403);
  assert.equal((await srv.call('POST', `/api/change-requests/${id}/withdraw`, A.token)).s, 200);
  assert.equal((await srv.call('POST', `/api/change-requests/${id}/withdraw`, A.token)).s, 409, 'already closed');

  const closed = await requestOf(id);
  assert.equal(closed.status, 'CHANGE_WITHDRAWN');
  assert.equal(closed.closedReason, 'WITHDRAWN_BY_REQUESTER');
  // the approver cannot approve a withdrawn request, and was told about the withdrawal
  assert.equal((await srv.call('POST', `/api/change-requests/${id}/decision`, B.token, { decision: 'APPROVED' })).s, 409);
  assert.ok((await stateOf(B.token)).notifications.some((x: any) => x.type === 'CHANGE_CLOSED'));
  // a new request is possible again
  assert.equal((await w.propose()).s, 200);
});

test('a project schedule that changed after the request makes it stale (BASE_CHANGED)', async () => {
  const w = await world();
  const id = (await w.propose()).j.changeRequest.id;

  // someone shortens the project: the request was made against a different schedule
  assert.equal((await srv.call('PATCH', `/api/projects/${w.p1}`, A.token, { endDate: '2026-12-30' })).s, 200);

  const r = await srv.call('POST', `/api/change-requests/${id}/decision`, B.token, { decision: 'APPROVED' });
  assert.equal(r.s, 409);
  assert.equal(r.j.stale, true);
  assert.equal(r.j.closedReason, 'BASE_CHANGED');
  assert.deepEqual((await sessionsOf(w.p1)).map((s: any) => s.daysOfWeek), [[1]], 'the old schedule is untouched');

  const closed = await requestOf(id);
  assert.equal(closed.status, 'CHANGE_WITHDRAWN');
  assert.equal(closed.closedReason, 'BASE_CHANGED');
  // the requester and the employee were told
  assert.ok((await stateOf(A.token)).notifications.some((x: any) => x.type === 'CHANGE_CLOSED'));
  assert.ok((await stateOf(w.E.token)).notifications.some((x: any) => x.type === 'CHANGE_CLOSED'));
  // nobody can still approve it
  assert.equal((await srv.call('POST', `/api/change-requests/${id}/decision`, w.E.token, { decision: 'APPROVED' })).s, 409);
});

test('a new, never-reviewed collision makes the request stale (NEW_CONFLICT)', async () => {
  const w = await world();
  const id = (await w.propose()).j.changeRequest.id; // proposed Wed 10-14: only P2 (Wed 10-12) collides

  // afterwards the employee is confirmed on another project at Wed 13-15, which the proposal would also hit
  const p3 = (await srv.call('POST', '/api/projects', B.token, { project: { name: `P3-${n}`, ...range }, sessions: [slot(3, '13:00', '15:00')] })).j.project.id;
  await confirm(B, p3, w.E);

  const r = await srv.call('POST', `/api/change-requests/${id}/decision`, B.token, { decision: 'APPROVED' });
  assert.equal(r.s, 409);
  assert.equal(r.j.closedReason, 'NEW_CONFLICT');
  assert.deepEqual((await sessionsOf(w.p1)).map((s: any) => s.daysOfWeek), [[1]]);
});

test('a cancelled project closes the request (PROJECT_CLOSED)', async () => {
  const w = await world();
  const id = (await w.propose()).j.changeRequest.id;
  assert.equal((await srv.call('PATCH', `/api/projects/${w.p1}`, A.token, { status: 'CANCELLED' })).s, 200);

  const r = await srv.call('POST', `/api/change-requests/${id}/decision`, B.token, { decision: 'APPROVED' });
  assert.equal(r.s, 409);
  assert.equal(r.j.closedReason, 'PROJECT_CLOSED');
});

test('rejecting never needs re-validation, even for a stale request', async () => {
  const w = await world();
  const id = (await w.propose()).j.changeRequest.id;
  await srv.call('PATCH', `/api/projects/${w.p1}`, A.token, { endDate: '2026-12-30' });
  const r = await srv.call('POST', `/api/change-requests/${id}/decision`, B.token, { decision: 'REJECTED', comment: 'no' });
  assert.equal(r.s, 200);
  assert.equal((await requestOf(id)).status, 'CHANGE_REJECTED');
});

test('submitting a new request automatically closes an older one that went stale', async () => {
  const w = await world();
  const oldId = (await w.propose()).j.changeRequest.id;
  await srv.call('PATCH', `/api/projects/${w.p1}`, A.token, { endDate: '2026-12-30' }); // makes the old request stale

  const fresh = await w.propose([slot(3, '10:00', '13:00')]);
  assert.equal(fresh.s, 200, 'a stale request must not block a new one');
  assert.equal((await requestOf(oldId)).closedReason, 'BASE_CHANGED');
  assert.equal((await requestOf(fresh.j.changeRequest.id)).status, 'CHANGE_PENDING');
});

test('the last two approvals arriving at the same moment apply the change exactly once', async () => {
  const w = await world();
  const id = (await w.propose()).j.changeRequest.id;
  const rs = await Promise.all([
    srv.call('POST', `/api/change-requests/${id}/decision`, B.token, { decision: 'APPROVED' }),
    srv.call('POST', `/api/change-requests/${id}/decision`, w.E.token, { decision: 'APPROVED' }),
  ]);
  assert.deepEqual(rs.map((r) => r.s), [200, 200]);
  assert.equal(rs.filter((r) => r.j.allApproved).length, 1);
  assert.deepEqual((await sessionsOf(w.p1)).map((s: any) => s.daysOfWeek), [[3]]);
});

test('a change that collides with nothing is still applied immediately', async () => {
  const w = await world();
  const r = await w.propose([slot(5, '10:00', '12:00')]); // Friday, free
  assert.equal(r.j.appliedDirectly, true);
  assert.deepEqual((await sessionsOf(w.p1)).map((s: any) => s.daysOfWeek), [[5]]);
});
