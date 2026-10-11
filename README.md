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
- Drag a group onto another group, or a session onto another session.
- Dragging down puts the item after the target. Dragging up puts it before. VS Code trees can't show an insertion line.
- The order syncs across windows.

### Run
- **New Session** (+) asks for a folder and an optional name, then runs `claude --session-id <id> -n <name>` in an editor terminal.
- **Suspend** (pause) sends `/exit`, so the process and its memory go away. It warns first when Claude is mid-task.
- **Resume** (play) brings the session back with its history.
- **Rename** (F2 or double-click) renames the row. When the session is idle in this window, it also sends `/rename` and renames the tab.
- **Kill and Remove** (right-click) closes the terminal, ends the process, and unpins it. The transcript stays, so All Sessions can still resume it.
- **Remove from Sidebar** only unpins.
- **Compact**, **Switch Model…**, **Clear Context**, and **Show Cost** (right-click) send `/compact`, `/model`, `/clear`, and `/cost`. They show only on idle sessions running in this window.

### Links
- Each session lists the GitHub PRs, Jira tickets, and claude.ai artifacts it worked on, with a count like `3 links`.
- Overseer scans the transcript when the session first shows and 60 seconds after it goes idle.
- When you expand a session, a headless `claude -p` run with Haiku sorts its links into owned, touched, and seen in passing. Passing links stay hidden unless `overseer.links.showIrrelevant` is on.
- An owned ticket names the auto-group when the title and branch have no ticket key.
- Icons show PR state from `gh` (open, draft, merged, closed) and ticket status from `acli` (to do, in progress, done). Overseer checks every five minutes, only for expanded sessions.
- **Pin** keeps a link at the top and counts it, even when the judge called it irrelevant. **Remove** hides it. Both survive a rescan.
- **Toggle Removed Links** shows removed links again, dimmed, so you can **Restore** them.
- **Toggle Link Browser** switches between your browser and the VS Code browser.
- **Refresh Links** (right-click) rescans and rejudges one session.

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
- Optional: `gh` for PR status and `acli` for Jira status. Without them, links show with no status.
- Tested on macOS only.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `overseer.claudeHome` | `~/.claude` | Where Claude keeps `projects/` and `sessions/`. |
| `overseer.links.github.enabled` | `true` | Show GitHub PRs under each session. |
| `overseer.links.jira.enabled` | `true` | Show Jira tickets under each session. |
| `overseer.links.artifacts.enabled` | `true` | Show claude.ai artifacts under each session. |
| `overseer.links.jira.baseUrl` | empty | Jira site for tickets whose URL the transcript doesn't show, e.g. `https://acme.atlassian.net`. |
| `overseer.links.judgeModel` | `haiku` | Model that sorts links. |
| `overseer.links.showIrrelevant` | `false` | Also show links seen in passing, dimmed. |
| `overseer.links.showRemoved` | `false` | Also show links you removed, dimmed. |
| `overseer.links.liveStatus` | `true` | Show PR and ticket status through `gh` and `acli`. |
| `overseer.links.openIn` | `external` | Open links in your browser or in VS Code. |
| `overseer.summary.model` | `haiku` | Model for Summarize with Haiku. |

Link sorting and Summarize with Haiku run through your `claude` CLI, so they count against your Claude usage. Everything else makes no model calls.

## Build from source

```bash
npm install
npm test
npm run package
code --install-extension djaunt-overseer-0.0.4.vsix --force
```

Not affiliated with Anthropic.
