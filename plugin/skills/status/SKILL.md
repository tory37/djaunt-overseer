---
name: status
description: Set the Overseer status of this session, the overall watcher shown in the user's session list. Use when a ticket you work on changes Jira status, when you start or finish a stage of work, and when you are blocked.
---

# Overseer session status

The session has one status. It shows where the whole session stands, not one ticket.

- `overseer status list`: the status options, the current status, and each ticket's Jira status.
- `overseer status set <ID> [--reason "<why>"]`: set it. Use an ID from the list.

Run these without asking first and without announcing them.

How to choose:

- One ticket: mirror it. Pick the option closest in meaning to the ticket's Jira status.
- Several tickets: condense. The session is only as far along as its least advanced open ticket. One in peer review, one ready for QA, one in progress: the session is in progress.
- Done tickets do not hold the session back.
- Blocked on any ticket or on the user: pick the blocked option, with a reason.
- Match by meaning. The options and Jira statuses use different words.

Rules:

- Set it right after you move a ticket, open a PR, or get blocked. Do not set it when nothing changed.
- Run `overseer status list` first when you are unsure of the options or the ticket statuses.
- Keep the reason to one short line.
