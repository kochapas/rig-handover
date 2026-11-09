# 0004 · Issues on GitHub, or as files when GitHub's can't be reached

- Status: accepted · 2026-10-26
- Amends: 0002 (work is issues)

## Context

Work is issues (ADR 0002). Not every lane can reach GitHub issues: no `gh`, a sandbox without
network to the API, a token without the issues scope. Without them the split ends up in chat,
and chat vanishes with the session, which 0002 was written to stop.

## Decision

1. **GitHub issues first.** Split with the skill `plan-to-issues` (`gh`). No `gh`, but GitHub
   reachable some other way (a GitHub connector, the REST API, the web UI)? Same issues, created
   that way.
2. **Files only when GitHub issues can't be made at all.** The same split, the same human
   review, written to `docs/issues/` and pushed.
3. **One place per plan, never both.** Once a plan has issues on GitHub, `docs/issues/` is not
   used for it. Don't keep a copy of the other.

### Issues as files

One file per issue: `docs/issues/<NNN>-<slug>.md`. `NNN` is the issue number, three digits, from
`001`, never reused. It is what `#n` means in `Blocked by` and in commit messages.

YAML frontmatter holds what GitHub would hold for the issue. The body is what the issue would
say on GitHub, word for word.

| Field | Value |
|-------|-------|
| `id` | the number, same as `NNN` |
| `title` | quoted string |
| `state` | `open` or `closed` |
| `labels` | list (may be empty) |
| `created` | ISO 8601 with time zone |
| `closed` | ISO 8601, or `null` while open |

```md
---
id: 3
title: "Digest page: GET /digest/:night"
state: open
labels: []
created: 2026-10-29T14:20:00+01:00
closed: null
---

<the issue body: whatever this repo's issues carry>
```

Closing it: `state: closed`, `closed: <time>`, then the closing comment from AGENTS.md under its
own heading at the end of the file:

```md
## Closing comment

done: GET /digest/:night renders the rows
worker: <harness> · <model> · <effort>
commit: 4f2a9c1
```

- **The default branch is the tracker.** An issue's state is what the default branch says.
  A change sitting on a branch or only on your machine hasn't happened for anyone else. Commit and
  push every change: `issue #3: open <title>` / `issue #3: close`.
- Frontmatter discipline (agents break it most): one opening and one closing `---`, every key once
  and in lower case, quote any value with a `:` or a `#`, lists as `[a, b]`, no tabs. Change a
  key in place, never append a second one.
- Nothing else in `docs/issues/` is an issue. A file that isn't `<NNN>-<slug>.md` with frontmatter
  doesn't count.

## Considered

- **Issues in one file (`ISSUES.md`):** every agent edits the same file, and parallel workers
  conflict on every close.
- **`Status:` lines in the body instead of frontmatter:** easy to write, easy to write twice. The
  frontmatter is the one place a parser looks.
- **A tracker tool or format of its own:** another install in every lane. Plain Markdown + YAML
  reads and diffs anywhere.

## Consequences

- No lane is left without issues. A lane without GitHub issues still splits, reviews, and hands
  off through files.
- Moving to GitHub later is one command per file: frontmatter → `--title` / `--label`, body →
  `--body-file`.
- History lives in git: who opened or closed what, and when, is in `git log docs/issues/`.
- Two trackers for one plan would drift, so rule 3 forbids it.
