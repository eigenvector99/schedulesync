-- ScheduleSync schema v1

CREATE TABLE departments (
  id               text PRIMARY KEY,
  name             text NOT NULL UNIQUE,
  head_employee_id text            -- FK added below (users <-> departments are mutually dependent)
);

CREATE TABLE users (
  id                     text PRIMARY KEY,
  email                  text NOT NULL,
  name                   text NOT NULL,
  department_id          text NOT NULL REFERENCES departments(id),
  role                   text NOT NULL CHECK (role IN ('EMPLOYEE', 'APPROVER', 'ADMIN')),
  status                 text NOT NULL CHECK (status IN ('ACTIVE', 'INVITED', 'DISABLED')),
  timezone               text NOT NULL DEFAULT 'Asia/Seoul',
  avatar_color           text,
  password_salt          text NOT NULL,
  password_hash          text NOT NULL,
  password_iter          integer,          -- NULL = legacy 1,000 iteration hash (upgraded on next login)
  reset_token_hash       text,
  reset_token_expires_at timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
CREATE INDEX users_reset_token_idx ON users (reset_token_hash) WHERE reset_token_hash IS NOT NULL;

ALTER TABLE departments
  ADD CONSTRAINT departments_head_fk FOREIGN KEY (head_employee_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE auth_tokens (
  token_hash text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id);

CREATE TABLE projects (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by  text NOT NULL REFERENCES users(id),
  start_date  text NOT NULL CHECK (start_date ~ '^\d{4}-\d{2}-\d{2}$'),
  end_date    text NOT NULL CHECK (end_date ~ '^\d{4}-\d{2}-\d{2}$' AND end_date >= start_date),
  status      text NOT NULL CHECK (status IN ('PLANNING', 'RECRUITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  headcount   integer CHECK (headcount IS NULL OR headcount > 0),
  color       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_created_by_idx ON projects (created_by);

CREATE TABLE sessions (
  id           text PRIMARY KEY,
  project_id   text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position     integer NOT NULL DEFAULT 0,
  title        text NOT NULL DEFAULT '',
  start_at     text,                 -- kept verbatim (ISO string) because the client treats it as opaque
  end_at       text,
  rrule        text,
  days_of_week integer[],
  start_time   text,
  end_time     text,
  timezone     text NOT NULL DEFAULT 'Asia/Seoul'
);
CREATE INDEX sessions_project_idx ON sessions (project_id, position);

CREATE TABLE assignments (
  id             text PRIMARY KEY,
  project_id     text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id    text NOT NULL REFERENCES users(id),
  assigned_by    text NOT NULL REFERENCES users(id),
  type           text NOT NULL CHECK (type IN ('SELF', 'APPROVER', 'EMPLOYEE')),
  status         text NOT NULL CHECK (status IN
                   ('EMPLOYEE_PENDING', 'APPROVAL_PENDING', 'APPROVED', 'DECLINED', 'REJECTED', 'WITHDRAWN', 'RELEASED')),
  decline_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- An employee can hold at most one live assignment per project, enforced by the database itself.
CREATE UNIQUE INDEX assignments_one_live_per_project
  ON assignments (project_id, employee_id)
  WHERE status IN ('EMPLOYEE_PENDING', 'APPROVAL_PENDING', 'APPROVED');
CREATE INDEX assignments_employee_idx ON assignments (employee_id);

CREATE TABLE approval_decisions (
  id            text PRIMARY KEY,
  assignment_id text NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  approver_id   text NOT NULL REFERENCES users(id),
  decision      text NOT NULL CHECK (decision IN ('PENDING', 'APPROVED', 'REJECTED')),
  comment       text,
  decided_at    timestamptz,
  UNIQUE (assignment_id, approver_id)
);
CREATE INDEX approval_decisions_approver_idx ON approval_decisions (approver_id);

CREATE TABLE change_requests (
  id                text PRIMARY KEY,
  project_id        text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by      text NOT NULL REFERENCES users(id),
  proposed_sessions jsonb NOT NULL,
  conflicts         jsonb NOT NULL DEFAULT '[]',
  status            text NOT NULL CHECK (status IN ('CHANGE_PENDING', 'CHANGE_APPROVED', 'CHANGE_REJECTED', 'CHANGE_WITHDRAWN')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE change_decisions (
  id                text PRIMARY KEY,
  change_request_id text NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  actor_id          text NOT NULL REFERENCES users(id),
  kind              text NOT NULL CHECK (kind IN ('APPROVAL', 'CONSENT', 'BOTH')),
  decision          text NOT NULL CHECK (decision IN ('PENDING', 'APPROVED', 'REJECTED')),
  comment           text,
  decided_at        timestamptz,
  UNIQUE (change_request_id, actor_id)
);
CREATE INDEX change_decisions_actor_idx ON change_decisions (actor_id);

-- Session ids are regenerated when a schedule is replaced, so these deliberately carry no FK.
CREATE TABLE allowed_overlaps (
  id           text PRIMARY KEY,
  employee_id  text NOT NULL REFERENCES users(id),
  session_a_id text NOT NULL,
  session_b_id text NOT NULL,
  source       text NOT NULL,
  source_id    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX allowed_overlaps_employee_idx ON allowed_overlaps (employee_id);

CREATE TABLE notifications (
  id           text PRIMARY KEY,
  recipient_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         text NOT NULL,
  title        text NOT NULL,
  message      text NOT NULL,
  read         boolean NOT NULL DEFAULT false,
  link_tab     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_recipient_idx ON notifications (recipient_id, created_at DESC);

CREATE TABLE audit_logs (
  id          text PRIMARY KEY,
  actor_id    text NOT NULL,        -- no FK: the log must outlive any user row
  actor_name  text NOT NULL,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text NOT NULL,
  details     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- The audit log is append-only.
CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
