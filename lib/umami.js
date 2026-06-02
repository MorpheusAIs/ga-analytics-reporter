function dateToStartMs(date) {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function dateToEndMs(date) {
  return Date.parse(`${date}T23:59:59.999Z`);
}

function metricValue(value) {
  if (value && typeof value === 'object' && 'value' in value) return Number(value.value ?? 0);
  return Number(value ?? 0);
}

function calcDelta(current, previous) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

function rate(part, whole) {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 10000) / 100;
}

function averageDuration(stats) {
  const visits = metricValue(stats.visits);
  if (visits === 0) return 0;
  return Math.round(metricValue(stats.totaltime) / visits);
}

function totalsFromStats(currentStats, previousStats) {
  const current = {
    sessions: metricValue(currentStats.visits),
    totalUsers: metricValue(currentStats.visitors),
    newUsers: metricValue(currentStats.visitors),
    screenPageViews: metricValue(currentStats.pageviews),
    engagementRate: 100 - rate(metricValue(currentStats.bounces), metricValue(currentStats.visits)),
    bounceRate: rate(metricValue(currentStats.bounces), metricValue(currentStats.visits)),
    averageSessionDuration: averageDuration(currentStats),
    eventCount: metricValue(currentStats.pageviews),
    conversions: 0,
  };

  const previous = {
    sessions: metricValue(previousStats.visits),
    totalUsers: metricValue(previousStats.visitors),
    newUsers: metricValue(previousStats.visitors),
    screenPageViews: metricValue(previousStats.pageviews),
    engagementRate: 100 - rate(metricValue(previousStats.bounces), metricValue(previousStats.visits)),
    bounceRate: rate(metricValue(previousStats.bounces), metricValue(previousStats.visits)),
    averageSessionDuration: averageDuration(previousStats),
    eventCount: metricValue(previousStats.pageviews),
    conversions: 0,
  };

  return Object.fromEntries(Object.keys(current).map((key) => [key, {
    value: current[key],
    previous: previous[key],
    delta: calcDelta(current[key], previous[key]),
  }]));
}

async function fetchJson(fetchImpl, url, token) {
  const res = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    throw new Error(`Umami API returned ${res.status}: ${body}`);
  }

  return res.json();
}

function websiteUrl(host, websiteId, path, params) {
  const url = new URL(`/api/websites/${websiteId}/${path}`, host);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url;
}

function sourceMedium(source) {
  if (!source) return { source: '(direct)', medium: '(none)' };
  if (source.includes('google')) return { source, medium: 'organic' };
  return { source, medium: 'referral' };
}

function expandedEngagementRate(item) {
  return 100 - rate(metricValue(item.bounces), metricValue(item.visits));
}

export async function fetchUmamiPropertyReport({
  propertyId,
  websiteId,
  host,
  token,
  startDate,
  endDate,
  prevStartDate,
  prevEndDate,
  fetchImpl = fetch,
}) {
  const baseParams = { startAt: dateToStartMs(startDate), endAt: dateToEndMs(endDate) };
  const previousParams = { startAt: dateToStartMs(prevStartDate), endAt: dateToEndMs(prevEndDate) };

  const [stats, previousStats, channels, referrers, pages, countries, devices] = await Promise.all([
    fetchJson(fetchImpl, websiteUrl(host, websiteId, 'stats', baseParams), token),
    fetchJson(fetchImpl, websiteUrl(host, websiteId, 'stats', previousParams), token),
    fetchJson(fetchImpl, websiteUrl(host, websiteId, 'metrics/expanded', { ...baseParams, type: 'channel', limit: 10 }), token),
    fetchJson(fetchImpl, websiteUrl(host, websiteId, 'metrics/expanded', { ...baseParams, type: 'referrer', limit: 10 }), token),
    fetchJson(fetchImpl, websiteUrl(host, websiteId, 'metrics/expanded', { ...baseParams, type: 'path', limit: 10 }), token),
    fetchJson(fetchImpl, websiteUrl(host, websiteId, 'metrics/expanded', { ...baseParams, type: 'country', limit: 10 }), token),
    fetchJson(fetchImpl, websiteUrl(host, websiteId, 'metrics/expanded', { ...baseParams, type: 'device', limit: 10 }), token),
  ]);

  return {
    propertyId,
    totals: totalsFromStats(stats, previousStats),
    channels: channels.map((item) => ({
      channel: item.name || '(none)',
      sessions: metricValue(item.visits),
      totalUsers: metricValue(item.visitors),
      engagementRate: expandedEngagementRate(item),
    })),
    sources: referrers.map((item) => ({
      ...sourceMedium(item.name),
      sessions: metricValue(item.visits),
    })),
    pages: pages.map((item) => ({
      path: item.name || '/',
      views: metricValue(item.pageviews),
      avgDuration: averageDuration(item),
    })),
    countries: countries.map((item) => ({
      country: item.name || '(unknown)',
      sessions: metricValue(item.visits),
      totalUsers: metricValue(item.visitors),
    })),
    devices: devices.map((item) => ({
      device: item.name || '(unknown)',
      sessions: metricValue(item.visits),
      totalUsers: metricValue(item.visitors),
    })),
  };
}
