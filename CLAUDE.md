# CLAUDE.md

VS Code extension that shows Claude CLI sessions as a sidebar tree, grouped by ticket. Sessions run in real editor terminals. No webviews, no Claude VS Code panel.

## Commands

```bash
npm test            # vitest unit tests (test/unit)
npm run typecheck   # tsc --noEmit
npm run build       # esbuild bundle to dist/extension.js
npm run package     # build + .vsix
code --install-extension djaunt-overseer-<version>.vsix --force
```

F5 opens the Extension Development Host. Cmd+R reloads only there; in normal VS Code use **Developer: Reload Window**.

## Layout

| File | Job |
| --- | --- |
| `extension.ts` | Activate. Wires index, live monitor, registry, tree, commands. |
| `indexer.ts` | Streams `~/.claude/projects/*/*.jsonl` into `SessionMeta`: title, cwd, branch, repos touched. |
| `indexCache.ts` | Cache keyed by path + mtime + size. Bump `CACHE_SCHEMA_VERSION` when `SessionMeta` changes. |
| `sessionIndex.ts` | Holds the current index and refreshes it on file changes. |
| `gitRoots.ts` | Directory to git root, memoized. Worktrees map to the main repo. |
| `liveParse.ts` / `liveSessions.ts` | `claude agents --json` plus a watch on `~/.claude/sessions` for busy/idle status. |
| `registry.ts` | globalState: pinned ids, user groups, assignments, labels, pending sessions, group and session order. One key per field so two windows don't clobber each other. |
| `grouping.ts` | Pure: builds the group list. User groups, then ticket groups, then Ungrouped, then the saved order on top. |
| `reorder.ts` | Pure: drag reorder (`moveBeside`) and saved-order sort. |
| `tree.ts` | TreeDataProvider and drag-and-drop. |
| `terminals.ts` | Launch, find, suspend, slash commands. Terminals `exec claude`, so the terminal pid is Claude's pid. |
| `commands.ts` | Every command handler. |
| `linkCandidates.ts` | Pure: scans a transcript for PR, ticket, and artifact links with signals. Resumes from a byte offset. |
| `linkJudge.ts` | Builds an 8 KB digest and runs a headless `claude -p` judge that sorts links into owned, touched, irrelevant. |
| `linkCache.ts` | Scan and verdict caches in globalStorage. |
| `linkView.ts` | Pure: link filters, URLs, labels, icon names, busy-to-idle detection, concurrency limiter. |
| `scripts/link-icons.mjs` | Writes the themed Lucide SVGs in `media/links`. Rerun after changing an icon or color. |
| `sessionLinks.ts` | Scans on first view and 60s after busy-to-idle. Judges on expand, at most 2 at once. |
| `sessionSummary.ts` / `sessionSummaries.ts` | Hover summary: newest of Claude Code's recap (`away_summary`) and an on-click Haiku summary of the transcript tail. |
| `linkStatus.ts` / `linkStatusService.ts` | PR state via `gh`, ticket status via `acli`. Five-minute cache, at most 4 calls at once, on-screen links only. |
| `quickPick.ts` / `repoFilter.ts` | All Sessions picker and the `repo:` filter. |

## Rules

- No runtime dependencies. Node built-ins and the `vscode` API only.
- Dev dependencies are pinned to exact versions released at least 7 days ago. Check with `npm view <pkg> time`.
- Claude's transcript and `~/.claude/sessions` formats are undocumented. Parse defensively, skip what doesn't parse, never throw.
- Send slash commands only when the session is idle. Typed input is lost while Claude is busy.
- Never resume a session that is live elsewhere. Two processes on one transcript corrupt it. Offer a fork.
- Session names reach the shell. Quote with `quoteForShell` and strip newlines.
- Keep logic that can be pure in pure modules (`grouping`, `reorder`, `repoFilter`, `liveParse`, `ticket`, `linkCandidates`, `linkView`, `linkStatus`) and test it there. `vscode` can't be imported in unit tests.
- New commands need an entry in `contributes.commands`, a menu `when` clause, and `"when": "false"` under `commandPalette` if they need a tree node.

## Site

`docs/` is the GitHub Pages site (served from `main` `/docs`). React, Babel, and Tailwind come from pinned CDN versions; keep the 7-day rule there too. Brand rules are in `DESIGN.md`. When the version changes, update `VSIX_NAME` in `docs/index.html` and the README install commands.

## Release

1. `npm version <x.y.z> --no-git-tag-version`.
2. Update the version in `README.md` and `VSIX_NAME` in `docs/index.html`.
3. `npm run package`.
4. Commit, push, then `gh release create v<x.y.z> djaunt-overseer-<x.y.z>.vsix`.
