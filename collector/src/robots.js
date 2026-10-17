export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'sitemap') {
      if (!sitemaps.includes(value)) sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (!current || current.rules.length > 0 || current.crawlDelay !== null) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      current.rules.push({ type: field, path: value, length: value.length });
    } else if (field === 'crawl-delay') {
      const delay = Number(value);
      if (Number.isFinite(delay)) current.crawlDelay = delay;
    }
  }
  return { groups, sitemaps };
}

function patternToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const anchored = escaped.endsWith('\\$') ? `${escaped.slice(0, -2)}$` : escaped;
  return new RegExp(`^${anchored}`);
}

function matchGroup(groups, userAgent) {
  const token = String(userAgent || '').toLowerCase();
  let best = null;
  let bestLength = -1;
  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent === '*' || (agent.length > 0 && token.includes(agent))) {
        const specificity = agent === '*' ? 0 : agent.length;
        if (specificity > bestLength) {
          best = group;
          bestLength = specificity;
        }
      }
    }
  }
  return best;
}

export function robotsDecision(robots, { path, userAgent }) {
  const group = matchGroup(robots.groups || [], userAgent);
  if (!group || group.rules.length === 0) {
    return {
      allowed: true,
      rule: null,
      crawlDelayMs: group && group.crawlDelay !== null ? group.crawlDelay * 1000 : null,
      reason: 'no matching disallow rules'
    };
  }
  const candidates = group.rules
    .map((rule) => {
      if (rule.path === '') return rule.type === 'allow' ? { ...rule, matches: true, length: 0 } : { ...rule, matches: false, length: 0 };
      return { ...rule, matches: patternToRegex(rule.path).test(path) };
    })
    .filter((rule) => rule.matches)
    .sort((a, b) => (b.length - a.length) || (a.type === 'allow' ? -1 : 1));
  const winner = candidates[0] || null;
  return {
    allowed: winner === null || winner.type === 'allow',
    rule: winner,
    crawlDelayMs: group.crawlDelay !== null ? group.crawlDelay * 1000 : null,
    reason: winner ? `${winner.type}:${winner.path}` : 'no matching rule for this path'
  };
}

export async function fetchRobots(client, siteBase) {
  const url = `${siteBase}/robots.txt`;
  const response = await client.request(url);
  if (response.blocked) {
    return { present: null, unclear: true, url, reason: response.reason || 'robots_unreachable_blocked' };
  }
  if (response.status === 404) {
    return { present: false, unclear: false, url, parsed: { groups: [], sitemaps: [] }, reason: 'robots.txt not found (no restrictions published at this URL)' };
  }
  if (!response.ok) {
    return { present: null, unclear: true, url, reason: response.error || `robots_http_${response.status}` };
  }
  return { present: true, unclear: false, url, parsed: parseRobots(response.body), reason: 'parsed' };
}
