---
name: add-slack-a2a-guard
description: Placeholder so /update-nanoclaw's installed-skill refresh can resolve the slack-a2a-guard barrel import. The guard itself is installed and refreshed by /add-slack. Not user-invocable.
---

# slack-a2a-guard (owned by /add-slack)

`src/channels/slack-a2a-guard.ts` is the Slack bot-inbound guard. `/add-slack`
copies it from the `channels` branch and appends its barrel import, and
refreshes it on every update.

This placeholder exists only because the updater maps every
`src/channels/index.ts` import to an `add-<name>` skill. Its single directive
is idempotent: the line is already present after `/add-slack`.

```nc:append to:src/channels/index.ts
import './slack-a2a-guard.js';
```
