/**
 * Slack thread context — install-local customization.
 *
 * When a human @mentions the bot inside an existing Slack channel thread, the
 * agent only ever received messages that reached the router: nothing posted
 * before the bot was engaged, and nothing bot-authored (slack-a2a-guard drops
 * all bot inbound at the bridge). So "use the PR list Linear posted above"
 * failed — the agent never saw it.
 *
 * This module fetches the thread from Slack (`conversations.replies`, bot
 * token, channels:history / groups:history scopes) at mention time and
 * attaches the messages that precede the mention to the triggering message
 * as `content.thread_context`. The container formatter renders it as a
 * context-only <thread_context> block. Nothing here admits a bot as a sender
 * or wakes the agent: it only enriches a human mention that the router then
 * gates exactly as before (access gate, sender scope, engage mode).
 *
 * Registered as a router message interceptor that never claims the message.
 * Default Slack instance only (SLACK_BOT_TOKEN). Never throws — a failed fetch
 * routes the mention without context.
 */
import { readEnvFile } from '../../env.js';
import { log } from '../../log.js';
import { registerMessageInterceptor } from '../../router.js';
import type { InboundEvent } from '../../channels/adapter.js';

/** Most recent preceding messages kept. */
export const THREAD_CONTEXT_MAX_MESSAGES = 50;
/** Per-message text cap. */
export const THREAD_CONTEXT_MAX_CHARS = 4000;
/** Total text budget across the attached messages (newest kept). */
export const THREAD_CONTEXT_TOTAL_CHARS = 40_000;

export interface ThreadContextMessage {
  sender: string;
  bot: boolean;
  /** ISO-8601 UTC. */
  time: string;
  text: string;
}

/** Slack user id → display name, process-wide (names rarely change). */
const userCache = new Map<string, string>();

export type SlackApi = (method: string, params: Record<string, string>) => Promise<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collect text leaves from Slack blocks (section / rich_text / context). */
function blockText(blocks: unknown): string {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isRecord(node)) return;
    if (typeof node.text === 'string') parts.push(node.text);
    for (const value of Object.values(node)) if (typeof value === 'object') visit(value);
  };
  visit(blocks);
  return parts.join(' ').trim();
}

/**
 * Readable text of one Slack message. Integrations like Linear often post
 * with empty/fallback `text` and the real content in attachments or blocks.
 */
export function slackMessageText(msg: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof msg.text === 'string' && msg.text.trim()) parts.push(msg.text.trim());
  else if (msg.blocks) parts.push(blockText(msg.blocks));
  for (const att of Array.isArray(msg.attachments) ? msg.attachments : []) {
    if (!isRecord(att)) continue;
    const lines = [att.pretext, att.title, att.title_link, att.text]
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim());
    for (const field of Array.isArray(att.fields) ? att.fields : []) {
      if (isRecord(field) && typeof field.value === 'string') {
        lines.push(typeof field.title === 'string' && field.title ? `${field.title}: ${field.value}` : field.value);
      }
    }
    if (lines.length === 0 && att.blocks) lines.push(blockText(att.blocks));
    if (lines.length === 0 && typeof att.fallback === 'string') lines.push(att.fallback);
    parts.push(...lines.filter(Boolean));
  }
  return parts.join('\n').trim();
}

function tsToIso(ts: string): string {
  const ms = Math.floor(Number(ts) * 1000);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date(0).toISOString();
}

/**
 * Fetch the messages of a Slack thread strictly before `beforeTs`, oldest
 * first, capped. `api` is injectable for tests.
 */
export async function fetchThreadContext(
  api: SlackApi,
  channel: string,
  threadTs: string,
  beforeTs: string,
): Promise<ThreadContextMessage[]> {
  const raw: Record<string, unknown>[] = [];
  let cursor = '';
  // Bounded paging: a thread longer than this keeps only its newest tail anyway.
  for (let page = 0; page < 5; page++) {
    const params: Record<string, string> = { channel, ts: threadTs, limit: '200' };
    if (cursor) params.cursor = cursor;
    const res = await api('conversations.replies', params);
    if (res.ok !== true) throw new Error(`conversations.replies failed: ${String(res.error ?? 'unknown')}`);
    for (const m of Array.isArray(res.messages) ? res.messages : []) if (isRecord(m)) raw.push(m);
    const next = isRecord(res.response_metadata) ? res.response_metadata.next_cursor : undefined;
    if (typeof next !== 'string' || !next) break;
    cursor = next;
  }

  const before = Number(beforeTs);
  const preceding = raw
    .filter((m) => typeof m.ts === 'string' && Number(m.ts) < before)
    .sort((a, b) => Number(a.ts) - Number(b.ts))
    .slice(-THREAD_CONTEXT_MAX_MESSAGES);

  const nameOf = async (userId: string): Promise<string> => {
    const cached = userCache.get(userId);
    if (cached) return cached;
    try {
      const info = await api('users.info', { user: userId });
      const user = isRecord(info.user) ? info.user : undefined;
      const profile = user && isRecord(user.profile) ? user.profile : undefined;
      const candidate = profile?.display_name || profile?.real_name || user?.real_name || user?.name;
      if (typeof candidate === 'string' && candidate) {
        userCache.set(userId, candidate);
        return candidate;
      }
    } catch {
      // fall through to the raw id; not cached, so a later mention retries
    }
    return userId;
  };

  const out: ThreadContextMessage[] = [];
  for (const m of preceding) {
    const text = slackMessageText(m);
    if (!text) continue;
    const bot = typeof m.bot_id === 'string' || m.subtype === 'bot_message';
    const botProfile = isRecord(m.bot_profile) ? m.bot_profile : undefined;
    let sender: string;
    if (bot) {
      sender = String(botProfile?.name || m.username || m.bot_id || 'bot');
    } else if (typeof m.user === 'string') {
      sender = await nameOf(m.user);
    } else {
      sender = 'unknown';
    }
    out.push({
      sender,
      bot,
      time: tsToIso(String(m.ts)),
      text: text.length > THREAD_CONTEXT_MAX_CHARS ? `${text.slice(0, THREAD_CONTEXT_MAX_CHARS)}…` : text,
    });
  }

  // Total budget: keep the newest messages that fit.
  let total = 0;
  let start = out.length;
  while (start > 0 && total + out[start - 1].text.length <= THREAD_CONTEXT_TOTAL_CHARS) {
    total += out[start - 1].text.length;
    start--;
  }
  return out.slice(start);
}

function defaultSlackApi(): SlackApi | null {
  const token = readEnvFile(['SLACK_BOT_TOKEN']).SLACK_BOT_TOKEN;
  if (!token) return null;
  return async (method, params) => {
    const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params).toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    return (await res.json()) as Record<string, unknown>;
  };
}

/**
 * Interceptor body: enrich a human @mention inside an existing Slack channel
 * thread with the thread's preceding messages. Always returns false (never
 * claims the message).
 */
export async function attachSlackThreadContext(event: InboundEvent, apiOverride?: SlackApi): Promise<boolean> {
  try {
    if (event.channelType !== 'slack') return false;
    // Default instance only — named instances carry their own bot tokens.
    if (event.instance && event.instance !== 'slack') return false;
    if (event.message.isMention !== true || event.message.isGroup !== true) return false;
    if (!event.threadId) return false;

    // Thread id shape: slack:<channel>:<threadTs>
    const [, channel, threadTs] = event.threadId.split(':');
    const content = JSON.parse(event.message.content) as Record<string, unknown>;
    const messageTs = event.message.id;
    // A top-level mention starts its own thread — nothing precedes it.
    if (!channel || !threadTs || !messageTs || threadTs === messageTs) return false;
    if (content.thread_context) return false;
    const api = apiOverride ?? defaultSlackApi();
    if (!api) return false;

    const context = await fetchThreadContext(api, channel, threadTs, messageTs);
    if (context.length === 0) return false;
    content.thread_context = context;
    event.message.content = JSON.stringify(content);
    log.info('Attached Slack thread context to mention', {
      platformId: event.platformId,
      threadId: event.threadId,
      messages: context.length,
      botMessages: context.filter((m) => m.bot).length,
    });
  } catch (err) {
    log.warn('Slack thread context fetch failed — routing mention without it', {
      platformId: event.platformId,
      threadId: event.threadId,
      err,
    });
  }
  return false;
}

registerMessageInterceptor((event) => attachSlackThreadContext(event));
