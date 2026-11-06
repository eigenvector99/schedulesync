/**
 * "Sign in with Slack" (OpenID Connect, authorization-code flow).
 *
 * Environment is read lazily (this module is imported before dotenv has run).
 *   SLACK_CLIENT_ID / SLACK_CLIENT_SECRET   enable the feature
 *   SLACK_TEAM_ID                           optional but recommended: only this workspace may sign in
 *   SLACK_REDIRECT_URI                      defaults to ${APP_URL}/api/auth/slack/callback
 *   SLACK_AUTH_URL / SLACK_API_URL          endpoints, overridable for tests
 */

export class SsoError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

export interface SlackIdentity {
  slackUserId: string;
  email: string;
  name?: string;
  teamId?: string;
}

export const ssoEnabled = () => !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);

const authUrl = () => process.env.SLACK_AUTH_URL || 'https://slack.com/openid/connect/authorize';
const apiUrl = () => (process.env.SLACK_API_URL || 'https://slack.com/api').replace(/\/$/, '');

export const redirectUri = (appUrl: string) => process.env.SLACK_REDIRECT_URI || `${appUrl}/api/auth/slack/callback`;

export function buildAuthorizeUrl(opts: { state: string; nonce: string; appUrl: string }): string {
  const u = new URL(authUrl());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('client_id', process.env.SLACK_CLIENT_ID!);
  u.searchParams.set('redirect_uri', redirectUri(opts.appUrl));
  u.searchParams.set('state', opts.state);
  u.searchParams.set('nonce', opts.nonce);
  if (process.env.SLACK_TEAM_ID) u.searchParams.set('team', process.env.SLACK_TEAM_ID);
  return u.toString();
}

function decodeJwtPayload(jwt: unknown): Record<string, any> {
  if (typeof jwt !== 'string') throw new SsoError('invalid_id_token');
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new SsoError('invalid_id_token');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    throw new SsoError('invalid_id_token');
  }
}

/**
 * Exchanges the authorization code and returns the verified identity.
 *
 * The id_token comes straight from Slack's token endpoint over TLS, in answer to a request that carries our client
 * secret; OpenID Connect Core 3.1.3.7 allows relying on that channel instead of checking the JWT signature. We still
 * validate issuer, audience, expiry and the nonce, require a verified e-mail and (when configured) the workspace.
 */
export async function exchangeCodeForIdentity(code: string, expectedNonce: string, appUrl: string): Promise<SlackIdentity> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}/openid.connect.token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code,
        redirect_uri: redirectUri(appUrl),
        grant_type: 'authorization_code',
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e: any) {
    throw new SsoError('slack_unreachable', e?.message);
  }
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok || !body.id_token) throw new SsoError('token_exchange_failed', body?.error);

  const claims = decodeJwtPayload(body.id_token);
  const nowSec = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== 'https://slack.com' || !aud.includes(process.env.SLACK_CLIENT_ID)) throw new SsoError('invalid_id_token');
  if (typeof claims.exp !== 'number' || claims.exp < nowSec - 30) throw new SsoError('invalid_id_token');
  if (!claims.nonce || claims.nonce !== expectedNonce) throw new SsoError('invalid_id_token', 'nonce mismatch');

  const teamId: string | undefined = claims['https://slack.com/team_id'] ?? claims.team_id;
  if (process.env.SLACK_TEAM_ID && teamId !== process.env.SLACK_TEAM_ID) throw new SsoError('wrong_workspace');

  const email = typeof claims.email === 'string' ? claims.email.trim() : '';
  if (!email) throw new SsoError('no_email');
  if (claims.email_verified === false) throw new SsoError('email_unverified');

  const slackUserId: string | undefined = claims['https://slack.com/user_id'] ?? claims.sub;
  if (!slackUserId) throw new SsoError('invalid_id_token');
  return { slackUserId, email, name: claims.name, teamId };
}
