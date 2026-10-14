import { describe, expect, it, vi } from 'vitest';

import type { InboundEvent } from '../../channels/adapter.js';
import { attachSlackThreadContext, slackMessageText, type SlackApi } from './index.js';

const THREAD = '1791976997.847699';
const MENTION = '1791977200.000100';

function mentionEvent(overrides: Partial<InboundEvent['message']> = {}, threadTs = THREAD): InboundEvent {
  return {
    channelType: 'slack',
    platformId: 'slack:C0C97DJCG2V',
    threadId: `slack:C0C97DJCG2V:${threadTs}`,
    message: {
      id: MENTION,
      kind: 'chat-sdk',
      content: JSON.stringify({ text: '<@UBOT> use the PR list above', sender: 'JB' }),
      timestamp: '2026-10-14T10:00:00.000Z',
      isMention: true,
      isGroup: true,
      ...overrides,
    },
  };
}

function fakeApi(): SlackApi & { calls: string[] } {
  const calls: string[] = [];
  const api = (async (method: string) => {
    calls.push(method);
    if (method === 'users.info') return { ok: true, user: { profile: { display_name: 'JB' } } };
    return {
      ok: true,
      messages: [
        { ts: THREAD, user: 'U07TR8Q0P46', text: 'which PRs are still open?' },
        {
          ts: '1791977000.000200',
          bot_id: 'BLINEAR',
          bot_profile: { name: 'Linear' },
          text: '',
          attachments: [{ title: 'Open PRs', text: 'PR-1 fix login\nPR-2 add export' }],
        },
        { ts: MENTION, user: 'U07TR8Q0P46', text: '<@UBOT> use the PR list above' },
        { ts: '1791977300.000300', user: 'U07TR8Q0P46', text: 'a later reply' },
      ],
    };
  }) as unknown as SlackApi & { calls: string[] };
  api.calls = calls;
  return api;
}

describe('slack-thread-context', () => {
  it('attaches preceding thread messages, including bot posts, to a mention in a thread', async () => {
    const event = mentionEvent();
    const claimed = await attachSlackThreadContext(event, fakeApi());

    expect(claimed).toBe(false); // never consumes the message
    const content = JSON.parse(event.message.content);
    expect(content.text).toBe('<@UBOT> use the PR list above'); // user text untouched
    expect(content.thread_context).toEqual([
      { sender: 'JB', bot: false, time: '2026-10-14T11:23:17.847Z', text: 'which PRs are still open?' },
      {
        sender: 'Linear',
        bot: true,
        time: '2026-10-14T11:23:20.000Z',
        text: 'Open PRs\nPR-1 fix login\nPR-2 add export',
      },
    ]);
  });

  it('leaves non-mentions, DMs, top-level mentions and other channels untouched', async () => {
    const cases: InboundEvent[] = [
      mentionEvent({ isMention: false }),
      mentionEvent({ isGroup: false }),
      mentionEvent({}, MENTION), // top-level mention: the message is its own thread root
      { ...mentionEvent(), channelType: 'discord' },
      { ...mentionEvent(), instance: 'slack-research' },
    ];
    for (const event of cases) {
      const before = event.message.content;
      const api = fakeApi();
      expect(await attachSlackThreadContext(event, api)).toBe(false);
      expect(event.message.content).toBe(before);
      expect(api.calls).toEqual([]);
    }
  });

  it('routes the mention unchanged when Slack fails', async () => {
    const event = mentionEvent();
    const before = event.message.content;
    const failing = vi.fn(async () => ({ ok: false, error: 'missing_scope' })) as unknown as SlackApi;
    expect(await attachSlackThreadContext(event, failing)).toBe(false);
    expect(event.message.content).toBe(before);
  });

  it('reads text from blocks when an integration posts no plain text', () => {
    expect(
      slackMessageText({
        text: '',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'PR-3 ready for review' } }],
      }),
    ).toBe('PR-3 ready for review');
  });
});
