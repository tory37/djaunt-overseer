# Overseer

Vertical tabs for Claude CLI sessions in VS Code. Sessions stay real terminals.

[Site](https://tory37.github.io/djaunt-overseer/) · [Download the .vsix](https://github.com/tory37/djaunt-overseer/releases/latest)

![Overseer sidebar and a resumed session](docs/assets/screenshot.png)

- **All Sessions** (search icon): every Claude session from every repo. Enter resumes it in the directory it started in and pins it.
- **Sidebar tree**: pinned sessions, grouped by the ticket key in the title, branch, or first prompt. Drag sessions into your own groups.
- **Suspend** (⏸): sends `/exit` so the session stops using memory. **Resume** (▶) brings it back with its history.
- **Rename** (F2 or double-click): renames the sidebar entry and, when the session is idle in this window, sends `/rename` to Claude.
- Warns before resuming a session that is already running elsewhere, and offers a fork instead.

## Build and install

```bash
npm install
npm test
npm run package
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension djaunt-overseer-0.0.1.vsix
```
