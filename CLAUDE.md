# CLAUDE.md

VS Code extension that shows Claude CLI sessions as a sidebar tree in user groups, plus a Session sidebar for the focused session's work. Sessions run in real editor terminals, never in webviews or the Claude VS Code panel.

## Commands

```bash
npm test            # vitest unit tests (test/unit)
npm run typecheck   # tsc --noEmit
npm run build       # esbuild bundles to dist/extension.js
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
| `grouping.ts` | Pure: builds the group list. User groups, then Ungrouped, then the saved order on top. |
| `reorder.ts` | Pure: drag reorder (`moveBeside`) and saved-order sort. |
| `tree.ts` | TreeDataProvider and drag-and-drop. |
| `terminals.ts` | Launch, find, suspend, slash commands. Terminals `exec claude`, so the terminal pid is Claude's pid. |
| `commands.ts` | Every command handler. |
| `linkCandidates.ts` | Pure: scans a transcript for PR, ticket, artifact, and commit candidates with signals, titles, and the nearest user prompt. Counts user prompts by offset. Resumes from a byte offset. |
| `candidateEnrichment.ts` | Pure: attaches cached PR and ticket status (title, branch, state, summary, parent) to scanned candidates. |
| `claudeRunner.ts` | Shared headless `claude -p` runner and its flags (`--json-schema` included). |
| `linkCache.ts` | The scan cache in globalStorage, and the versioned cache file helpers. |
| `linkView.ts` | Pure: link URLs, display ids, a row link from an item key, concurrency limiter. |
| `scripts/link-icons.mjs` | Writes the themed Lucide SVGs in `media/links`. Rerun after changing an icon or color. |
| `transcriptLines.ts` | Reads complete transcript lines from a byte offset, and one line back from its end offset. |
| `analysisState.ts` | Pure: per-session analysis state (workstreams, artifact titles, where lines, derived status, watermark) and its defensive reader. |
| `workstreamEdits.ts` | Pure: the user's workstream edits (`overseer.workstreamEdits.v2`): renames, pins (to a workstream or Unsorted), done, order. The merge applies them last. Removals come from link marks via `withLinkMarkRemovals`. |
| `workstreamDisplay.ts` | Pure: the Session sidebar's groups from analysis plus edits: saved order, then active newest, then done; Unsorted; Removed; empty state; drop targets. |
| `legacyDeclarations.ts` | Pure: readers for the old agent-written `declared/`, `work/`, and `where/` files. Only the seed uses them; the files stay on disk. |
| `analysisSeed.ts` | Pure: first analysis state from the old declared files and link marks. |
| `analysisStore.ts` | Reads and writes `~/.claude/overseer/analysis/<sid>.json` and the old declared files for the seed. |
| `analyzerDigest.ts` | Pure: the analyzer's model input. State, items oldest first with first-seen times and the prompt that began their stretch of work, transcript with timestamped prompts kept first, overlap prompt. 16 KB diff, 64 KB recheck. |
| `analyzerOps.ts` | Pure: the analyzer's op schema, system prompt, strict parser, and `applyOps`. |
| `analyzerPass.ts` | One analyzer pass with an injected runner; a diff reply that fails the schema retries on the recheck model. `planAnalyzerPass` gives a first pass a recheck digest on the diff model. |
| `sessionAnalyzer.ts` | Runs analyzer passes (2 at once, 1 per session) under a cross-window lock, seeds on first read, copies state on `/clear` and fork. `autoAnalyze` checks the gates, then again under the lock. Logs with `[analyzer]`. |
| `analyzerGates.ts` | Pure: the `overseer.analyzer.*` gate settings and `shouldAutoAnalyze`: auto on, not in flight, new prompts, new KB or a new link, cooldown. |
| `analysisLock.ts` | `<sid>.lock` beside the analysis file: exclusive create with pid and time. Stale after 5 minutes or a dead pid. |
| `liveTransitions.ts` | Pure: busy-to-idle and left-idle sessions between two live status maps. |
| `analyzerTrigger.ts` | Starts an `idleSeconds` timer on busy to idle, cancels it on busy or end, then calls `autoAnalyze`. |
| `sessionLinks.ts` | Scans a session's transcript for links when the analyzer, the Session sidebar, or the preview asks. Resumes from the cached offset, at most 2 scans at once. |
| `sessionSummary.ts` / `sessionSummaries.ts` | Summary for the sidebar and preview: newest of Claude Code's recap (`away_summary`) and an on-click Haiku summary of the transcript tail. |
| `linkStatus.ts` / `linkStatusService.ts` | PR state via `gh`, ticket status via the Jira MCP server. Five-minute cache, at most 4 calls at once, on-screen links only. |
| `repoSet.ts` | Pure: the repos of the pinned sessions and terminals, newest first. |
| `gitStatus.ts` | Pure: git arguments and parsers for status, log, and commit hashes in transcripts. |
| `repoService.ts` / `repoTree.ts` | Repos view. Runs git (at most 4 at once), watches each `.git` folder, and builds the rows. |
| `quickPick.ts` / `repoFilter.ts` | All Sessions picker and the `repo:` filter. |
| `claudeLaunch.ts` | Pure: the plain `exec claude` launch command and `quoteForShell`. |
| `sessionFocus.ts` / `sessionFocusState.ts` | The focused session: the active Claude terminal or the preview tab. The state rules are pure. |
| `sessionPanel.ts` | Secondary Side Bar webview for the focused session: header with the derived status, where lines, summary, resume or suspend, workstreams with Unsorted and Removed, and the tile toolbar. Edits write `overseer.workstreamEdits.v2` and show at once. |
| `sessionSidebarText.ts` | Pure: the Session sidebar's meta line, state sentence, short link status, and row hover text. |
| `resourceRows.ts` | Pure: sidebar link rows and stale-drag checks. |
| `sessionPreview.ts` / `sessionPreviewModel.ts` | One reused editor tab for sessions with no terminal here: summary, last turns, prompts, and the commits and PRs the transcript scan found. Resume replaces it with the terminal. The model is pure. |

## Rules

- No runtime dependencies. Node built-ins and the `vscode` API only.
- Dev dependencies are pinned to exact versions released at least 7 days ago. Check with `npm view <pkg> time`.
- Claude's transcript and `~/.claude/sessions` formats are undocumented. Parse defensively, skip what doesn't parse, never throw.
- Send slash commands only when the session is idle. Typed input is lost while Claude is busy.
- Never resume a session that is live elsewhere. Two processes on one transcript corrupt it. Offer a fork.
- Session names reach the shell. Quote with `quoteForShell` and strip newlines.
- Keep logic that can be pure in pure modules (`grouping`, `reorder`, `repoFilter`, `liveParse`, `ticket`, `linkCandidates`, `candidateEnrichment`, `linkView`, `linkStatus`, `claudeLaunch`, `analysisState`, `workstreamEdits`, `legacyDeclarations`, `analysisSeed`, `analyzerDigest`, `analyzerOps`, `analyzerGates`, `workstreamDisplay`, `liveTransitions`, `resourceRows`, `sessionFocusState`, `sessionPreviewModel`, `sessionSidebarText`) and test it there. `vscode` can't be imported in unit tests.
- The agent is not told about Overseer. Sessions launch as plain `claude`. The extension derives tracking from transcripts.
- New commands need an entry in `contributes.commands`, a menu `when` clause, and `"when": "false"` under `commandPalette` if they need a tree node.

## Site

`docs/` is the GitHub Pages site (served from `main` `/docs`). React, Babel, and Tailwind come from pinned CDN versions; keep the 7-day rule there too. Brand rules are in `DESIGN.md`. When the version changes, update `VSIX_NAME` in `docs/index.html` and the README install commands.

## Release

1. `npm version <x.y.z> --no-git-tag-version`.
2. Update the version in `README.md` and `VSIX_NAME` in `docs/index.html`.
3. `npm run package`.
4. Commit, push, then `gh release create v<x.y.z> djaunt-overseer-<x.y.z>.vsix`.
