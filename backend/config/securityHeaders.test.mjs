import { describe, it, expect } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import securityHeadersModule from './securityHeaders.js';

const { CSP_DIRECTIVES, securityHeaders } = securityHeadersModule;

// Boots a throwaway app with the real helmet options and returns the headers
// of a single request, so the assertions are against the emitted policy
// string rather than the config object.
async function headersForRequest() {
  const app = express();
  app.use(helmet(securityHeaders()));
  app.get('/probe', (_req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/probe`);
    return res.headers;
  } finally {
    server.close();
  }
}

describe('securityHeaders', () => {
  it('enforces a Content-Security-Policy instead of disabling it', async () => {
    const headers = await headersForRequest();
    const csp = headers.get('content-security-policy');
    expect(csp).toBeTruthy();
  });

  it('locks scripts to self (no inline script, no eval)', async () => {
    const csp = (await headersForRequest()).get('content-security-policy');
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    // 'unsafe-inline' is allowed for styles only, never for scripts.
    const scriptSrc = csp.split('script-src')[1].split(';')[0];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('allows inline styles for the Bull Board React runtime', async () => {
    const csp = (await headersForRequest()).get('content-security-policy');
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('blocks plugins, framing and base-tag hijacking', async () => {
    const csp = (await headersForRequest()).get('content-security-policy');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it('keeps cross-origin resource policy permissive for the frontend origin', () => {
    // CSP -- not CORP -- is what restricts content; CORP must stay open or the
    // separate frontend origin cannot read API responses.
    expect(securityHeaders().crossOriginResourcePolicy).toEqual({ policy: 'cross-origin' });
  });

  it('emits upgrade-insecure-requests with no host list', async () => {
    // An empty array keeps the directive stable across http and https.
    expect(CSP_DIRECTIVES.upgradeInsecureRequests).toEqual([]);
    const csp = (await headersForRequest()).get('content-security-policy');
    expect(csp).toContain('upgrade-insecure-requests');
  });
});

