---
name: wiki
description: Maintain the user's knowledge wiki at /workspace/extra/wiki (Karpathy LLM Wiki pattern). Use when the user shares a source (link, PDF, office doc, notes, transcript, Slack thread summary), says "ingest", "add to the wiki", "what do we know about…", asks a question the wiki may answer, or asks for a wiki lint / health check.
---

# Wiki — schema and workflows

The wiki is a persistent, compounding knowledge base. You are its maintainer: the user curates
sources and asks questions; you do all summarizing, cross-referencing, filing and bookkeeping.

Root: `/workspace/extra/wiki`. The folder may be synced to the user's cloud storage (see your
standing instructions) — the user may add or read files there directly.

```
sources/              raw, immutable — read, never edit content
  web/ pdf/ docs/ notes/ slack/
wiki/                 you own this entirely
  index.md            catalog of every page — update on every change
  log.md              append-only history
  overview.md         high-level map of what the wiki knows
  sources/            one summary page per ingested source
  entities/           people, teams, customers, partners, products, projects
  concepts/           topics, processes, decisions, terminology, themes
  syntheses/          comparisons, analyses, filed-back answers
```

## Conventions

- **File names**: lowercase-kebab-case `.md` (`acme-corp.md`, `q3-pricing-decision.md`). Raw sources keep a
  readable name prefixed with the date added: `sources/pdf/2026-10-09-acme-msa.pdf`.
- **Links**: Obsidian wikilinks relative to `wiki/` — `[[entities/acme-corp]]`, `[[concepts/pricing]]`.
  Every page links to related pages; every claim traces to a source page.
- **Frontmatter** on every wiki page:
  ```yaml
  ---
  type: source | entity | concept | synthesis
  tags: [customer, pricing]
  sources: [sources/2026-10-09-acme-msa]   # wiki source pages backing this page
  updated: 2026-10-09
  ---
  ```
  Source pages also carry `raw: sources/pdf/2026-10-09-acme-msa.pdf`, `date:` (of the document itself
  when known), and `author:`/`origin:` where relevant.
- **Citations**: inline as `([[sources/2026-10-09-acme-msa]])` after the claim.
- **Contradictions**: never silently overwrite. Keep both claims with citations under a
  `> [!warning] Contradiction` callout, note which is newer, and mention it to the user.
- **Dates matter**: work facts go stale. Prefer "as of <date>" phrasing for status, numbers, owners.
- **Native Google Docs/Sheets/Slides don't sync as files** — if the user says a doc is in the synced folder but you can't
  see it, ask them to upload it as .docx/.pdf/.xlsx instead.
- Ignore sync artifacts (`*.conflict*`, `*..path1`, `*..path2`) except to report them during lint.

## Getting full source text

Store the complete original in `sources/` — never a summary.

- **Web pages / links**: do not rely on WebFetch (it returns a summary). Download the real thing:
  - PDF or file URL: `curl -sL -o sources/pdf/<date>-<name>.pdf "<url>"`
  - HTML article: fetch full text (curl + extract, or `agent-browser` for JS-heavy / logged-in-looking pages)
    and save as markdown in `sources/web/<date>-<name>.md` with the URL and fetch date at the top.
- **Files sent in chat** arrive under `/workspace/inbox/<message-id>/` — copy them into the right `sources/` subfolder.
- **Files the user drops in the synced folder** land in `sources/` (often the root) — move them into the right subfolder
  (moving is fine; never edit content).
- **PDFs / office docs** (docx, pptx, xlsx, …): keep the original in `sources/`, convert a working copy
  to Markdown with `anydoc` per the `convert-documents-to-markdown` skill, and read that. Scanned/image-only
  PDFs need OCR and won't convert — tell the user rather than guessing at content. Spreadsheet Markdown is not
  authoritative for calculations; cite the original file for numbers that matter.
- **Pasted notes, transcripts, Slack thread summaries**: save verbatim as
  `sources/notes/<date>-<name>.md` or `sources/slack/<date>-<channel-or-topic>.md`, with who/when/where
  at the top.

## Ingest

**One source at a time. Always.** If the user gives several files or points at a folder, process them
sequentially — fully finish one (every step below) before opening the next. Never read a batch
up front and then write pages for all of them; that produces shallow, generic pages.

For each source:
1. Save the raw original into `sources/` (see above). Read it completely.
2. Read `wiki/index.md` and the existing pages it touches, so you integrate rather than duplicate.
3. Tell the user the key takeaways in a few lines; ask only if something is genuinely ambiguous
   (e.g. which project a doc belongs to). Otherwise proceed.
4. Write `wiki/sources/<date>-<name>.md`: summary, key facts/decisions/numbers, people involved,
   open questions, links to entities/concepts.
5. Create or update every affected entity and concept page — add the new facts with citations,
   revise summaries, update "as of" status, flag contradictions. A single source commonly touches
   5–15 pages.
6. Update `wiki/index.md` (new pages, revised one-liners) and `wiki/overview.md` if the big picture moved.
7. Append to `wiki/log.md`: `## [YYYY-MM-DD] ingest | <title>` + 1–3 lines on what changed.
8. Report to the user briefly: what was added, pages created/updated, any contradictions or gaps.

## Query

1. Read `wiki/index.md` first, then the relevant pages; fall back to `grep -ri` across `wiki/`
   and then `sources/` if needed.
2. Answer with citations to wiki pages (and through them, sources). Say clearly when the wiki
   doesn't know something rather than filling in from general knowledge — or label general
   knowledge as such.
3. If the answer is a reusable analysis (comparison, timeline, decision summary), offer to file it
   as `wiki/syntheses/<name>.md` — or just do it when the user asks for something worth keeping.
   Update index and log (`## [date] query | <question>`) when you file one.

## Lint

Health check, run on request or on schedule. Check for:
- contradictions between pages; stale "as of" claims superseded by newer sources
- orphan pages (no inbound links) and broken `[[links]]`
- entities/concepts mentioned in several pages but lacking their own page
- pages missing frontmatter or citations; index entries out of sync with files
- un-ingested files sitting in `sources/` and sync conflict files

Fix the mechanical issues directly (links, index, frontmatter). For substantive issues
(contradictions, gaps), list them for the user with suggested sources or questions to pursue.
Append `## [date] lint | <summary>` to the log. Keep the report to the user short.
