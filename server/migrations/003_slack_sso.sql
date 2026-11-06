-- Sign in with Slack
ALTER TABLE users ADD COLUMN slack_user_id text;   -- bound on the first Slack login; later logins must present the same id
CREATE UNIQUE INDEX users_slack_user_id_key ON users (slack_user_id) WHERE slack_user_id IS NOT NULL;

-- Authorization requests in flight (CSRF `state`, replay-protecting `nonce`); one use, ten minutes.
CREATE TABLE oauth_states (
  state_hash   text PRIMARY KEY,
  binding_hash text NOT NULL,       -- hash of the value kept in the browser's cookie: ties the callback to the browser that started the flow
  nonce        text NOT NULL,
  expires_at   timestamptz NOT NULL
);

-- One-time codes that hand the finished login from the redirect over to the single-page app (no token in URLs).
CREATE TABLE login_codes (
  code_hash  text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
