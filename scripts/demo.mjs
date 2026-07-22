#!/usr/bin/env node
// Live demos of both directions. Reads WORKER_URL + AGENT_KEY from
// .agent-dash.local.json (or env). Log in on your phone first and keep the app
// open so you can watch.
//
//   node scripts/demo.mjs progress     # live progress bar 0 → 100 → done
//   node scripts/demo.mjs weather      # asks you a city, waits, sends weather
import { loadSecrets } from './lib.mjs'

const s = loadSecrets() ?? {}
const URL = process.env.AGENT_DASH_URL || s.WORKER_URL
const KEY = process.env.AGENT_KEY || s.AGENT_KEY
if (!URL || !KEY) {
  console.error('Missing WORKER_URL / AGENT_KEY. Run `pnpm setup` or set env vars.')
  process.exit(1)
}

const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const post = (path, body) => fetch(`${URL}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) }).then((r) => r.json())
const get = (path) => fetch(`${URL}${path}`, { headers: H }).then((r) => r.json())

async function progress() {
  console.log('Creating a progress card…')
  const { id } = await post('/api/v1/events', {
    agent: 'claude-code',
    model: 'claude-opus-4.8',
    project: 'News Digest',
    task: 'Scanning sources',
    tags: ['research'],
    task_id: 'ai-news-scan',
    title: 'Scanning AI news',
    blocks: [
      { type: 'markdown', text: 'Starting a scan across sources…' },
      { type: 'progress', label: 'Sources', value: 0, max: 100 },
    ],
  })
  console.log('Watch the card move in your inbox →', `${URL}/event/${id}`)

  const steps = [
    [20, 'Reading TechCrunch, The Verge…'],
    [40, 'Reading arXiv, HN…'],
    [60, 'Reading company blogs…'],
    [80, 'Summarizing findings…'],
    [100, 'Done.'],
  ]
  for (const [value, note] of steps) {
    await sleep(2500)
    const done = value === 100
    await post(`/api/v1/events/${id}`, {
      title: done ? 'AI news scan complete' : 'Scanning AI news',
      task: done ? 'Done' : 'Scanning sources',
      kind: done ? 'done' : 'update',
      notify: done, // only buzz on completion
      blocks: [
        { type: 'markdown', text: note },
        { type: 'progress', label: 'Sources', value, max: 100 },
        ...(done
          ? [{ type: 'keyvalue', items: [
              { k: 'Articles', v: '37' },
              { k: 'Top story', v: 'New open model tops benchmarks' },
            ] }]
          : []),
      ],
    })
    console.log(`  → ${value}%`)
  }
  console.log('Progress demo complete.')
}

async function weather() {
  console.log('Asking you for a city…')
  const q = await post('/api/v1/questions', {
    agent: 'claude-code',
    model: 'gpt-5',
    project: 'Weather app',
    task: 'Fetching conditions',
    tags: ['weather'],
    title: 'Which city do you want the weather for?',
    timeout_minutes: 30,
    blocks: [
      { type: 'markdown', text: 'Tell me a city and I’ll fetch the current conditions.' },
      { type: 'form', id: 'w', submitLabel: 'Get weather', fields: [
        { id: 'city', kind: 'text', label: 'City', placeholder: 'e.g. Toronto', required: true },
      ] },
    ],
  })
  console.log('Answer it on your phone →', `${URL}/event/${q.id}`)

  // Poll until answered (or it expires).
  let answer = null
  for (let i = 0; i < 180; i++) {
    const r = await get(`/api/v1/questions/${q.id}`)
    if (r.status === 'answered') { answer = r.answer; break }
    if (r.status === 'expired') { console.log('Question expired.'); return }
    process.stdout.write('.')
    await sleep(i < 30 ? 10_000 : 30_000)
  }
  if (!answer) { console.log('\nNo answer yet.'); return }

  const city = String(answer.w?.city ?? '').trim()
  console.log(`\nYou said: ${city}. Fetching weather…`)

  // Free, no-key weather via open-meteo (geocode → current conditions).
  const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`).then((r) => r.json())
  const place = geo.results?.[0]
  if (!place) {
    await post('/api/v1/events', { agent: 'weather-bot', priority: 1, title: `Couldn't find "${city}"`, kind: 'error', blocks: [{ type: 'callout', tone: 'warn', text: 'Try a more specific city name.' }] })
    return
  }
  const wx = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code`).then((r) => r.json())
  const c = wx.current
  const codes = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 61: 'Rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Snow', 80: 'Showers', 95: 'Thunderstorm' }

  await post('/api/v1/events', {
    agent: 'claude-code',
    model: 'gpt-5',
    project: 'Weather app',
    task: 'Fetching conditions',
    tags: ['weather'],
    priority: 1,
    task_id: 'weather',
    title: `Weather in ${place.name}, ${place.country_code}`,
    kind: 'done',
    blocks: [
      { type: 'markdown', text: `### ${Math.round(c.temperature_2m)}°C — ${codes[c.weather_code] ?? 'See details'}` },
      { type: 'keyvalue', items: [
        { k: 'Feels like', v: `${Math.round(c.apparent_temperature)}°C` },
        { k: 'Humidity', v: `${c.relative_humidity_2m}%` },
        { k: 'Wind', v: `${Math.round(c.wind_speed_10m)} km/h` },
      ] },
    ],
  })
  console.log(`Sent weather for ${place.name}: ${Math.round(c.temperature_2m)}°C`)
}

// Mirrors the "Project: Weather app · Current task: Adding children mode ·
// Please choose a color scheme" example. Posts the question and waits.
async function colors() {
  console.log('Posting a color-scheme choice…')
  const q = await post('/api/v1/questions', {
    agent: 'claude-code',
    model: 'claude-opus-4.8',
    project: 'Weather app',
    task: 'Adding children mode',
    tags: ['ui', 'design'],
    title: 'Please choose which color scheme for children mode',
    timeout_minutes: 60,
    blocks: [
      { type: 'markdown', text: 'Building the kids view. Which palette feels right?' },
      { type: 'buttons', id: 'scheme', options: ['Sunshine (yellow/orange)', 'Ocean (blue/teal)', 'Candy (pink/purple)'] },
    ],
  })
  console.log('Answer it on your phone →', `${URL}/event/${q.id}`)
  for (let i = 0; i < 60; i++) {
    const r = await get(`/api/v1/questions/${q.id}`)
    if (r.status === 'answered') { console.log('You chose:', r.answer.scheme); return }
    if (r.status === 'expired') { console.log('Expired.'); return }
    process.stdout.write('.')
    await sleep(10_000)
  }
  console.log('\nStill waiting.')
}

// Ask one question and block until it's answered (or expires). Returns the answer.
async function askAndWait(payload) {
  const q = await post('/api/v1/questions', payload)
  console.log(`  asked: "${payload.title}" → answer on your phone`)
  for (let i = 0; i < 120; i++) {
    const r = await get(`/api/v1/questions/${q.id}`)
    if (r.status === 'answered') return r.answer
    if (r.status === 'expired') return null
    process.stdout.write('.')
    await sleep(i < 30 ? 10_000 : 30_000)
  }
  return null
}

// A whole feature build: several questions under ONE task_id, so they stack
// into a single thread. Answer each on your phone and the next appears in the
// same conversation.
async function feature() {
  const base = { agent: 'claude-code', model: 'claude-opus-4.8', project: 'Weather app', task: 'Adding children mode', task_id: 'feat-childmode' }
  console.log('Kicking off the "children mode" feature (one thread)…')
  await post('/api/v1/events', { ...base, title: 'Starting children mode', blocks: [{ type: 'markdown', text: 'A few decisions before I build it.' }] })

  const a1 = await askAndWait({ ...base, title: 'Which color scheme?', blocks: [{ type: 'buttons', id: 'scheme', options: ['Sunshine', 'Ocean', 'Candy'] }] })
  console.log('\n  → scheme:', a1?.scheme ?? '(no answer)')
  const a2 = await askAndWait({ ...base, title: 'Font size for kids?', blocks: [{ type: 'buttons', id: 'size', options: ['Large', 'Extra large'] }] })
  console.log('\n  → size:', a2?.size ?? '(no answer)')
  const a3 = await askAndWait({ ...base, title: 'Include the animated mascot?', blocks: [{ type: 'buttons', id: 'mascot', options: ['Yes', 'No'] }] })
  console.log('\n  → mascot:', a3?.mascot ?? '(no answer)')

  await post('/api/v1/events', {
    ...base, kind: 'done', priority: 1, title: 'Children mode built',
    blocks: [{ type: 'callout', tone: 'success', text: 'Shipped with your choices.' }, { type: 'keyvalue', items: [
      { k: 'Scheme', v: a1?.scheme ?? '—' }, { k: 'Font', v: a2?.size ?? '—' }, { k: 'Mascot', v: a3?.mascot ?? '—' },
    ] }],
  })
  console.log('\nFeature thread complete.')
}

const cmd = process.argv[2]
if (cmd === 'progress') await progress()
else if (cmd === 'weather') await weather()
else if (cmd === 'colors') await colors()
else if (cmd === 'feature') await feature()
else console.log('Usage: node scripts/demo.mjs [progress|weather|colors|feature]')
