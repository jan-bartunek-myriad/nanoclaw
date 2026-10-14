---
name: add-slack-a2a
description: Placeholder so /update-nanoclaw's installed-skill refresh can resolve the slack-a2a barrel import. The module is installed by /slack-a2a-rooms. Not user-invocable.
---

# slack-a2a (owned by /slack-a2a-rooms)

`src/channels/slack-a2a.ts` is the bot-inbound admission policy (allowlisted
rooms via `SLACK_A2A_ROOMS`). `/slack-a2a-rooms` installs it — re-run that skill
to pick up a newer copy.

This placeholder exists only because the updater maps every
`src/channels/index.ts` import to an `add-<name>` skill. Its single directive
is idempotent: the line is already present after `/slack-a2a-rooms`.

```nc:append to:src/channels/index.ts
import './slack-a2a.js';
```
