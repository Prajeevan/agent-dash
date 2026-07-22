# Agent Dash — Plan & Architecture Report

A self-hostable "mission control inbox" for AI agents. Any agent (Claude Code, Codex, Cursor, Antigravity, Kimi, a raw GPT/Claude chat) gets an endpoint + credentials and can:

1. **Push updates** — progress, logs, milestones — that land as push notifications on your phone.
2. **Ask you a question and wait** — the agent posts a question (optionally as a rich form built from predefined UI blocks), then polls until you answer, then continues its work.
3. **Render structured info** — tables, progress bars, key/value cards, links — not just text blobs.

You deploy it to your own Cloudflare account from a public GitHub repo, set one secret, and log in via an expiring magic link.

---

## 1. The big decision: React Native vs Web-in-WebView

**Recommendation: Web-first (TanStack Start on Cloudflare Workers), shipped as a PWA, with an optional Capacitor shell for app stores. Not React Native.**

### Why not React Native
- Two codebases (RN app + Worker API + a web dashboard you'll want anyway).
- Kills the "clone → `wrangler deploy` → done" story. Every self-hoster would need Xcode/Android Studio, signing certs, and an Apple developer account ($99/yr) just to get notifications. That's fatal for an open-source project whose pitch is "deploy in 5 minutes."
- Expo helps but still requires builds per user, or you ship one binary pointed at *your* server — which breaks self-hosting.

### Why web + PWA works now
- **Web Push is universal in 2026.** Android/Chrome always had it; iOS has supported Web Push for installed PWAs since 16.4 (2023). User adds the page to their home screen, grants notification permission, done. No app store, no builds, no certs.
- One codebase: the TanStack Start app is simultaneously the desktop dashboard, the mobile app, and the API server.
- Self-hosters get the full experience with zero native tooling.

### Capacitor as the optional escape hatch
If PWA push proves flaky for someone (iOS push requires the PWA to be installed to home screen, and iOS can evict service workers aggressively), a thin Capacitor wrapper around the deployed URL gives real APNs/FCM push. Keep this as a **Phase 5 optional directory** (`/native`), not the core path. The web app should never know or care whether it's inside Capacitor.

**Verdict:** Web → PWA → (optional) Capacitor. RN only if this becomes a commercial product with store presence as a requirement.

---

## 2. System architecture

```
┌────────────┐  POST events/questions   ┌─────────────────────────────┐
│  Agents     │ ───────────────────────▶ │  Cloudflare Worker           │
│ (Claude Code│  GET answer             │  TanStack Start (SSR + API)  │
│  Cursor,    │  (poll every 10s)       │                              │
│  Codex, GPT)│ ◀─────────────────────── │  ├─ /api/v1/*  agent REST    │
└────────────┘                          │  ├─ /mcp       MCP server    │
                                        │  ├─ /app       dashboard UI  │
┌────────────┐  magic link login        │  └─ /login     auth          │
│  You (phone │ ───────────────────────▶ │                              │
│  / desktop) │ ── poll while open ────▶ │  Bindings (all free tier):   │
│  PWA        │ ◀── Web Push ─────────── │   D1 (events, questions,     │
└────────────┘                          │       push subs)             │
                                        │   KV (sessions)              │
                                        │   Cron (TTL cleanup)         │
                                        └─────────────────────────────┘
```

**Designed for the Cloudflare free plan — no Durable Object in the core.** Everything is polling + push, which a single-user workload fits comfortably:

| Free-tier limit | Our worst case |
|---|---|
| Workers: 100k req/day | Agent polling an answer every 10s = 8,640 req/day; dashboard polling every 5s while open ≈ a few thousand; several concurrent runs still leave 10× headroom |
| D1: 5M reads / 100k writes per day | An inbox for one human doesn't approach this |
| KV, Cron, Web Push | Free / free / just outbound fetches |

Note: Durable Objects *are* available on the free plan since 2025 (SQLite-backed only, 100k req/day + ~13k GB-s duration/day), but held-open connections (SSE, long-polls) burn the duration budget. So the core ships DO-free; a later optional upgrade can add one DO using the **WebSocket hibernation API** (hibernated sockets don't bill duration) for instant answer-wakeups and a live feed without polling. The only real cost of skipping it in v1: an agent learns its answer up to 10s late — irrelevant for research-length tasks.

### Stack
| Layer | Choice | Why |
|---|---|---|
| Framework | TanStack Start (React) on Workers | You asked for it; first-class CF support via `@cloudflare/vite-plugin`; server routes double as the API |
| DB | D1 (SQLite) | Free tier generous, zero-config for self-hosters, perfect for an inbox workload |
| Real-time | Polling (agents 10s, dashboard 5s while open) | Free-plan safe; no held connections. Optional DO + WebSocket hibernation upgrade later for instant delivery |
| Sessions | KV with TTL | Expiring sessions for free — KV TTL *is* the expiry mechanism |
| Push | Web Push (VAPID) from the Worker | Workers-compatible via WebCrypto (`@block65/webcrypto-web-push` or similar); no Firebase account needed |
| Cleanup | Cron trigger | Deletes expired events/sessions/answered questions past retention |

### Data model (D1)

```sql
events (
  id TEXT PRIMARY KEY,            -- ulid
  agent TEXT NOT NULL,            -- "claude-code", "cursor", free-form label
  task_id TEXT,                   -- groups events into a run/thread
  kind TEXT NOT NULL,             -- 'update' | 'question' | 'done' | 'error'
  title TEXT NOT NULL,
  blocks TEXT NOT NULL,           -- JSON array of UI blocks (see §4)
  priority INTEGER DEFAULT 0,     -- 0 info, 1 notify, 2 urgent
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  expires_at INTEGER              -- retention TTL
);

questions (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  status TEXT NOT NULL,           -- 'pending' | 'answered' | 'expired'
  answer TEXT,                    -- JSON: form values / chosen button
  answered_at INTEGER,
  timeout_at INTEGER              -- agent-specified deadline
);

push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  keys TEXT NOT NULL,             -- p256dh + auth JSON
  created_at INTEGER NOT NULL
);
```

`task_id` matters: the dashboard groups a research run's 40 progress pings into one collapsible thread instead of 40 inbox rows.

---

## 3. Auth & expiry model (single-tenant, two credentials)

This is a **single-user** system per deployment. Two separate secrets, both set via `wrangler secret put`:

1. **`AGENT_KEY`** — bearer token agents send on every API/MCP call. Long-lived. Rotate by re-running `wrangler secret put`.
2. **`APP_SECRET`** — HMAC signing key for *your* login links and session cookies. Never given to agents.

### Login flow (magic link, expiring)
1. Setup script prints (or you request via CLI) a login URL: `https://your-hub.workers.dev/login?t=<HMAC-signed token, exp 15 min>`.
2. Opening it verifies the HMAC + expiry, then mints a session in KV with a TTL (default 30 days, configurable) and sets an HttpOnly cookie.
3. Sessions expire naturally via KV TTL. A "log out everywhere" button bumps a `session_epoch` value that invalidates all outstanding sessions instantly.
4. Optional hardening: bind session to first-seen device, and require re-login for destructive actions.

Agents never see sessions; you never type the agent key. Clean separation, both expire/rotate independently. No user table, no OAuth, no passwords — right-sized for "deploy your own."

### Expiry everywhere
- Login links: 15 min.
- Sessions: KV TTL.
- Events: `expires_at` + cron cleanup (default 30 days retention).
- Questions: agent sets `timeout_at`; cron marks overdue ones `expired` so agents polling get a definitive "no answer, proceed with default" instead of hanging forever.

---

## 4. The block system (predefined UI components)

Agents don't send HTML — they send a **JSON array of typed blocks**, validated with zod, rendered by the dashboard. This is the Adaptive Cards / Slack Block Kit pattern, and it's the right one: agents are great at emitting schema-conformant JSON, and you never eval agent-supplied markup (XSS containment).

### v1 block set

```jsonc
{ "type": "markdown",  "text": "## Found 3 pricing models…" }
{ "type": "progress",  "label": "Scraping sources", "value": 62, "max": 100 }
{ "type": "keyvalue",  "items": [{ "k": "Competitors found", "v": "14" }] }
{ "type": "table",     "columns": ["Name", "Price"], "rows": [["Acme", "$99"]] }
{ "type": "link",      "url": "https://…", "label": "Draft deck" }
{ "type": "image",     "url": "https://…", "alt": "chart" }         // URL only, no data-URIs in v1
{ "type": "code",      "lang": "json", "text": "…" }

// Interactive blocks — only valid inside kind:"question" events:
{ "type": "buttons",   "id": "approve", "options": ["Approve", "Reject", "Edit first"] }
{ "type": "form",      "id": "deck_inputs", "fields": [
    { "id": "audience", "kind": "select", "label": "Audience", "options": ["VC", "Customer", "Internal"] },
    { "id": "tone",     "kind": "radio",  "label": "Tone", "options": ["Formal", "Punchy"] },
    { "id": "notes",    "kind": "textarea", "label": "Anything to emphasize?" }
] }
```

Your sales-deck example maps exactly: agent finishes research → posts a `question` event with a `markdown` summary block + a `form` block → you get a push notification → open PWA, fill the form → agent's next poll returns `{ status: "answered", answer: { audience: "VC", tone: "Punchy", notes: "…" } }` → continues writing the deck.

The JSON Schema for blocks is published at `/api/v1/schema.json` — the skill and MCP tool descriptions link to it, so any agent can self-serve the exact contract.

---

## 5. Agent-facing API

```
POST /api/v1/events            # push an update        → { id }
POST /api/v1/questions         # ask + blocks + timeout → { id }
GET  /api/v1/questions/:id     # poll answer           → { status, answer? }
GET  /api/v1/inbox             # agent reads its own recent events (dedupe/resume)
```

All bearer-auth'd with `AGENT_KEY`. Answer delivery is plain polling every ~10s — one cheap D1 read per poll, works identically for MCP clients and taught-skill agents, and stays trivially inside free-plan request limits. (A `?wait=` long-poll variant can arrive with the optional DO upgrade; the API shape doesn't change.)

Also served: `GET /api/v1/openapi.json` — an OpenAPI spec, which makes the hub usable as a **ChatGPT custom GPT Action** with zero extra work. That's how "GPT" gets first-class support without MCP.

---

## 6. MCP server + Skill: do both, they serve different clients

### MCP server (`/mcp`, streamable HTTP)
Built with Cloudflare's `agents` SDK (`McpAgent`) inside the same Worker. Auth: same bearer `AGENT_KEY`. Four tools:

| Tool | Behavior |
|---|---|
| `notify(title, blocks?, priority?, task_id?)` | Push an update. Returns event id. |
| `ask(title, blocks, timeout_minutes?)` | Post question, get question id. |
| `wait_for_answer(question_id)` | Checks the answer; returns `answered` + values, or `pending`/`expired`. Tool description instructs the agent to re-call every ~10s while pending. |
| `checkpoint(task_id, summary)` | Sugar: notify + mark previous task events read. |

One config line in Claude Code / Cursor / Codex / any MCP client:
```json
{ "mcpServers": { "agent-dash": { "url": "https://your-hub.workers.dev/mcp", "headers": { "Authorization": "Bearer <AGENT_KEY>" } } } }
```

### Skill (`skills/agent-dash/SKILL.md` in the repo)
A portable instruction file teaching **curl-based** usage: endpoints, block schema, the 10s polling loop, when to notify (milestones, not every step), when to ask vs. proceed with defaults. This covers:
- Claude Code / any CLI agent without MCP configured
- Raw claude.ai / ChatGPT conversations ("here's my hub URL and key, use this skill")
- Antigravity/Kimi/anything that can run shell or fetch

### Why both
MCP = zero-friction for IDE/CLI agents, typed tools, long-poll efficiency. Skill = works literally anywhere an agent can make an HTTP request, including chat UIs with no tool config. OpenAPI = the ChatGPT Actions path. Three doors into one API — the API is the product; MCP/skill/OpenAPI are adapters. Build the API first, adapters are thin.

---

## 7. Notifications pipeline

1. Event lands (`POST /api/v1/events` or MCP `notify`).
2. Worker writes to D1.
3. If `priority >= 1` (or `kind: question`), Worker sends Web Push to all registered subscriptions (VAPID keys auto-generated at setup, stored as secrets). Push is the real-time channel — it needs no held connections and is free.
4. Service worker shows the notification; tapping deep-links to the event/question.
5. Open dashboard tabs poll `/api/v1/feed?since=<cursor>` every ~5s for the live view — a single indexed D1 read; a visible tab plus push covers "live" without SSE.
6. Questions answered in the UI → written to D1; the agent's next 10s poll picks it up.

Quiet hours + per-priority filtering are dashboard settings (KV), because agents at 3am are real.

---

## 8. Open source: is it the right approach, and what do you get

### Is it right? Yes — with clear eyes about the landscape.
Prior art exists: **ntfy.sh** (self-hosted push, but text-only, no round-trip), **Gotify** (same), **HumanLayer** (agent human-in-the-loop, but a SaaS/SDK, not self-hosted-first), plus each vendor's companion app (Claude/ChatGPT mobile) which are locked to their own agent. **The differentiated wedge is exactly your idea: vendor-neutral, self-hosted, *bidirectional* (ask-and-wait with structured forms), agent-native (MCP + skill + OpenAPI out of the box).** Nothing popular occupies that intersection today. "ntfy for agents, with answers" is a one-line pitch that lands.

### What open source gets you
- **Distribution you can't buy.** "Deploy to Cloudflare" button + HN/r/LocalLLaMA/X launch. Agent-tooling is the hottest OSS category right now; a genuinely useful human-in-the-loop hub is star-magnet material.
- **Trust.** People will not send their agents' work product (research, code, business data) to a stranger's SaaS. Self-hosted on *their* Cloudflare account removes the objection entirely — and CF free tier means it costs them $0.
- **Contributors do your roadmap.** Block types, agent integrations, translations — classic community-shaped work.
- **Reputation/leads.** For Commersive, a popular OSS repo is credibility with exactly the clients buying agent work.

### What it will NOT get you (be honest with yourself)
- Direct revenue. Monetization, if ever, is a hosted version ("we run it for you") or a team tier (multi-user, shared inboxes, RBAC) — the classic open-core split. Keep the single-user core MIT-licensed forever; that's the trust contract.
- Zero support burden. Issues will come. Scope defense: single-user, Cloudflare-only, block set is curated (PRs adding blocks welcome; PRs adding raw HTML rendering rejected).

### Deploy story (the thing to obsess over)
```
1. Fork/clone repo  →  click "Deploy to Cloudflare" (or: pnpm i && wrangler deploy)
2. pnpm setup       →  creates D1, runs migrations, generates AGENT_KEY + APP_SECRET
                        + VAPID keys, prints your magic login link + MCP config snippet
3. Open link on phone → Add to Home Screen → allow notifications
4. Paste MCP snippet / SKILL.md into your agent. Done.
```
If step 1→4 is under 5 minutes, the repo wins. Every architecture choice above (D1 not Postgres, magic link not OAuth, one Worker not three services) serves this.

---

## 9. Build phases

| Phase | Scope | Outcome |
|---|---|---|
| **1. Core inbox** | TanStack Start scaffold on Workers, D1 schema + migrations, bearer-auth `POST /events`, magic-link login + KV sessions, inbox UI with markdown/keyvalue/progress blocks, setup script | Agents can push, you can read on any device |
| **2. Live + push** | Web Push (VAPID gen in setup, service worker, subscription mgmt), cursor-based feed polling for open tabs, PWA manifest + install flow, priorities + quiet hours | Phone buzzes when an agent speaks |
| **3. Ask-and-wait** | `questions` table, form/buttons blocks + renderer, poll endpoint, timeout/expiry cron, thread view by `task_id` | The sales-deck flow works end to end |
| **4. Adapters** | MCP server (4 tools), `SKILL.md`, OpenAPI spec, README quickstarts per client (Claude Code, Cursor, Codex, ChatGPT Action) | Any agent connects in one config line |
| **5. Ship it** | Deploy-to-Cloudflare button, docs site (same Worker), demo GIF, optional `/native` Capacitor shell, launch posts | Public repo people can actually adopt |
| **6. (Optional) Instant mode** | One SQLite-backed DO using WebSocket hibernation: live feed without polling + instant agent wakeups. Feature-flagged; free plan compatible, but off by default to keep the core dead simple | Sub-second delivery for those who want it |

Phases 1–3 are the product. Phase 4 is cheap (thin adapters over the API). Phase 5 is marketing.

---

## 10. Risks & mitigations

- **iOS PWA push reliability** — real but improved since 16.4; mitigation is the Capacitor shell (Phase 5) and honest README notes ("install to home screen required on iOS").
- **Agent key leakage** (it lives in skill files/MCP configs) — key only allows posting/reading events, never login; rotation is one command; rate-limit per key.
- **Prompt-injected agents posting garbage/XSS** — zod-validated blocks, no raw HTML ever rendered, markdown sanitized, image URLs only (consider a proxy later).
- **D1 growth** — retention cron + 30-day default TTL; it's an inbox, not an archive.
- **Free-plan request budget** — 100k Worker req/day; ~9k/day per agent waiting on an answer at 10s intervals. Many simultaneous waiting questions could add up, so the skill/MCP tool teaches backoff (10s for the first 5 min, then 30s) — cuts steady-state polling 3× with no felt latency.
