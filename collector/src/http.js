export function createHttpClient(options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = 20000,
    intervalMs = 5000,
    maxRetries = 2,
    retryBaseMs = 1500,
    maxRetryAfterMs = 60000,
    maxRequests = Number.POSITIVE_INFINITY,
    userAgent = 'atr-research-collector',
    logger = () => {},
    now = () => Date.now(),
    random = Math.random
  } = options;

  const stats = { requests: 0, retries: 0, blocked: false, totalBytes: 0 };
  let lastRequestAt = 0;
  let budgetExceeded = false;

  const backoffMs = (attempt) => retryBaseMs * 2 ** (attempt - 1) + Math.floor(random() * 500);

  function parseRetryAfter(headers) {
    if (!headers) return null;
    const raw = headers['retry-after'] || headers['Retry-After'];
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, maxRetryAfterMs);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.min(Math.max(date - now(), 0), maxRetryAfterMs);
    return null;
  }

  async function throttle() {
    const wait = lastRequestAt + intervalMs - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
  }

  async function request(url, { method = 'GET' } = {}) {
    if (budgetExceeded) return { ok: false, blocked: false, budgetExceeded: true, status: 0, body: '', error: 'request budget exhausted' };
    if (stats.requests >= maxRequests) {
      budgetExceeded = true;
      return { ok: false, blocked: false, budgetExceeded: true, status: 0, body: '', error: 'request budget exhausted' };
    }

    let attempt = 0;
    let lastError = null;
    while (attempt <= maxRetries) {
      await throttle();
      stats.requests += 1;
      if (attempt > 0) stats.retries += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method,
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'User-Agent': userAgent,
            Accept: 'text/html,application/xhtml+xml'
          }
        });
        clearTimeout(timer);
        const body = await response.text();
        stats.totalBytes += body.length;
        const headers = {};
        if (response.headers && typeof response.headers.forEach === 'function') {
          response.headers.forEach((value, key) => {
            headers[String(key).toLowerCase()] = value;
          });
        }
        const base = { ok: response.ok, status: response.status, headers, body, attempts: attempt + 1, url };

        if (response.status === 401 || response.status === 403) {
          stats.blocked = true;
          return { ...base, ok: false, blocked: true, reason: `http_${response.status}` };
        }
        if (response.status === 429) {
          stats.blocked = true;
          return { ...base, ok: false, blocked: true, reason: 'http_429_rate_limited', retryAfterMs: parseRetryAfter(headers) };
        }
        if (response.ok && isBlockPage(body)) {
          stats.blocked = true;
          return { ...base, ok: false, blocked: true, reason: 'challenge_page_detected' };
        }
        if (response.ok) return base;
        if (response.status >= 500 || response.status === 408) {
          lastError = `http_${response.status}`;
          attempt += 1;
          if (attempt <= maxRetries) {
            const wait = parseRetryAfter(headers) ?? backoffMs(attempt);
            logger(`retry ${attempt}/${maxRetries} after ${wait}ms for ${url}`);
            await sleep(wait);
            continue;
          }
          return { ...base, ok: false, error: lastError };
        }
        return { ...base, ok: false, error: `http_${response.status}`, fatal: true };
      } catch (error) {
        clearTimeout(timer);
        lastError = error && error.name === 'AbortError' ? 'timeout' : String((error && error.message) || error);
        attempt += 1;
        if (attempt <= maxRetries) {
          const wait = backoffMs(attempt);
          logger(`retry ${attempt}/${maxRetries} after ${wait}ms for ${url} (${lastError})`);
          await sleep(wait);
          continue;
        }
        return { ok: false, status: 0, headers: {}, body: '', error: lastError, attempts: attempt, url };
      }
    }
    return { ok: false, status: 0, headers: {}, body: '', error: lastError || 'unknown', attempts: attempt, url };
  }

  return { request, stats, isBudgetExceeded: () => budgetExceeded };
}

export function isBlockPage(body) {
  if (typeof body !== 'string' || body.length === 0) return false;
  const sample = body.slice(0, 20000);
  const markers = [
    /just a moment\.\.\./i,
    /cf-chl|cf_chl/i,
    /enable javascript and cookies to continue/i,
    /attention required/i,
    /access denied/i,
    /are you a robot/i,
    /captcha/i,
    /request unsuccessful/i,
    /checking your browser/i
  ];
  return markers.some((pattern) => pattern.test(sample));
}
