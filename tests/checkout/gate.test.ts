// D-46: the deployed demo's gate. The password check is core's (tests/unit/demo-gate.test.ts); this covers Turnstile's
// exempt paths and what src/proxy.ts answers. The password below is made up per run; none is ever committed.
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { admit, ownCredential } from '@/checkout/gate';
import { config, proxy } from '@/proxy';

const password = randomUUID();
const basic = (pw: string) => `Basic ${Buffer.from(`anyone:${pw}`).toString('base64')}`;
const deployed = { DEMO_ACCESS_PASSWORD: password, VERCEL: '1' };

describe('the demo gate on a deployed Turnstile (D-46)', () => {
  it('exempts only the routes with their own credential: cron, the Stripe webhook, the bearer API', () => {
    for (const p of ['/api/cron', '/api/checkout/webhook', '/api/v1/events', '/api/v1/projects/abc']) expect(ownCredential(p)).toBe(true);
    for (const p of ['/', '/demo', '/demo/signin', '/login', '/onboarding', '/api/health', '/api/checkout', '/api/checkout/webhook/x', '/api/cron/x', '/api/v1', '/o/acme/events/EV-SYNTH-001/buy'])
      expect(ownCredential(p)).toBe(false);
  });

  it('challenges /demo and every screen without the password, and admits them with it', () => {
    for (const p of ['/demo', '/demo/signin', '/', '/o/acme/events/EV-SYNTH-001/door', '/api/health']) {
      const r = admit(p, null, deployed);
      expect(r?.status).toBe(401);
      expect(r?.headers.get('WWW-Authenticate')).toMatch(/^Basic /);
      expect(admit(p, basic('wrong'), deployed)?.status).toBe(401);
      expect(admit(p, basic(password), deployed)).toBeNull();
    }
  });

  it('never stands in front of the Stripe webhook or the cron, password or not', () => {
    for (const p of ['/api/checkout/webhook', '/api/cron']) {
      expect(admit(p, null, deployed)).toBeNull();
      expect(admit(p, 'Bearer something', deployed)).toBeNull();
      expect(admit(p, null, { VERCEL: '1' })).toBeNull();
    }
  });

  it('fails closed on Vercel with no password (503), and is open off Vercel', () => {
    expect(admit('/demo', null, { VERCEL: '1' })?.status).toBe(503);
    expect(admit('/demo', basic(password), { VERCEL: '1' })?.status).toBe(503);
    expect(admit('/demo', null, {})).toBeNull();
  });

  it('src/proxy.ts lets requests through off Vercel (the test environment has no password) and skips only static files', () => {
    expect(proxy(new NextRequest('http://localhost:7700/demo')).headers.get('x-middleware-next')).toBe('1');
    const m = new RegExp(`^${config.matcher}$`);
    for (const p of ['/demo', '/api/health', '/o/acme', '/']) expect(m.test(p)).toBe(true);
    for (const p of ['/_next/static/chunks/a.js', '/_next/image', '/favicon.ico']) expect(m.test(p)).toBe(false);
  });
});
