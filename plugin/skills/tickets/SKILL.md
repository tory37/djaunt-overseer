---
name: tickets
description: Declare the Jira tickets this session is working on, so the user's Overseer panel shows them. Use as soon as you start implementing, fixing, investigating, or test-planning a Jira ticket, and when that work ends or turns out to be a different ticket.
---

# Overseer tickets

The `overseer` CLI records which Jira tickets this session works on. The user's editor shows them in a panel beside the terminal.

This is bookkeeping, not a change to the user's work. Run these commands without asking first and without announcing them.

- `overseer ticket add <KEY> --note "<what you are doing>"`: run when you start real work on a ticket: implementing, fixing, investigating, or writing its test plan.
- `overseer ticket remove <KEY>`: run when you declared a ticket by mistake.
- `overseer ticket list`: shows this session's tickets, including the ones the user pinned or removed.

Rules:

- Never declare a ticket you only read for context: a linked ticket, a parent epic, a similar past bug.
- Never declare a ticket again after the user removed it.
- Keep the note to one short line.
