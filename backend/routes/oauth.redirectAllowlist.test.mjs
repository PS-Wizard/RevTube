import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createOAuthRouter } from './oauth.js';

const ENV_KEYS = ['YOUTUBE_OAUTH_REDIRECT_URIS', 'VITE_FRONTEND_URL'];
const saved = {};

beforeEach(() => {
  ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
});
afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
  vi.restoreAllMocks();
});

// Drive the real router's /exchange endpoint and read the HTTP status. A 400
// means the redirect URI was rejected by the allowlist; 502/500 means it
// passed the allowlist and failed later (we stub the token call, so any
// non-400 proves the URI was accepted).
async function statusForRedirect(redirectUri) {
  const router = createOAuthRouter({
    authenticateRequest: (_req, _res, next) => next(),
    oauthLimiter: (_req, _res, next) => next(),
    serverCache: { get: async () => null, set: async () => {} },
    shortHash: () => 'h',
    OAUTH_TOKEN_CACHE_TTL_MS: 1000,
    handleApiError: (err, res) => res.status(500).json({ error: err.message }),
    axios: { post: async () => { throw new Error('token call stubbed'); } },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/oauth', router);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/oauth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'x', redirectUri }),
    });
    return res.status;
  } finally {
    server.close();
  }
}

describe('OAuth redirect URI allowlist is env-driven', () => {
  it('always allows loopback callbacks for local dev', async () => {
    process.env.YOUTUBE_OAUTH_REDIRECT_URIS = 'https://prod.example.com/oauth-callback.html';
    expect(await statusForRedirect('http://localhost:8081/oauth-callback.html')).not.toBe(400);
  });

  it('accepts a host supplied via YOUTUBE_OAUTH_REDIRECT_URIS', async () => {
    process.env.YOUTUBE_OAUTH_REDIRECT_URIS = 'https://prod.example.com/oauth-callback.html';
    expect(await statusForRedirect('https://prod.example.com/oauth-callback.html')).not.toBe(400);
  });

  it('accepts a host implied by VITE_FRONTEND_URL, including a trailing slash', async () => {
    process.env.VITE_FRONTEND_URL = 'https://prod.example.com/';
    expect(await statusForRedirect('https://prod.example.com/oauth-callback.html')).not.toBe(400);
  });

  it('rejects an unlisted host when env is configured', async () => {
    process.env.YOUTUBE_OAUTH_REDIRECT_URIS = 'https://prod.example.com/oauth-callback.html';
    expect(await statusForRedirect('https://evil.example.org/oauth-callback.html')).toBe(400);
  });

  it('rejects a host not implied by the configured frontend URL', async () => {
    process.env.VITE_FRONTEND_URL = 'https://prod.example.com';
    expect(await statusForRedirect('https://other.example.org/oauth-callback.html')).toBe(400);
  });

  it('does not hardcode any production host: a well-known host is rejected when unset', async () => {
    // Regression guard. If a production domain is ever baked back into the
    // source, this starts passing and the test fails.
    process.env.YOUTUBE_OAUTH_REDIRECT_URIS = 'https://prod.example.com/oauth-callback.html';
    const previouslyHardcoded = [
      'https://rev.sachinsubedi.com.np/oauth-callback.html',
    ];
    for (const uri of previouslyHardcoded) {
      expect(await statusForRedirect(uri)).toBe(400);
    }
  });

  it('warns when a redirect URI has a doubled scheme', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.YOUTUBE_OAUTH_REDIRECT_URIS =
      'https://https://prod.example.com/oauth-callback.html';
    await statusForRedirect('https://prod.example.com/oauth-callback.html');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('Malformed redirect URI'))).toBe(true);
  });
});
