#!/usr/bin/env node
// Generate deterministic synthetic example data into public/examples/.
// Two domains: SMB finance + access logs. Designed to exercise the
// taxonomy detectors (GSTIN, PAN, IFSC, HSN, ISO codes, timestamps, etc.)
// without exposing any real records. Re-runnable: same seed → same output.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve('public/examples');

// Deterministic LCG so the same seed produces the same data.
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const rand = rng(20260515);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

// --- GSTIN ---------------------------------------------------------------
// Alphabet for the GSTIN checksum is base-36.
const ALPHA36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const A36 = (c) => ALPHA36.indexOf(c);
const C36 = (n) => ALPHA36[n];

function gstinCheckDigit(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = A36(first14[i]);
    const mul = (i + 1) % 2 === 0 ? 2 : 1;
    let p = v * mul;
    p = Math.floor(p / 36) + (p % 36);
    sum += p;
  }
  return C36((36 - (sum % 36)) % 36);
}

function gstin(state, pan) {
  // state: 2-digit code, pan: 10-char PAN
  // GSTIN = state + PAN + entity (digit) + 'Z' + check
  const entity = '1';
  const first14 = `${state}${pan}${entity}Z`;
  return first14 + gstinCheckDigit(first14);
}

function pan() {
  // 5 letters, 4 digits, 1 letter
  const L = () => ALPHA36[10 + Math.floor(rand() * 26)];
  const D = () => Math.floor(rand() * 10);
  return `${L()}${L()}${L()}${L()}${L()}${D()}${D()}${D()}${D()}${L()}`;
}

function ifsc() {
  const bank = pick(['HDFC', 'ICIC', 'SBIN', 'AXIS', 'KKBK', 'PUNB', 'UTIB', 'YESB']);
  const branch = Array.from({ length: 6 }, () =>
    pick('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
  ).join('');
  return `${bank}0${branch}`;
}

// --- Domain data ---------------------------------------------------------
const STATE_CODES = ['27', '29', '33', '07', '06', '36', '24', '19'];
const VENDOR_NAMES = [
  'Sharma Trading Co',
  'Patel Enterprises Pvt Ltd',
  'Reddy Logistics',
  'Kumar & Sons',
  'Verma Distributors',
  'Mehta Industrial Supplies',
  'Chopra Steels',
  'Banerjee Office Solutions',
  'Iyer Electrical Works',
  'Joshi Plastics',
  'Nair Stationery House',
  'Singh Hardware',
  'Gupta Polymers',
  'Rao Packaging',
  'Khan Auto Spares',
  'Pillai Textile Mills',
  'Bose Imaging',
  'Mahadevan Tools',
  'Acharya Foods',
  'Choudhary Cement',
  'Desai Glassworks',
  'Eshwar Forging',
  'Fernandes Marine',
  'Ghosh Pharma',
  'Hegde Coffee',
];

const HSN_CODES = [
  '4818', '7308', '8443', '8471', '8528', '9403', '6403', '3917', '7321', '8517',
  '4202', '2106', '9018', '6109', '8302', '8536', '7616', '3923', '7610', '8504',
];

const GST_RATES = [5, 12, 18, 28];
const PAYMENT_STATUS = ['paid', 'pending', 'overdue', 'partial'];
const PAYMENT_MODE = ['neft', 'rtgs', 'upi', 'cheque', 'cash'];

function* dateRange(startIso, count, stepDays = 3) {
  const start = new Date(startIso).getTime();
  for (let i = 0; i < count; i++) {
    const d = new Date(start + i * stepDays * 86400000);
    yield d.toISOString().slice(0, 10);
  }
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

// --- Generate finance fixtures -------------------------------------------
const vendors = VENDOR_NAMES.map((name, i) => {
  const state = pick(STATE_CODES);
  const p = pan();
  const g = gstin(state, p);
  return {
    vendor_id: `V${String(i + 1).padStart(4, '0')}`,
    vendor_name: name,
    gstin: g,
    pan: p,
    state_code: state,
    ifsc: ifsc(),
    account_no: String(Math.floor(rand() * 1e14)).padStart(14, '0'),
    contact_email: `${name.toLowerCase().replace(/[^a-z]/g, '')}@example.in`,
  };
});

const invoices = [];
let invIdx = 1;
const dates = Array.from(dateRange('2026-01-02', 80));
for (let i = 0; i < 80; i++) {
  const v = pick(vendors);
  const hsn = pick(HSN_CODES);
  const rate = pick(GST_RATES);
  const taxable = Math.round((rand() * 250000 + 5000) * 100) / 100;
  const isInter = pick([true, false]);
  const cgst = isInter ? 0 : (taxable * rate) / 200;
  const sgst = isInter ? 0 : (taxable * rate) / 200;
  const igst = isInter ? (taxable * rate) / 100 : 0;
  const total = +(taxable + cgst + sgst + igst).toFixed(2);
  invoices.push({
    invoice_no: `INV/26-27/${String(invIdx++).padStart(5, '0')}`,
    invoice_date: dates[i],
    vendor_gstin: v.gstin,
    vendor_name: v.vendor_name,
    hsn_code: hsn,
    gst_rate: rate,
    taxable_amount: taxable.toFixed(2),
    cgst: cgst.toFixed(2),
    sgst: sgst.toFixed(2),
    igst: igst.toFixed(2),
    total_amount: total.toFixed(2),
    payment_status: pick(PAYMENT_STATUS),
  });
}

const payments = [];
let payIdx = 1;
for (const inv of invoices) {
  if (inv.payment_status === 'pending') continue;
  const amount = inv.payment_status === 'partial'
    ? +(Number(inv.total_amount) * 0.4).toFixed(2)
    : Number(inv.total_amount);
  const lag = Math.floor(rand() * 45) + 1;
  const payDate = new Date(new Date(inv.invoice_date).getTime() + lag * 86400000)
    .toISOString()
    .slice(0, 10);
  payments.push({
    payment_id: `PMT-${String(payIdx++).padStart(5, '0')}`,
    invoice_no: inv.invoice_no,
    payment_date: payDate,
    amount_paid: amount.toFixed(2),
    mode: pick(PAYMENT_MODE),
    reference: `REF${Math.floor(rand() * 1e10)
      .toString()
      .padStart(10, '0')}`,
  });
}

// --- Generate access logs fixture ----------------------------------------
const SERVICES = ['api', 'auth', 'billing', 'search', 'reports'];
const ENDPOINTS = {
  api: ['/v1/orders', '/v1/customers', '/v1/products', '/v1/invoices'],
  auth: ['/login', '/refresh', '/logout', '/me'],
  billing: ['/charge', '/refund', '/subscribe', '/invoice'],
  search: ['/search', '/suggest', '/index'],
  reports: ['/run', '/list', '/export'],
};
const LEVELS = ['info', 'info', 'info', 'info', 'warn', 'error'];
const STATUSES = [200, 200, 200, 200, 200, 201, 204, 301, 400, 404, 500, 502];

const logLines = [];
const baseTs = new Date('2026-05-10T00:00:00Z').getTime();
for (let i = 0; i < 240; i++) {
  const service = pick(SERVICES);
  const endpoint = pick(ENDPOINTS[service]);
  const level = pick(LEVELS);
  const status = level === 'error' ? pick([500, 502, 503, 504]) : pick(STATUSES);
  const duration = Math.floor(rand() * 800) + 20;
  logLines.push({
    timestamp: new Date(baseTs + i * 47_000 + Math.floor(rand() * 12_000)).toISOString(),
    level,
    service,
    endpoint,
    status,
    duration_ms: duration,
    request_id: `req_${Math.floor(rand() * 1e12).toString(36)}`,
  });
}

// --- Write ---------------------------------------------------------------
async function main() {
  await mkdir(`${ROOT}/finance`, { recursive: true });
  await mkdir(`${ROOT}/logs`, { recursive: true });
  await writeFile(`${ROOT}/finance/vendors.csv`, toCsv(vendors));
  await writeFile(`${ROOT}/finance/invoices.csv`, toCsv(invoices));
  await writeFile(`${ROOT}/finance/payments.csv`, toCsv(payments));
  await writeFile(
    `${ROOT}/logs/access.jsonl`,
    logLines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );

  const manifest = {
    bundle: 'naklidata-examples',
    version: '0.1',
    sources: [
      {
        id: 'finance',
        label: 'SMB Finance',
        description: 'Synthetic GSTIN-stamped invoice + vendor + payment data.',
        files: [
          { path: 'finance/vendors.csv', table: 'vendors', format: 'csv' },
          { path: 'finance/invoices.csv', table: 'invoices', format: 'csv' },
          { path: 'finance/payments.csv', table: 'payments', format: 'csv' },
        ],
      },
      {
        id: 'logs',
        label: 'Access logs',
        description: 'Synthetic NDJSON access logs with service + endpoint + latency.',
        files: [{ path: 'logs/access.jsonl', table: 'access_logs', format: 'jsonl' }],
      },
    ],
  };
  await writeFile(`${ROOT}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(
    `Wrote: vendors(${vendors.length}), invoices(${invoices.length}), payments(${payments.length}), logs(${logLines.length})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
