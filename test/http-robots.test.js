import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpClient, isBlockPage } from '../collector/src/http.js';
import { fetchRobots, parseRobots, robotsDecision } from '../collector/src/robots.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'collector', 'fixtures');
const observedRobots = fs.readFileSync(path.join(fixturesDir, 'atr-robots-observed-2026-10-18.txt'), 'utf8');

function makeResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      forEach(callback) {
        for (const [key, value] of Object.entries(headers)) callback(value, key);
      }
    },
    async text() {
      return body;
    }
  };
}

function makeClient(fetchImpl, overrides = {}) {
  return createHttpClient({
    fetchImpl,
    sleep: async () => {},
    now: (() => {
      let t = 0;
      return () => (t += 60000);
    })(),
    random: () => 0,
    intervalMs: 0,
    ...overrides
  });
}

test('robots.txt snapshot is parsed with both agent groups', () => {
  const robots = parseRobots(observedRobots);
  assert.equal(robots.groups.length, 2);
  assert.deepEqual(robots.sitemaps, ['https://www.attheraces.com/sitemap.xml']);
});

test('robots decisions match the observed ATR rules', () => {
  const robots = parseRobots(observedRobots);
  const ua = 'atr-research-collector';
  assert.equal(robotsDecision(robots, { path: '/racecards/2026-08-01', userAgent: ua }).allowed, true);
  assert.equal(robotsDecision(robots, { path: '/racecard/fixtureton/2026-08-01/1001', userAgent: ua }).allowed, true);
  assert.equal(robotsDecision(robots, { path: '/ajax/odds', userAgent: ua }).allowed, false);
  assert.equal(robotsDecision(robots, { path: '/userlogin/', userAgent: ua }).allowed, false);
  assert.equal(robotsDecision(robots, { path: '/user/login', userAgent: ua }).allowed, false);
  assert.equal(robotsDecision(robots, { path: '/userprofile', userAgent: ua }).allowed, false);
  assert.equal(robotsDecision(robots, { path: '/racecard/1?showResult=yes', userAgent: ua }).allowed, false);
  const bing = robotsDecision(robots, { path: '/form/', userAgent: 'bingbot' });
  assert.equal(bing.allowed, false);
  assert.equal(robotsDecision(robots, { path: '/form/', userAgent: ua }).allowed, true);
});

test('an absent robots.txt is tolerated but recorded', async () => {
  const client = makeClient(async () => makeResponse(404, 'not found'));
  const result = await fetchRobots(client, 'https://example.test');
  assert.equal(result.present, false);
  assert.equal(result.unclear, false);
});

test('an unreachable robots.txt is treated as unclear and stops collection', async () => {
  const client = makeClient(async () => makeResponse(403, 'denied'));
  const result = await fetchRobots(client, 'https://example.test');
  assert.equal(result.unclear, true);
});

test('http 403 responses stop immediately without retries', async () => {
  let calls = 0;
  const client = makeClient(async () => {
    calls += 1;
    return makeResponse(403, 'forbidden');
  });
  const response = await client.request('https://example.test/racecards/2026-08-01');
  assert.equal(response.blocked, true);
  assert.equal(response.reason, 'http_403');
  assert.equal(calls, 1);
  assert.equal(client.stats.requests, 1);
  assert.equal(client.stats.retries, 0);
});

test('http 429 responses are treated as blocked with Retry-After captured', async () => {
  const client = makeClient(async () => makeResponse(429, 'slow down', { 'retry-after': '30' }));
  const response = await client.request('https://example.test/x');
  assert.equal(response.blocked, true);
  assert.equal(response.reason, 'http_429_rate_limited');
  assert.equal(response.retryAfterMs, 30000);
});

test('server errors retry with bounded backoff and can recover', async () => {
  let calls = 0;
  const client = makeClient(async () => {
    calls += 1;
    if (calls < 3) return makeResponse(503, 'unavailable');
    return makeResponse(200, '<html>ok</html>');
  });
  const response = await client.request('https://example.test/x');
  assert.equal(response.ok, true);
  assert.equal(response.attempts, 3);
  assert.equal(client.stats.retries, 2);
});

test('timeouts retry then surface as an error without throwing', async () => {
  const client = makeClient(async () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  });
  const response = await client.request('https://example.test/x');
  assert.equal(response.ok, false);
  assert.equal(response.error, 'timeout');
  assert.equal(response.attempts, 3);
});

test('a 200 response containing a challenge page is still a block', async () => {
  const client = makeClient(async () => makeResponse(200, '<html><title>Just a moment...</title></html>'));
  const response = await client.request('https://example.test/x');
  assert.equal(response.ok, false);
  assert.equal(response.blocked, true);
  assert.equal(response.reason, 'challenge_page_detected');
});

test('the request budget is enforced', async () => {
  const client = makeClient(async () => makeResponse(200, 'ok'), { maxRequests: 1 });
  const first = await client.request('https://example.test/1');
  assert.equal(first.ok, true);
  const second = await client.request('https://example.test/2');
  assert.equal(second.budgetExceeded, true);
});

test('isBlockPage does not flag ordinary fixture pages', () => {
  assert.equal(isBlockPage('<html><body>racecard content</body></html>'), false);
  assert.equal(isBlockPage(''), false);
  assert.equal(isBlockPage(null), false);
});
