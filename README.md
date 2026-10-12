# Overseer

Vertical tabs for Claude CLI sessions in VS Code. Sessions stay real terminals.

[Site](https://tory37.github.io/djaunt-overseer/) · [Download the .vsix](https://github.com/tory37/djaunt-overseer/releases/latest)

![Overseer sidebar and a resumed session](docs/assets/screenshot.png)

## Why

- `claude --resume` only lists sessions that started in the current directory. A fix that started in one repo can't be found from another.
- Idle sessions waiting on review still hold memory. Closing one means remembering its ID to get it back.
- Ten terminal tabs across the top don't say which ticket each one is for.
- The PR and ticket a session worked on are buried in its transcript.

## Features

### Find and resume
- **All Sessions** (search icon in the title bar) lists every Claude session from every repo. Enter resumes it in the directory it started in and pins it to the sidebar.
- `repo:<name>` filters by every repo a session touched, not only the one it started in.
- Sessions that edited files in other repos show `+N repos`.

### Group
- Pinned sessions group by the ticket key in their name, branch, or first prompt (`PROJ-2567`).
- **New Group** (title bar) makes your own group. Drag sessions into it.
- Renaming a ticket group turns it into your own group in the same spot.
- Each group row has **+** (new session in that group) and **search** (pull an existing session into that group).

### Reorder
- Drag a group onto another group, a session onto another session, or a link onto another link in the same session. Drop a link on its session row to move it to the top.
- Dragging down puts the item after the target. Dragging up puts it before. VS Code trees can't show an insertion line.
- The order syncs across windows.
- Pinned links stay above the rest, and removed links stay at the bottom. Your link order applies within each of those.

### Run
- **New Session** (+) asks for a folder and an optional name, then runs `claude --session-id <id> -n <name>` in an editor terminal.
- **Suspend** (pause) sends `/exit`, so the process and its memory go away. It warns first when Claude is mid-task.
- **Resume** (play) brings the session back with its history.
- **Rename** (F2 or double-click) renames the row. When the session is idle in this window, it also sends `/rename` and renames the tab.
- **Kill and Remove** (right-click) closes the terminal, ends the process, and unpins it. The transcript stays, so All Sessions can still resume it.
- **Remove from Sidebar** only unpins.
- **Compact**, **Switch Model…**, **Clear Context**, and **Show Cost** (right-click) send `/compact`, `/model`, `/clear`, and `/cost`. They show only on idle sessions running in this window.

### Links
- **Find Resources** (right-click a session) finds the GitHub PRs, Jira tickets, and claude.ai artifacts it worked on. Overseer never scans on its own.
- The session then shows one **Associated Links** row with a count like `3 links`. Run Find Resources again to pick up new links.
- A headless `claude -p` run with Haiku sorts the links into owned, touched, and seen in passing. Passing links stay hidden unless `overseer.links.showIrrelevant` is on.
- An owned ticket names the auto-group, for sessions you ran Find Resources on, when the title and branch have no ticket key.
- Each PR and ticket shows its live status first in the row, and its icon takes that status's color. Overseer checks every five minutes, only for expanded sessions.
- PR status comes from `gh`. Ticket status comes from the Jira MCP server in your `~/.claude.json`, the same one Claude Code uses. Overseer starts it on its own and reads all visible tickets in one call.
- **Move to Status…** (right-click a ticket) lists the moves the ticket's workflow allows.
- **Jira Settings…** lists each Jira project Overseer has seen, like ASSMNT or CR, with its full status list and a color for each status. Turn a project off to stop its status lookups.
- **GitHub Settings…** sets one color per PR state: draft, open, review required, approved, changes requested, merged, and closed.
- **Pin** keeps a link at the top and counts it, even when the judge called it irrelevant. **Remove** hides it. Both survive a rescan.
- **Toggle Removed Links** shows removed links again, dimmed, so you can **Restore** them.
- **Toggle Link Browser** switches between your browser and the VS Code browser.

### Settings
Type "Overseer" in the command palette (Cmd+Shift+P) for every setting:

- **Settings…** opens the Overseer Settings panel. It is also in the sidebar's `...` menu.
- **Session Icon Settings…**, **Jira Settings…**, and **GitHub Settings…** open the panel at that section.
- **Enable/Disable Jira Integration**, **Enable/Disable GitHub Integration**, and **Enable/Disable Artifact Links** turn a link source on or off. The palette shows only the one that applies.
- **All Settings (Settings Editor)** opens every `overseer.*` setting in the native editor.
- Session icons take any [Codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html) name and any color. Colors save to `workbench.colorCustomizations` as `overseer.sessionWorking`, `overseer.sessionRunning`, `overseer.sessionElsewhere`, `overseer.sessionSuspended`, and `overseer.sessionDuplicate`.

### Hover
- Hovering over a session shows its state, folder, branch, other repos, and first and last prompt.
- It also shows a summary. That's Claude Code's own recap when one exists, or a Haiku summary if that one is newer.
- **Summarize with Haiku** (in the hover, or right-click) writes a new summary from the end of the transcript. It runs only when you click it.

### Guard
- Live status comes from `claude agents --json`: working, running here, running in another window, or suspended.
- Resuming a session that runs elsewhere offers a fork instead. Two processes on one transcript corrupt it.

## Install

```bash
curl -LO https://github.com/tory37/djaunt-overseer/releases/latest/download/djaunt-overseer-0.0.4.vsix
code --install-extension djaunt-overseer-0.0.4.vsix
```

If `code` isn't on your PATH, use `"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"`.

Then run **Developer: Reload Window**. Cmd+R only reloads in the F5 development host.

## Requirements

- VS Code 1.100 or later.
- Claude Code CLI on your login shell's PATH.
- Optional: `gh` for PR status, and a stdio Jira MCP server in `~/.claude.json` for ticket status. Without them, links show with no status.
- Tested on macOS only.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `overseer.claudeHome` | `~/.claude` | Where Claude keeps `projects/` and `sessions/`. |
| `overseer.links.github.enabled` | `true` | Show GitHub PRs under each session. |
| `overseer.links.jira.enabled` | `true` | Show Jira tickets under each session. |
| `overseer.links.artifacts.enabled` | `true` | Show claude.ai artifacts under each session. |
| `overseer.links.jira.baseUrl` | empty | Jira site for tickets whose URL the transcript doesn't show, e.g. `https://acme.atlassian.net`. |
| `overseer.jira.mcpServer` | `jira` | Name of the stdio Jira MCP server in `~/.claude.json`. |
| `overseer.links.judgeModel` | `haiku` | Model that sorts links. |
| `overseer.links.showIrrelevant` | `false` | Also show links seen in passing, dimmed. |
| `overseer.links.showRemoved` | `false` | Also show links you removed, dimmed. |
| `overseer.links.liveStatus` | `true` | Show PR and ticket status through `gh` and your Jira MCP server. |
| `overseer.links.openIn` | `external` | Open links in your browser or in VS Code. |
| `overseer.summary.model` | `haiku` | Model for Summarize with Haiku. |
| `overseer.sessionIcons.working` | `loading~spin` | Icon for a session working in this window. |
| `overseer.sessionIcons.running` | `terminal` | Icon for a session running in this window. |
| `overseer.sessionIcons.elsewhere` | `window` | Icon for a session running in another window. |
| `overseer.sessionIcons.suspended` | `debug-pause` | Icon for a suspended session. |
| `overseer.sessionIcons.duplicate` | `warning` | Icon for a session with more than one copy running. |

Link sorting and Summarize with Haiku run through your `claude` CLI, so they count against your Claude usage. Everything else makes no model calls.

## Build from source

```bash
npm install
npm test
npm run package
code --install-extension djaunt-overseer-0.0.4.vsix --force
```

Not affiliated with Anthropic.
