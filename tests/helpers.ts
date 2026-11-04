/**
 * Test database provisioning shared by the API tests.
 *
 *  - default: embedded PostgreSQL in a temp dir (no setup needed)
 *  - TEST_DATABASE_ADMIN_URL=postgres://user:pw@host/postgres : every test file gets its own freshly created
 *    database on that server, so the real `pg` driver path is exercised too (CI runs both).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

export interface TestDb {
  env: Record<string, string>;
  cleanup: () => Promise<void>;
}

export async function prepareDatabase(prefix: string): Promise<TestDb> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `schedulesync-${prefix}-`));
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (!adminUrl) {
    return { env: { DATA_DIR: dataDir, DATABASE_URL: '' }, cleanup: async () => fs.rmSync(dataDir, { recursive: true, force: true }) };
  }

  const name = `ss_test_${prefix}_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    env: { DATA_DIR: dataDir, DATABASE_URL: url.toString() },
    cleanup: async () => {
      fs.rmSync(dataDir, { recursive: true, force: true });
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Server harness
// ---------------------------------------------------------------------------------------------
import { spawn, ChildProcess } from 'node:child_process';

export interface TestServer {
  base: string;
  log: () => string;
  call: (method: string, url: string, token?: string | null, body?: unknown) => Promise<{ s: number; j: any }>;
  /** Creates an account through the admin API, activates it with the token from the (dev) console log, signs in. */
  createUser: (admin: string, name: string, email: string, role: string, departmentId: string) => Promise<{ token: string; id: string }>;
  stop: () => Promise<void>;
}

export async function startServer(db: TestDb, extraEnv: Record<string, string> = {}): Promise<TestServer> {
  const port = 3300 + Math.floor(Math.random() * 600);
  const base = `http://127.0.0.1:${port}`;
  let logBuf = '';
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'Admin12345',
      APP_URL: 'http://app.test',
      SMTP_HOST: '',
      SLACK_BOT_TOKEN: '',
      ...db.env,
      ...extraEnv,
    },
  });
  child.stdout!.on('data', (d) => (logBuf += d));
  child.stderr!.on('data', (d) => (logBuf += d));

  let up = false;
  for (let i = 0; i < 200 && !up; i++) {
    try {
      await fetch(base + '/api/health');
      up = true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!up) {
    child.kill('SIGTERM');
    throw new Error('server did not start:\n' + logBuf);
  }

  const call: TestServer['call'] = async (method, url, token, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let j: any = {};
    try {
      j = await r.json();
    } catch {}
    return { s: r.status, j };
  };

  return {
    base,
    log: () => logBuf,
    call,
    async createUser(admin, name, email, role, departmentId) {
      const c = await call('POST', '/api/admin/employees', admin, { name, email, role, departmentId });
      if (c.s !== 200) throw new Error(`create ${email}: ${JSON.stringify(c.j)}`);
      const re = new RegExp(`to=${email.replace(/\./g, '\\.')}[\\s\\S]*?토큰: ([0-9a-f]{64})`, 'g');
      let m: RegExpExecArray | null;
      let token = '';
      while ((m = re.exec(logBuf))) token = m[1];
      const password = `Passw0rd-${name}`;
      await call('POST', '/api/auth/password-reset-confirm', null, { token, newPassword: password });
      const l = await call('POST', '/api/auth/login', null, { email, password });
      if (l.s !== 200) throw new Error(`login ${email}: ${JSON.stringify(l.j)}`);
      return { token: l.j.token, id: l.j.user.id };
    },
    async stop() {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
    },
  };
}
