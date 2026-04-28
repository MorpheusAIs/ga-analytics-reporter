import { BetaAnalyticsDataClient } from '@google-analytics/data';

export function createAnalyticsClient() {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) {
    throw new Error(
      'Missing env var GOOGLE_APPLICATION_CREDENTIALS_JSON. ' +
      'Set it to the full JSON string of your GCP service account key.'
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      'Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON as JSON: ' + err.message
    );
  }

  return new BetaAnalyticsDataClient({ credentials });
}

function toNum(val) {
  return Number(val ?? 0);
}

function getMetricValue(row, index) {
  return row?.metricValues?.[index]?.value ?? '0';
}

function getDimValue(row, index) {
  return row?.dimensionValues?.[index]?.value ?? '';
}

function parseRows(response, dimCount, metricKeys) {
  return (response.rows ?? []).map((row) => {
    const dims = Array.from({ length: dimCount }, (_, i) => getDimValue(row, i));
    const metrics = {};
    metricKeys.forEach((key, i) => {
      metrics[key] = toNum(getMetricValue(row, i));
    });
    return { dims, ...metrics };
  });
}

function calcDelta(current, previous) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

export async function fetchPropertyReport(client, propertyId, { startDate, endDate, prevStartDate, prevEndDate }) {
  const property = `properties/${propertyId}`;

  const totalMetrics = [
    { name: 'sessions' },
    { name: 'totalUsers' },
    { name: 'newUsers' },
    { name: 'screenPageViews' },
    { name: 'engagementRate' },
    { name: 'bounceRate' },
    { name: 'averageSessionDuration' },
    { name: 'eventCount' },
    { name: 'conversions' },
  ];

  const [
    totalsResp,
    prevTotalsResp,
    channelsResp,
    sourcesResp,
    pagesResp,
    countriesResp,
    devicesResp,
  ] = await Promise.all([
    client.runReport({
      property,
      dateRanges: [{ startDate, endDate }],
      metrics: totalMetrics,
    }),
    client.runReport({
      property,
      dateRanges: [{ startDate: prevStartDate, endDate: prevEndDate }],
      metrics: totalMetrics,
    }),
    client.runReport({
      property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'engagementRate' },
      ],
      limit: 10,
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    }),
    client.runReport({
      property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics: [{ name: 'sessions' }],
      limit: 10,
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    }),
    client.runReport({
      property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
      ],
      limit: 10,
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    }),
    client.runReport({
      property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
      limit: 10,
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    }),
    client.runReport({
      property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    }),
  ]);

  function extractTotals(resp) {
    const row = resp[0]?.rows?.[0];
    if (!row) {
      return {
        sessions: 0, totalUsers: 0, newUsers: 0, screenPageViews: 0,
        engagementRate: 0, bounceRate: 0, averageSessionDuration: 0,
        eventCount: 0, conversions: 0,
      };
    }
    return {
      sessions: toNum(getMetricValue(row, 0)),
      totalUsers: toNum(getMetricValue(row, 1)),
      newUsers: toNum(getMetricValue(row, 2)),
      screenPageViews: toNum(getMetricValue(row, 3)),
      engagementRate: Math.round(toNum(getMetricValue(row, 4)) * 10000) / 100,
      bounceRate: Math.round(toNum(getMetricValue(row, 5)) * 10000) / 100,
      averageSessionDuration: Math.round(toNum(getMetricValue(row, 6))),
      eventCount: toNum(getMetricValue(row, 7)),
      conversions: toNum(getMetricValue(row, 8)),
    };
  }

  const current = extractTotals(totalsResp);
  const previous = extractTotals(prevTotalsResp);

  const totals = {};
  for (const key of Object.keys(current)) {
    totals[key] = {
      value: current[key],
      previous: previous[key],
      delta: calcDelta(current[key], previous[key]),
    };
  }

  const channels = parseRows(channelsResp[0], 1, ['sessions', 'totalUsers', 'engagementRate']).map((r) => ({
    channel: r.dims[0],
    sessions: r.sessions,
    totalUsers: r.totalUsers,
    engagementRate: Math.round(r.engagementRate * 10000) / 100,
  }));

  const sources = parseRows(sourcesResp[0], 2, ['sessions']).map((r) => ({
    source: r.dims[0],
    medium: r.dims[1],
    sessions: r.sessions,
  }));

  const pages = parseRows(pagesResp[0], 1, ['screenPageViews', 'averageSessionDuration']).map((r) => ({
    path: r.dims[0],
    views: r.screenPageViews,
    avgDuration: Math.round(r.averageSessionDuration),
  }));

  const countries = parseRows(countriesResp[0], 1, ['sessions', 'totalUsers']).map((r) => ({
    country: r.dims[0],
    sessions: r.sessions,
    totalUsers: r.totalUsers,
  }));

  const devices = parseRows(devicesResp[0], 1, ['sessions', 'totalUsers']).map((r) => ({
    device: r.dims[0],
    sessions: r.sessions,
    totalUsers: r.totalUsers,
  }));

  return { propertyId, totals, channels, sources, pages, countries, devices };
}
