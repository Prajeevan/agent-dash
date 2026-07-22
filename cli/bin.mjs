#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { spawn } from 'node:child_process'
import { loadConfig, saveConfig, resolve, hub, verify, qr, die, sleep, encrypt, decrypt } from './lib/util.mjs'

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    url: { type: 'string' },
    key: { type: 'string' },
    'enc-key': { type: 'string' },
    priority: { type: 'string' },
    project: { type: 'string' },
    task: { type: 'string' },
    'task-id': { type: 'string' },
    model: { type: 'string' },
    kind: { type: 'string' },
    tag: { type: 'string', multiple: true },
    markdown: { type: 'string' },
    button: { type: 'string', multiple: true },
    e2e: { type: 'boolean' },
    agent: { type: 'string' },
  },
})

const cmd = positionals[0]

async function prompt(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const a = await rl.question(q)
  rl.close()
  return a.trim()
}

// ── login: save hub url + agent key, verify, offer to connect ────────────────
async function login() {
  console.log('\nAgent Dash — connect an agent\n')
  const cfg = loadConfig()
  let url = flags.url || (await prompt(`Hub URL${cfg.url ? ` [${cfg.url}]` : ''}: `)) || cfg.url
  let key = flags.key || (await prompt('Agent key: ')) || cfg.key
  if (!url || !key) die('Both a hub URL and an agent key are required.')
  url = url.replace(/\/$/, '')

  process.stdout.write('Verifying… ')
  const ok = await verify({ url, key })
  if (!ok) die('Could not authenticate. Check the URL and key.')
  console.log('✓ connected')

  const next = { ...cfg, url, key }
  if (flags['enc-key']) next.encKey = flags['enc-key']
  saveConfig(next)
  console.log(`\nSaved to your config. You can now:`)
  console.log(`  agent-dash connect          # write MCP config for your agent`)
  console.log(`  agent-dash notify "hi"      # send a test update`)
  console.log(`  agent-dash open             # log in on your phone (QR)\n`)
}

// ── connect: write the MCP server entry for an agent ─────────────────────────
async function connect() {
  const { url, key } = resolve(flags)
  if (!url || !key) die('Run `agent-dash login` first (or pass --url and --key).')

  const entry = { url: `${url}/mcp`, headers: { Authorization: `Bearer ${key}` } }
  // Claude Code / most MCP clients read a project-local .mcp.json.
  const file = '.mcp.json'
  let doc = {}
  if (existsSync(file)) {
    try {
      doc = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      die(`${file} exists but isn't valid JSON — fix or remove it first.`)
    }
  }
  doc.mcpServers = doc.mcpServers || {}
  doc.mcpServers['agent-dash'] = entry
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
  console.log(`\n✓ Wrote agent-dash MCP server to ./${file}`)
  console.log('  Restart your agent (or reload MCP servers) to pick it up.\n')
  console.log('  Also worth installing the skill:  npx skills add Prajeevan/agent-dash\n')
}

// ── open: show a QR to log in on your phone ──────────────────────────────────
async function open() {
  const { url } = resolve(flags)
  if (!url) die('No hub URL. Run `agent-dash login` first.')
  console.log('\nScan to open Agent Dash on your phone (log in there with your magic link):\n')
  qr(url)
  console.log(`  ${url}\n`)
  // Best-effort: also open in the default browser on this machine.
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  spawn(opener, [url], { stdio: 'ignore', detached: true }).on('error', () => {})
}

// ── notify: send an update (great for scripts / hooks) ───────────────────────
async function notify() {
  const conf = resolve(flags)
  if (!conf.url || !conf.key) die('Run `agent-dash login` first.')
  const title = positionals.slice(1).join(' ') || die('Usage: agent-dash notify "your message"')

  let blocks = flags.markdown ? [{ type: 'markdown', text: flags.markdown }] : []
  const body = {
    title,
    agent: 'agent-dash-cli',
    priority: flags.priority ? Number(flags.priority) : 0,
    kind: flags.kind || 'update',
    project: flags.project,
    task: flags.task,
    task_id: flags['task-id'],
    model: flags.model,
    tags: flags.tag,
  }
  await attachBlocks(body, blocks, conf, flags.kind === 'question' ? 'update' : flags.kind)
  const { status, json } = await hub('POST', '/api/v1/events', conf, body)
  if (status !== 200 || !json.ok) die(`Failed (${status}): ${json.error || 'unknown error'}`)
  console.log(`✓ sent (${json.id})`)
}

// ── ask: post a question, wait for the answer, print it ──────────────────────
async function ask() {
  const conf = resolve(flags)
  if (!conf.url || !conf.key) die('Run `agent-dash login` first.')
  const title = positionals.slice(1).join(' ') || die('Usage: agent-dash ask "question" --button A --button B')
  const options = flags.button || []
  if (options.length < 1) die('Provide at least one --button option (or extend to forms).')

  const blocks = [
    ...(flags.markdown ? [{ type: 'markdown', text: flags.markdown }] : []),
    { type: 'buttons', id: 'choice', options },
  ]
  const body = {
    title,
    agent: 'agent-dash-cli',
    project: flags.project,
    task: flags.task,
    task_id: flags['task-id'],
    model: flags.model,
    tags: flags.tag,
  }
  await attachBlocks(body, blocks, conf, 'question')
  const { status, json } = await hub('POST', '/api/v1/questions', conf, body)
  if (status !== 200 || !json.ok) die(`Failed (${status}): ${json.error || 'unknown error'}`)

  process.stderr.write('Waiting for your answer on the phone')
  for (let i = 0; i < 360; i++) {
    const r = await hub('GET', `/api/v1/questions/${json.id}`, conf)
    if (r.json.status === 'answered') {
      let answer = r.json.answer
      if (conf.encKey && typeof answer === 'string') answer = await decrypt(conf.encKey, answer)
      process.stderr.write('\n')
      console.log(JSON.stringify(answer)) // stdout = machine-readable
      return
    }
    if (r.json.status === 'expired') die('Question expired with no answer.')
    process.stderr.write('.')
    await sleep(i < 30 ? 10_000 : 30_000)
  }
  die('Timed out waiting for an answer.')
}

// Encrypt blocks into the request when E2E is on, else send them plain.
async function attachBlocks(body, blocks, conf, kindForValidation) {
  void kindForValidation
  if (flags.e2e || conf.encKey) {
    if (!conf.encKey) die('--e2e requires an encryption key (set encKey via `login --enc-key`).')
    body.enc = true
    body.blocks = await encrypt(conf.encKey, blocks)
  } else {
    body.blocks = blocks
  }
}

function status() {
  const cfg = loadConfig()
  console.log('\nAgent Dash CLI')
  console.log('  config:  ' + (cfg.url ? 'saved' : '(none — run `agent-dash login`)'))
  if (cfg.url) console.log('  hub:     ' + cfg.url)
  console.log('  e2e:     ' + (cfg.encKey ? 'on (encryption key set)' : 'off'))
  console.log('')
}

function help() {
  console.log(`
agent-dash — CLI for your Agent Dash hub

  agent-dash login [--url U --key K] [--enc-key E]   Save + verify hub credentials
  agent-dash connect                                Write ./.mcp.json for your agent
  agent-dash open                                   QR to log in on your phone
  agent-dash notify "msg" [--priority 1 --project P --task T --model M --markdown "…" --tag x]
  agent-dash ask "q" --button A --button B [--project P …]   Ask + wait, prints the answer JSON
  agent-dash status                                 Show current config

  --e2e            End-to-end encrypt block content (needs --enc-key set at login)
  Env: AGENT_DASH_URL, AGENT_KEY, AGENT_DASH_ENC_KEY override saved config.
`)
}

const run = { login, connect, open, notify, ask, status, help }[cmd] || help
await run()
