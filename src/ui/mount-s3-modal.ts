// Wave 2 slice 2 — "Mount S3-compatible bucket" modal. Captures the
// endpoint config + access key + secret. Secrets live in
// `source-secrets.ts` (sessionStorage default + opt-in IDB). UI labelling
// matches the sidecar BYOK pattern from spec amendment A2.

import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _previouslyFocused: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;

export interface MountS3Input {
  label: string;
  endpoint: string;
  region: string;
  bucket: string;
  pathPrefix: string;
  urlStyle: 'vhost' | 'path';
  accessKeyId: string;
  secretAccessKey: string;
  remember: boolean;
}

export function openMountS3Modal(opts: {
  onMount: (input: MountS3Input) => Promise<void> | void;
}): void {
  if (_modalEl && document.body.contains(_modalEl)) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  const overlay = renderModal(opts);
  document.body.append(overlay);
  _modalEl = overlay;
  // Focus the endpoint input — top of the form, most useful first field.
  overlay.querySelector<HTMLInputElement>('[data-region="endpoint-input"]')?.focus();
}

export function closeMountS3Modal(): void {
  if (_modalEl?.parentElement) {
    _modalEl.parentElement.removeChild(_modalEl);
  }
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  // Forward-pass M11: restoreModalFocus handles detached previousFocus.
  restoreModalFocus(_previouslyFocused);
  _previouslyFocused = null;
}

function renderModal(opts: {
  onMount: (input: MountS3Input) => Promise<void> | void;
}): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay mount-s3-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Mount S3-compatible bucket');
  overlay.innerHTML = `
    <div class="schema-graph-modal mount-s3-modal" data-region="mount-s3-modal">
      <div class="schema-graph-header">
        <strong>Mount S3-compatible bucket</strong>
        <button class="btn btn-ghost schema-graph-close" data-action="close-mount-s3" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </div>
      <div class="mount-s3-body">
        <div class="mount-s3-row">
          <label class="mount-url-field">
            <span>Endpoint</span>
            <input type="url" data-region="endpoint-input" placeholder="s3.amazonaws.com" autocomplete="off" spellcheck="false">
          </label>
          <label class="mount-url-field">
            <span>Region</span>
            <input type="text" data-region="region-input" placeholder="us-east-1" autocomplete="off" spellcheck="false">
          </label>
        </div>
        <div class="mount-s3-row">
          <label class="mount-url-field">
            <span>Bucket</span>
            <input type="text" data-region="bucket-input" placeholder="my-bucket" autocomplete="off" spellcheck="false">
          </label>
          <label class="mount-url-field">
            <span>URL style</span>
            <select data-region="url-style-input">
              <option value="vhost">vhost (AWS native)</option>
              <option value="path">path (MinIO / R2 / older S3)</option>
            </select>
          </label>
        </div>
        <label class="mount-url-field">
          <span>Path / file / glob <em>(within the bucket)</em></span>
          <input type="text" data-region="path-prefix-input" placeholder="data/vendors.parquet" autocomplete="off" spellcheck="false">
        </label>
        <div class="mount-s3-row">
          <label class="mount-url-field">
            <span>Access key ID</span>
            <input type="text" data-region="access-key-input" autocomplete="off" spellcheck="false">
          </label>
          <label class="mount-url-field">
            <span>Secret access key</span>
            <input type="password" data-region="secret-key-input" autocomplete="off" spellcheck="false">
          </label>
        </div>
        <label class="mount-url-field mount-s3-remember">
          <input type="checkbox" data-region="remember-input">
          <span>Remember keys on this device <em>— stored plaintext in IndexedDB on this origin. Anyone with access to this browser profile can read them.</em></span>
        </label>
        <label class="mount-url-field">
          <span>Label <em>(optional)</em></span>
          <input type="text" data-region="label-input" placeholder="defaults to bucket / path" autocomplete="off" spellcheck="false">
        </label>
        <p class="mount-url-hint">
          Slice 2 supports <code>.csv</code> / <code>.tsv</code> / <code>.jsonl</code> /
          <code>.parquet</code> over S3-compatible httpfs (AWS S3, MinIO, R2, B2,
          Wasabi). Only one set of S3 credentials per session — mounting a second
          endpoint with different keys will clobber the first.
        </p>
        <div class="mount-url-error" data-region="error" hidden></div>
        <div class="mount-url-actions">
          <button class="btn btn-ghost" data-action="close-mount-s3">Cancel</button>
          <button class="btn btn-primary" data-action="confirm-mount-s3">Mount</button>
        </div>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) closeMountS3Modal();
    if (target.closest('[data-action="close-mount-s3"]')) closeMountS3Modal();
    if (target.closest('[data-action="confirm-mount-s3"]')) void confirmMount(overlay, opts);
  });
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeMountS3Modal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

async function confirmMount(
  overlay: HTMLElement,
  opts: { onMount: (input: MountS3Input) => Promise<void> | void },
): Promise<void> {
  const get = <T extends HTMLInputElement | HTMLSelectElement>(region: string): T | null =>
    overlay.querySelector<T>(`[data-region="${region}"]`);
  const errEl = overlay.querySelector<HTMLElement>('[data-region="error"]');

  const input: MountS3Input = {
    label: get<HTMLInputElement>('label-input')?.value.trim() ?? '',
    endpoint: get<HTMLInputElement>('endpoint-input')?.value.trim() ?? '',
    region: get<HTMLInputElement>('region-input')?.value.trim() ?? '',
    bucket: get<HTMLInputElement>('bucket-input')?.value.trim() ?? '',
    pathPrefix: get<HTMLInputElement>('path-prefix-input')?.value.trim() ?? '',
    urlStyle:
      (get<HTMLSelectElement>('url-style-input')?.value as 'vhost' | 'path' | undefined) ?? 'vhost',
    accessKeyId: get<HTMLInputElement>('access-key-input')?.value.trim() ?? '',
    secretAccessKey: get<HTMLInputElement>('secret-key-input')?.value ?? '',
    remember: get<HTMLInputElement>('remember-input')?.checked ?? false,
  };

  const required: Array<[keyof MountS3Input, string]> = [
    ['endpoint', 'Endpoint'],
    ['bucket', 'Bucket'],
    ['pathPrefix', 'Path / file / glob'],
    ['accessKeyId', 'Access key ID'],
    ['secretAccessKey', 'Secret access key'],
  ];
  for (const [field, label] of required) {
    if (!String(input[field]).trim()) {
      if (errEl) {
        errEl.textContent = `${label} is required.`;
        errEl.hidden = false;
      }
      get<HTMLInputElement>(
        `${String(field)
          .replace(/([A-Z])/g, '-$1')
          .toLowerCase()}-input`,
      )?.focus();
      return;
    }
  }
  if (errEl) {
    errEl.textContent = '';
    errEl.hidden = true;
  }
  try {
    await opts.onMount(input);
    closeMountS3Modal();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      errEl.hidden = false;
    }
  }
}
