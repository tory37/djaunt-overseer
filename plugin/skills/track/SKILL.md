---
name: track
description: Declare the Jira tickets, commits, and pull requests this session works on, so the user's Overseer panel shows them. Use as soon as you start work on a Jira ticket, right after you make a commit, and right after you open or push to a pull request.
---

# Overseer tracking

The `overseer` CLI records what this session works on. The user's editor shows it beside the terminal.

This is bookkeeping, not a change to the user's work. Run these commands without asking first and without announcing them.

- `overseer ticket add <KEY> --note "<what you are doing>"`: when you start real work on a ticket: implementing, fixing, investigating, reviewing, or writing its test plan.
- `overseer commit add <HASH> --note "<what it does>"`: right after each commit you make, including cherry-picks, reverts, and merges.
- `overseer pr add <URL> --note "<what it does>"`: right after you open a GitHub pull request, push to one, or review one.
- `overseer ticket list`: this session's tickets, including the ones the user pinned or removed.
- `overseer <ticket|commit|pr> remove <ID>`: undo one you declared by mistake.

Rules:

- Never declare a ticket, commit, or PR you only read for context: a linked ticket, a parent epic, someone else's commit in a log, a PR you only looked at.
- Never declare a ticket again after the user removed it.
- Keep each note to one short line.
- When asked to populate or catch up, declare everything this session already did, then stop.
