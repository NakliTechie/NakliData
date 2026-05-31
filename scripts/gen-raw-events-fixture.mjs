#!/usr/bin/env node
// Generate a synthetic raw-events JSONL fixture for Wave 4 verification.
//
// Workplan follow-up #3 (carried from demo verification 2026-05-31): the
// queued retention-analysis xlsx is pre-aggregated metrics, not raw
// events, so W4.2/W4.3/W4.4/W4.5 templates (DAU, Top events, Funnel,
// Cohort, TOP_PATHS) couldn't be verified end-to-end. This script ships
// a realistic 1500-row event log under public/examples/ so the demo
// flow has something to exercise those surfaces against.
//
// Shape is deliberately Mixpanel/Amplitude/PostHog-ish:
//   { event_name, user_id, session_id, event_timestamp, utm_source,
//     utm_medium, utm_campaign, page_url, event_properties: {...} }
//
// Generator is deterministic (seeded PRNG) so the file regenerates
// byte-identically every time — important for the bundle-size gate.
//
// Usage:
//   node scripts/gen-raw-events-fixture.mjs > public/examples/events/events.jsonl
//
// Or run via the npm script wrapper (no args; writes to the canonical
// path):
//   npm run gen:events

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OUT = resolve('public/examples/events/events.jsonl');
const N_EVENTS = 1500;
const N_USERS = 220;
// 30-day window ending 2026-05-30 (matches the workplan date stamp).
const END_MS = Date.UTC(2026, 4, 30, 23, 59, 59);
const WINDOW_DAYS = 30;
const SEED = 0xc0ffee;

// --- deterministic PRNG -------------------------------------------------
// Mulberry32: simple, fast, fine for fixture generation.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const between = (lo, hi) => Math.floor(rand() * (hi - lo + 1)) + lo;

// --- catalog ------------------------------------------------------------
// Funnel + cohort + retention all benefit from a small canonical event
// vocabulary the templates can match against. The list is biased so
// "page_view" and "product_view" dominate, with progressively rarer
// down-funnel events — gives Top-Events a meaningful Pareto curve.
const EVENT_WEIGHTS = [
  ['page_view', 32],
  ['product_view', 22],
  ['add_to_cart', 12],
  ['begin_checkout', 7],
  ['login', 6],
  ['signup', 4],
  ['search', 5],
  ['video_play', 4],
  ['share', 3],
  ['purchase', 3],
  ['logout', 2],
];
function weightedEventPick() {
  const total = EVENT_WEIGHTS.reduce((acc, [, w]) => acc + w, 0);
  let n = rand() * total;
  for (const [name, w] of EVENT_WEIGHTS) {
    n -= w;
    if (n <= 0) return name;
  }
  return EVENT_WEIGHTS[EVENT_WEIGHTS.length - 1][0];
}

const UTM_SOURCES = ['google', 'twitter', 'linkedin', 'newsletter', 'direct', 'reddit', 'meta'];
const UTM_MEDIA = ['cpc', 'organic', 'social', 'email', 'referral', '(none)'];
const UTM_CAMPAIGNS = [
  'spring-launch',
  'retargeting-22',
  'brand-awareness',
  'price-drop',
  'newsletter-w22',
  'newsletter-w23',
  '(none)',
];
const PAGES = [
  '/',
  '/products',
  '/products/electronics',
  '/products/apparel',
  '/products/home',
  '/checkout',
  '/account',
  '/search',
  '/blog/spring-deals',
  '/blog/sizing-guide',
];

// --- users --------------------------------------------------------------
// Each user has a stable signup-day offset (cohort) + a utm tuple at
// signup that travels with them on the first row. Subsequent rows lose
// the utm fields (or keep them with low probability — matches real-world
// shape where attribution is captured on first-touch).
const users = [];
for (let i = 0; i < N_USERS; i++) {
  const cohortDayOffset = between(0, WINDOW_DAYS - 1); // day in window
  const persistence = Math.pow(rand(), 1.5); // most users churn quickly
  users.push({
    user_id: `u_${(i + 1).toString().padStart(4, '0')}`,
    cohortDayOffset,
    sessionsPerUser: Math.max(1, Math.round(persistence * 8)),
    utm_source: pick(UTM_SOURCES),
    utm_medium: pick(UTM_MEDIA),
    utm_campaign: pick(UTM_CAMPAIGNS),
  });
}

// --- generate events ----------------------------------------------------
const rows = [];
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const startMs = END_MS - WINDOW_DAYS * MS_PER_DAY;

// Distribute events across users by weighted sample (high-persistence
// users get more events). Pre-build a pool of user picks weighted by
// sessionsPerUser so the loop below is simple.
const userPool = [];
for (const u of users) {
  for (let k = 0; k < u.sessionsPerUser; k++) userPool.push(u);
}

let sessionCounter = 0;
while (rows.length < N_EVENTS) {
  const u = pick(userPool);
  // Sessions only happen on/after the user's cohort day.
  const cohortMs = startMs + u.cohortDayOffset * MS_PER_DAY;
  const sessionDayOffset = between(0, WINDOW_DAYS - 1 - u.cohortDayOffset);
  const sessionDayMs = cohortMs + sessionDayOffset * MS_PER_DAY;
  // Session starts at a realistic hour (skewed business hours).
  const hour = between(8, 22);
  const minute = between(0, 59);
  const sessionStartMs = sessionDayMs + hour * 60 * 60 * 1000 + minute * 60 * 1000;
  sessionCounter++;
  const session_id = `s_${sessionCounter.toString(36).padStart(5, '0')}`;
  const eventsInSession = between(2, 9);
  // Funnel-like ordering: most sessions start with page_view, drop off
  // toward purchase. We sample weighted as usual but bias by position.
  let t = sessionStartMs;
  for (let i = 0; i < eventsInSession && rows.length < N_EVENTS; i++) {
    t += between(2, 90) * 1000; // 2..90s gaps
    const eventName = i === 0 ? 'page_view' : weightedEventPick();
    const isFirstTouch = i === 0 && u.firstRow !== true;
    if (isFirstTouch) u.firstRow = true;
    const row = {
      event_name: eventName,
      user_id: u.user_id,
      session_id,
      event_timestamp: new Date(t).toISOString(),
      page_url: pick(PAGES),
      // UTM only on first touch (typical attribution semantics).
      ...(isFirstTouch
        ? {
            utm_source: u.utm_source,
            utm_medium: u.utm_medium,
            utm_campaign: u.utm_campaign,
          }
        : {}),
      // Per-event properties — mostly empty, sometimes carry a price/qty
      // for commerce events. event_properties_json is what the W4.1
      // taxonomy keys off.
      event_properties: buildProps(eventName),
    };
    rows.push(row);
  }
}

function buildProps(eventName) {
  if (eventName === 'purchase' || eventName === 'begin_checkout' || eventName === 'add_to_cart') {
    return {
      product_id: `p_${between(1, 60).toString().padStart(3, '0')}`,
      price: Math.round(rand() * 95000) / 100, // 0.00..950.00
      quantity: between(1, 3),
    };
  }
  if (eventName === 'video_play') {
    return {
      video_id: `v_${between(1, 20).toString().padStart(3, '0')}`,
      duration_ms: between(15000, 360000),
    };
  }
  if (eventName === 'search') {
    return { query: pick(['shoes', 'laptop', 'gift', 'wireless headphones', 'jacket']) };
  }
  return {};
}

// Sort by event_timestamp so the JSONL reads chronologically — easier
// for funnel/retention/cohort SQL queries to behave intuitively without
// the user needing an ORDER BY.
rows.sort((a, b) => a.event_timestamp.localeCompare(b.event_timestamp));

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
console.log(`wrote ${rows.length} events → ${OUT}`);
