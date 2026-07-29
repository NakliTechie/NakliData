import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('deployment privacy policy', () => {
  it('keeps Cloudflare observability disabled', () => {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8')) as {
      observability?: { enabled?: boolean };
    };
    expect(config.observability?.enabled).toBe(false);
  });

  it('runs dependency advisories in trusted CI', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
    expect(workflow).toContain('npm audit --audit-level=high');
  });
});
