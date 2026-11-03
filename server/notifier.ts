/**
 * Outbound notifications.
 *
 * Delivery order for a person identified by their company e-mail address:
 *   1. Slack DM  (SLACK_BOT_TOKEN set)  - the address is resolved with users.lookupByEmail
 *   2. SMTP      (SMTP_HOST set)        - used when Slack is not configured or Slack delivery failed
 *   3. console   (non-production only)  - so local development works without any integration
 *
 * Environment is read lazily because this module is imported before dotenv has run.
 */
import nodemailer, { type Transporter } from 'nodemailer';

export type Channel = 'slack' | 'smtp' | 'console' | 'none';
export interface DeliveryResult {
  ok: boolean;
  channel: Channel;
  error?: string;
}

const isProduction = () => process.env.NODE_ENV === 'production';
const slackApi = () => (process.env.SLACK_API_URL || 'https://slack.com/api').replace(/\/$/, '');
const slackToken = () => process.env.SLACK_BOT_TOKEN;

export const slackConfigured = () => !!slackToken();
export const smtpConfigured = () => !!process.env.SMTP_HOST;

/** Slack mrkdwn treats &, < and > as control characters (mentions such as <!channel>). */
export function slackEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------------------------
const slackIdCache = new Map<string, string>();
// Serialise Slack calls so bursts (e.g. all approvers notified at once) stay within rate limits.
let slackQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = slackQueue.then(task, task);
  slackQueue = run.catch(() => undefined);
  return run;
}

async function slackCall(method: string, params: Record<string, unknown>, form = false, retries = 2): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Bearer ${slackToken()}` };
  let body: string;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(params as Record<string, string>).toString();
  } else {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    body = JSON.stringify(params);
  }
  const res = await fetch(`${slackApi()}/${method}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
  if (res.status === 429 && retries > 0) {
    const wait = Math.min(parseInt(res.headers.get('retry-after') || '1', 10) || 1, 30);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return slackCall(method, params, form, retries - 1);
  }
  if (!res.ok) throw new Error(`slack http ${res.status}`);
  return res.json();
}

async function resolveSlackUser(email: string): Promise<string> {
  const key = email.toLowerCase();
  const cached = slackIdCache.get(key);
  if (cached) return cached;
  const r = await slackCall('users.lookupByEmail', { email }, true);
  if (!r.ok) throw new Error(r.error === 'users_not_found' ? 'Slack에서 해당 이메일의 사용자를 찾을 수 없음' : `slack ${r.error}`);
  slackIdCache.set(key, r.user.id);
  return r.user.id;
}

async function sendSlackDM(email: string, subject: string, text: string): Promise<void> {
  const userId = await resolveSlackUser(email);
  const r = await slackCall('chat.postMessage', {
    channel: userId, // posting to a user id opens the app's DM with that person
    text: `*${slackEscape(subject)}*\n${slackEscape(text)}`,
    unfurl_links: false,
    unfurl_media: false,
  });
  if (!r.ok) throw new Error(`slack ${r.error}`);
}

// ---------------------------------------------------------------------------------------------
// SMTP (optional fallback)
// ---------------------------------------------------------------------------------------------
let transport: Transporter | null | undefined;

function smtp(): Transporter | null {
  if (transport === undefined) {
    transport = smtpConfigured()
      ? nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587', 10),
          secure: process.env.SMTP_SECURE === 'true',
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        })
      : null;
  }
  return transport;
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/** Delivers a message to one person. Never throws; the result says what happened. */
export async function deliver(email: string, subject: string, text: string): Promise<DeliveryResult> {
  let lastError: string | undefined;

  if (slackConfigured()) {
    try {
      await enqueue(() => sendSlackDM(email, subject, text));
      return { ok: true, channel: 'slack' };
    } catch (e: any) {
      lastError = e?.message || String(e);
      console.error(`[notify] Slack DM 실패 (to: ${email}): ${lastError}`);
    }
  }

  const mailer = smtp();
  if (mailer) {
    try {
      await mailer.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: email, subject, text });
      return { ok: true, channel: 'smtp' };
    } catch (e: any) {
      lastError = e?.message || String(e);
      console.error(`[notify] 메일 발송 실패 (to: ${email}): ${lastError}`);
    }
  }

  if (!slackConfigured() && !mailer) {
    if (isProduction()) {
      console.warn(`[notify] Slack/SMTP 미설정 - "${subject}" 발송 생략 (to: ${email})`);
      return { ok: false, channel: 'none', error: '알림 채널(Slack/SMTP)이 설정되지 않았습니다.' };
    }
    console.log(`[notify:dev] to=${email}\nsubject=${subject}\n${text}\n`);
    return { ok: false, channel: 'console', error: '개발 모드: 콘솔에만 출력됨' };
  }
  return { ok: false, channel: 'none', error: lastError };
}

/**
 * Best-effort business notification (assignment requested, approval needed, ...).
 * Only goes out over Slack; without it the in-app inbox is the only channel.
 */
export function notifyDM(email: string | undefined, title: string, message: string): void {
  if (!email || !slackConfigured() || process.env.SLACK_NOTIFY_EVENTS === 'false') return;
  const link = (process.env.APP_URL || '').replace(/\/$/, '');
  const text = link ? `${message}\n${link}` : message;
  enqueue(() => sendSlackDM(email, title, text)).catch((e) =>
    console.error(`[notify] 업무 알림 DM 실패 (to: ${email}): ${e?.message || e}`)
  );
}

/** Startup self-check so a wrong token is noticed immediately instead of on the first invitation. */
export async function verifySlack(): Promise<void> {
  if (!slackConfigured()) return;
  try {
    const r = await slackCall('auth.test', {});
    if (r.ok) console.log(`[notify] Slack 연결 확인: ${r.team || ''} / ${r.user || ''}`);
    else console.error(`[notify] Slack 토큰 검증 실패: ${r.error}`);
  } catch (e: any) {
    console.error(`[notify] Slack 연결 실패: ${e?.message || e}`);
  }
}
