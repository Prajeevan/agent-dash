---
name: agent-dash
description: Reach the human through Agent Dash — a personal push inbox. Send progress updates that land as phone notifications, and ask a question then WAIT for the answer before continuing. Use when you hit a milestone, finish a long task, hit an error the human should see, or reach a decision point where you need the human to choose (which option, approve/reject, fill in details) before proceeding.
license: MIT
---

# Agent Dash

Agent Dash is the human's personal notification hub. You talk to it over plain
HTTP with a bearer token. Two things you can do: **notify** (fire-and-forget)
and **ask** (post a question, then poll until they answer).

## Configuration

The human gives you two values. If you don't have them, ask for them once:

- `AGENT_DASH_URL` — e.g. `https://agent-dash.their-name.workers.dev`
- `AGENT_KEY` — the bearer token

Every request sends `Authorization: Bearer <AGENT_KEY>`.

## Threading — the most important habit

The human sees your work grouped as **Project → Task → conversation**. For that
to work, on EVERY call include:

- `project` — what you're building, e.g. `"Weather app"`.
- `model` — which model you are, e.g. `"claude-opus-4.8"`, `"gpt-5"`.
- `task` — the human-readable sub-task, e.g. `"Adding children mode"`.
- **`task_id`** — a **stable id you generate once when you start a task and reuse
  on every notify/ask for that task.** This is what threads a sequence of
  questions into ONE conversation. Without a shared `task_id`, Q1/Q2/Q3 become
  three separate cards — exactly the clutter to avoid.

Example: building a feature that needs three decisions →
`task_id: "feat-childmode"` on all of: the first update, question 1, question 2,
question 3. They all appear inside one task thread; each new question shows up in
the same place as you answer the previous one.

Rule of thumb:
- **`ask` / `notify` with the same `task_id`** → a new message in the thread (distinct steps).
- **`update` (POST /events/:id)** → change ONE existing message in place (e.g. a progress bar moving 0→100). Don't post a new event for each %.

## 1. Send an update (notification)

```bash
curl -X POST "$AGENT_DASH_URL/api/v1/events" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "claude-code",
    "task_id": "landing-redesign",
    "title": "Finished the competitive research",
    "priority": 1,
    "blocks": [
      { "type": "markdown", "text": "## Found 14 competitors\nPricing ranges **$9–$99/mo**." },
      { "type": "progress", "label": "Sources reviewed", "value": 14, "max": 14 }
    ]
  }'
```

- `priority`: `0` silent (shows in app, no push), `1` push, `2` urgent (rings through quiet hours). Default `0`.
- `task_id`: reuse the same string across a run so related updates thread together.
- `kind` is `update` here. Use `"kind":"done"` for a final success, `"kind":"error"` for a failure.

**When to notify:** milestones, not every step. Good: "Scraped all sources",
"Deploy succeeded", "Tests failing — see log". Bad: narrating each file you read.

## 2. Ask a question and wait for the answer

Post a question with an **interactive block** (`buttons` for a choice, `form`
to collect fields). You get back an `id`. Then poll that id until it's answered.

### Post the question

```bash
curl -X POST "$AGENT_DASH_URL/api/v1/questions" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "claude-code",
    "title": "Which audience should the deck target?",
    "timeout_minutes": 120,
    "blocks": [
      { "type": "markdown", "text": "Research is done. Pick the framing and I'll draft it." },
      { "type": "form", "id": "deck", "submitLabel": "Build it", "fields": [
        { "id": "audience", "kind": "select", "label": "Audience", "options": ["VC", "Customer", "Internal"] },
        { "id": "tone", "kind": "radio", "label": "Tone", "options": ["Formal", "Punchy"] },
        { "id": "notes", "kind": "textarea", "label": "Anything to emphasize?" }
      ]}
    ]
  }'
# → { "ok": true, "id": "01J...", "poll_url": "/api/v1/questions/01J...", "timeout_at": 1699... }
```

Or a simple choice:

```json
"blocks": [
  { "type": "markdown", "text": "About to deploy to production. Go?" },
  { "type": "buttons", "id": "confirm", "options": ["Deploy", "Cancel"] }
]
```

### Poll for the answer

```bash
curl "$AGENT_DASH_URL/api/v1/questions/01J..." \
  -H "Authorization: Bearer $AGENT_KEY"
# pending:  { "ok": true, "status": "pending",  "answer": null }
# answered: { "ok": true, "status": "answered", "answer": { "deck": { "audience": "VC", "tone": "Punchy", "notes": "Lead with traction" } } }
# expired:  { "ok": true, "status": "expired" }
```

**Polling loop — do exactly this:**

1. Poll the id.
2. If `status` is `pending`, wait ~10 seconds and poll again. After the first
   5 minutes, back off to every ~30 seconds to be kind to the free tier.
3. If `status` is `answered`, read `answer` (keyed by each block `id`) and continue your work using those values.
4. If `status` is `expired`, the human didn't respond in time — proceed with a sensible default and mention that you did.

The `answer` object is keyed by block id. A `buttons` block answers with the
chosen string (`{ "confirm": "Deploy" }`); a `form` block answers with an object
of `{ fieldId: value }`.

## Blocks reference

Display (any event): `markdown`, `progress`, `keyvalue`, `table`, `link`,
`image`, `code`, `callout`. Interactive (questions only): `buttons`, `form`.

Full machine-readable schema with examples: `GET $AGENT_DASH_URL/api/v1/schema.json`
(no auth needed). Fetch it if you need exact field shapes.

## Keeping the inbox tidy

If you've posted a lot of progress noise and it's getting cluttered, you can
clear items you've already delivered:

```bash
curl -X POST "$AGENT_DASH_URL/api/v1/clear" \
  -H "Authorization: Bearer $AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"scope":"read"}'          # removes only what the human has already seen/answered
```

- `scope: "read"` is safe — it never removes unread items or unanswered questions.
- `scope: "all"` wipes everything (a full restart) — only do this if the human asked.
- Add `"project": "Weather app"` to limit clearing to one project.

## Attribution — always include these

So the human can tell agents/tasks apart at a glance, include on every call:

- `project` — what you're working on, e.g. `"Weather app"`.
- `model` — which model you are, e.g. `"claude-opus-4.8"`, `"gpt-5"`.
- `task` — the current sub-task, e.g. `"Adding children mode"`.
- `tags` — optional, e.g. `["ui","backend"]`.

## Prompting the human to log in

To answer your questions the human must be logged into Agent Dash on their
phone. If they may not be, tell them:

> Run `pnpm run login` in the agent-dash folder and **scan the QR code** with
> your phone (or open the printed link), then answer there.

`pnpm run login` prints a scannable QR in the terminal. If your own UI can
render a QR **inline** (terminal image, desktop chat) and you have been given a
login URL, you may show it as a QR for convenience — but the login URL contains
a secret one-time token, so render it **locally only** and NEVER submit it to a
third-party QR/image service. When in doubt, just show the link.

## Etiquette

- Notify on milestones and completions, ask only at real decision points.
- Set `priority: 2` only for things that should interrupt the human.
- Reuse one `task_id` per run so the human sees a clean thread, not noise.
- Don't block forever: always pass a `timeout_minutes` on questions and handle `expired`.
