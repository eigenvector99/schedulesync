/**
 * One-off import of the legacy file database (data/database.json) into PostgreSQL.
 *
 *   npm run db:import [-- path/to/database.json]
 *
 * Run it BEFORE the first server start (the target database must have no users yet). Uses DATABASE_URL, or the
 * embedded database under DATA_DIR when it is not set. Everything happens in one transaction: either all of the
 * data is imported or nothing is.
 *
 *  - Sessions of the old format are dropped (everybody has to sign in again), as are mock e-mails.
 *  - Accounts created by the old demo seed (well-known salt) are imported as DISABLED.
 *  - Duplicate live assignments (possible in the old version) keep the newest; older ones become WITHDRAWN.
 *  - If no active administrator remains, ADMIN_EMAIL / ADMIN_PASSWORD (if set) create one.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { openDb, migrate, Queryable } from '../server/db';

const DEMO_SALT = 'common_company_salt_2026';
const LIVE = ['EMPLOYEE_PENDING', 'APPROVAL_PENDING', 'APPROVED'];
const pbkdf2 = promisify(crypto.pbkdf2);

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('data');
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(dataDir, 'database.json');

const ts = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : new Date().toISOString());
const nn = <T>(v: T | undefined | null) => (v === undefined ? null : v);

async function main() {
  if (!fs.existsSync(file)) throw new Error(`파일을 찾을 수 없습니다: ${file}`);
  const src = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const db = await openDb(dataDir);
  await migrate(db);

  const existing = (await db.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n;
  if (existing > 0) throw new Error('대상 데이터베이스에 이미 사용자가 있습니다. 빈 데이터베이스에만 가져올 수 있습니다.');

  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

  // Pre-pass: only the newest live assignment per (project, employee) may stay live.
  const asgs: any[] = [...(src.assignments ?? [])].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const seen = new Set<string>();
  for (const a of [...asgs].reverse()) {
    if (!LIVE.includes(a.status)) continue;
    const key = `${a.projectId}|${a.employeeId}`;
    if (seen.has(key)) {
      warnings.push(`중복 배정 정리: ${a.id} (${a.status} -> WITHDRAWN)`);
      a.status = 'WITHDRAWN';
    } else seen.add(key);
  }

  await db.tx(async (q: Queryable) => {
    for (const d of src.departments ?? []) {
      await q.query(`INSERT INTO departments (id, name) VALUES ($1,$2)`, [d.id, d.name]);
      bump('departments');
    }
    let activeAdmins = 0;
    for (const u of src.users ?? []) {
      const demo = u.passwordSalt === DEMO_SALT;
      const status = demo ? 'DISABLED' : u.status;
      if (demo) warnings.push(`데모 시드 계정을 비활성(DISABLED)으로 가져왔습니다: ${u.email}`);
      if (u.role === 'ADMIN' && status === 'ACTIVE') activeAdmins++;
      await q.query(
        `INSERT INTO users (id, email, name, department_id, role, status, timezone, avatar_color, password_salt, password_hash, password_iter)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL)`,
        [u.id, u.email, u.name, u.departmentId, u.role, status, u.timezone ?? 'Asia/Seoul', nn(u.avatarColor), u.passwordSalt, u.passwordHash]
      );
      bump('users');
    }
    for (const d of src.departments ?? []) {
      if (d.headEmployeeId) await q.query(`UPDATE departments SET head_employee_id = $2 WHERE id = $1`, [d.id, d.headEmployeeId]);
    }
    for (const p of src.projects ?? []) {
      await q.query(
        `INSERT INTO projects (id, name, description, created_by, start_date, end_date, status, headcount, color, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [p.id, p.name, p.description ?? '', p.createdBy, p.startDate, p.endDate, p.status, nn(p.headcount), p.color ?? '#2563eb', ts(p.createdAt), ts(p.updatedAt)]
      );
      bump('projects');
    }
    const posByProject = new Map<string, number>();
    for (const s of src.sessions ?? []) {
      const pos = posByProject.get(s.projectId) ?? 0;
      posByProject.set(s.projectId, pos + 1);
      await q.query(
        `INSERT INTO sessions (id, project_id, position, title, start_at, end_at, rrule, days_of_week, start_time, end_time, timezone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [s.id, s.projectId, pos, s.title ?? '', nn(s.startAt), nn(s.endAt), nn(s.rrule), nn(s.daysOfWeek), nn(s.startTime), nn(s.endTime), s.timezone ?? 'Asia/Seoul']
      );
      bump('sessions');
    }
    for (const a of asgs) {
      await q.query(
        `INSERT INTO assignments (id, project_id, employee_id, assigned_by, type, status, decline_reason, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [a.id, a.projectId, a.employeeId, a.assignedBy, a.type, a.status, nn(a.declineReason), ts(a.createdAt), ts(a.updatedAt)]
      );
      bump('assignments');
      for (const d of a.approvalDecisions ?? []) {
        await q.query(
          `INSERT INTO approval_decisions (id, assignment_id, approver_id, decision, comment, decided_at) VALUES ($1,$2,$3,$4,$5,$6)`,
          [d.id, a.id, d.approverId, d.decision, nn(d.comment), d.decidedAt ? ts(d.decidedAt) : null]
        );
      }
    }
    for (const c of src.changeRequests ?? []) {
      await q.query(
        `INSERT INTO change_requests (id, project_id, requested_by, proposed_sessions, conflicts, status, created_at) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,
        [c.id, c.projectId, c.requestedBy, JSON.stringify(c.proposedSessions ?? []), JSON.stringify(c.conflicts ?? []), c.status, ts(c.createdAt)]
      );
      bump('changeRequests');
      for (const d of c.decisions ?? []) {
        await q.query(
          `INSERT INTO change_decisions (id, change_request_id, actor_id, kind, decision, comment, decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [d.id, c.id, d.actorId, d.kind, d.decision, nn(d.comment), d.decidedAt ? ts(d.decidedAt) : null]
        );
      }
    }
    for (const o of src.allowedOverlaps ?? []) {
      await q.query(`INSERT INTO allowed_overlaps (id, employee_id, session_a_id, session_b_id, source, source_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
        o.id, o.employeeId, o.sessionAId, o.sessionBId, o.source, nn(o.sourceId), ts(o.createdAt),
      ]);
      bump('allowedOverlaps');
    }
    for (const n of src.notifications ?? []) {
      await q.query(`INSERT INTO notifications (id, recipient_id, type, title, message, read, link_tab, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        n.id, n.recipientId, n.type, n.title, n.message, !!n.read, nn(n.linkTab), ts(n.createdAt),
      ]);
      bump('notifications');
    }
    for (const l of src.auditLogs ?? []) {
      await q.query(`INSERT INTO audit_logs (id, actor_id, actor_name, action, target_type, target_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        l.id, l.actorId, l.actorName, l.action, l.targetType, l.targetId, l.details, ts(l.createdAt),
      ]);
      bump('auditLogs');
    }

    if (activeAdmins === 0) {
      const email = process.env.ADMIN_EMAIL?.trim();
      const password = process.env.ADMIN_PASSWORD;
      if (email && password && password.length >= 10) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = (await pbkdf2(password, salt, 310_000, 64, 'sha512')).toString('hex');
        const dept = (await q.query(`SELECT id FROM departments ORDER BY name LIMIT 1`)).rows[0]?.id;
        if (!dept) throw new Error('관리자를 만들 부서가 없습니다.');
        await q.query(
          `INSERT INTO users (id, email, name, department_id, role, status, password_salt, password_hash, password_iter)
           VALUES ($1,$2,$3,$4,'ADMIN','ACTIVE',$5,$6,310000)`,
          [`emp-${crypto.randomUUID()}`, email, process.env.ADMIN_NAME?.trim() || '시스템 관리자', dept, salt, hash]
        );
        warnings.push(`활성 관리자가 없어 새 관리자 계정을 만들었습니다: ${email}`);
      } else {
        warnings.push('활성 관리자 계정이 없습니다. ADMIN_EMAIL / ADMIN_PASSWORD(10자 이상)를 설정한 뒤 다시 실행하세요.');
      }
    }
  });

  console.log('가져오기 완료:', counts);
  for (const w of warnings) console.warn('  ! ' + w);
  await db.close();
}

main().catch((e) => {
  console.error('가져오기 실패 (변경 사항 없음):', e.message ?? e);
  process.exit(1);
});
