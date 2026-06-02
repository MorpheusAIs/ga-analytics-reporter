import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchUmamiPropertyReport } from '../lib/umami.js';

const currentStats = {
  pageviews: { value: 120 },
  visitors: { value: 42 },
  visits: { value: 55 },
  bounces: { value: 11 },
  totaltime: { value: 3300 },
};

const previousStats = {
  pageviews: { value: 100 },
  visitors: { value: 40 },
  visits: { value: 50 },
  bounces: { value: 10 },
  totaltime: { value: 2500 },
};

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('fetchUmamiPropertyReport maps Umami stats into the GA report shape', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), authorization: options.headers.authorization });
    const parsed = new URL(url);
    const path = parsed.pathname;
    const type = parsed.searchParams.get('type');

    if (path.endsWith('/stats')) {
      return jsonResponse(requests.filter((request) => new URL(request.url).pathname.endsWith('/stats')).length === 1 ? currentStats : previousStats);
    }

    if (path.endsWith('/metrics/expanded')) {
      if (type === 'channel') return jsonResponse([
        { name: 'Direct', pageviews: 70, visitors: 25, visits: 30, bounces: 6, totaltime: 1800 },
        { name: 'Referral', pageviews: 50, visitors: 10, visits: 12, bounces: 3, totaltime: 600 },
      ]);
      if (type === 'referrer') return jsonResponse([{ name: 'google.com', pageviews: 40, visitors: 15, visits: 20, bounces: 4, totaltime: 900 }]);
      if (type === 'path') return jsonResponse([
        { name: '/chat', pageviews: 80, visitors: 15, visits: 20, bounces: 5, totaltime: 1200 },
        { name: '/billing', pageviews: 40, visitors: 10, visits: 12, bounces: 2, totaltime: 600 },
      ]);
      if (type === 'country') return jsonResponse([{ name: 'United States', pageviews: 60, visitors: 20, visits: 25, bounces: 5, totaltime: 1500 }]);
      if (type === 'device') return jsonResponse([
        { name: 'desktop', pageviews: 85, visitors: 30, visits: 35, bounces: 7, totaltime: 2100 },
        { name: 'mobile', pageviews: 35, visitors: 18, visits: 20, bounces: 4, totaltime: 900 },
      ]);
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const report = await fetchUmamiPropertyReport({
    propertyId: '512834239',
    websiteId: '9ee22931-b645-4df8-853c-5eba51bfa9e4',
    host: 'https://umami.example.com',
    token: 'test-token',
    startDate: '2026-05-26',
    endDate: '2026-06-01',
    prevStartDate: '2026-05-19',
    prevEndDate: '2026-05-25',
    fetchImpl,
  });

  assert.equal(report.propertyId, '512834239');
  assert.deepEqual(report.totals.sessions, { value: 55, previous: 50, delta: 10 });
  assert.deepEqual(report.totals.totalUsers, { value: 42, previous: 40, delta: 5 });
  assert.deepEqual(report.totals.newUsers, { value: 42, previous: 40, delta: 5 });
  assert.deepEqual(report.totals.screenPageViews, { value: 120, previous: 100, delta: 20 });
  assert.deepEqual(report.totals.bounceRate, { value: 20, previous: 20, delta: 0 });
  assert.deepEqual(report.totals.engagementRate, { value: 80, previous: 80, delta: 0 });
  assert.deepEqual(report.totals.averageSessionDuration, { value: 60, previous: 50, delta: 20 });
  assert.deepEqual(report.totals.eventCount, { value: 120, previous: 100, delta: 20 });
  assert.deepEqual(report.totals.conversions, { value: 0, previous: 0, delta: null });
  assert.deepEqual(report.channels[0], { channel: 'Direct', sessions: 30, totalUsers: 25, engagementRate: 80 });
  assert.deepEqual(report.sources[0], { source: 'google.com', medium: 'organic', sessions: 20 });
  assert.deepEqual(report.pages[0], { path: '/chat', views: 80, avgDuration: 60 });
  assert.deepEqual(report.countries[0], { country: 'United States', sessions: 25, totalUsers: 20 });
  assert.deepEqual(report.devices[0], { device: 'desktop', sessions: 35, totalUsers: 30 });
  assert.ok(requests.every((request) => request.authorization === 'Bearer test-token'));
});

test('fetchUmamiPropertyReport handles zero previous visits without divide-by-zero deltas', async () => {
  let statsCalls = 0;
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/stats')) {
      statsCalls += 1;
      return jsonResponse(statsCalls === 1
        ? { pageviews: 5, visitors: 2, visits: 0, bounces: 0, totaltime: 0 }
        : { pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0 });
    }
    assert.ok(parsed.pathname.endsWith('/metrics/expanded'));
    return jsonResponse([]);
  };

  const report = await fetchUmamiPropertyReport({
    propertyId: '512834239',
    websiteId: 'website-id',
    host: 'https://umami.example.com',
    token: 'test-token',
    startDate: '2026-05-26',
    endDate: '2026-06-01',
    prevStartDate: '2026-05-19',
    prevEndDate: '2026-05-25',
    fetchImpl,
  });

  assert.equal(report.totals.sessions.value, 0);
  assert.equal(report.totals.sessions.delta, null);
  assert.equal(report.totals.engagementRate.value, 100);
  assert.equal(report.totals.bounceRate.value, 0);
});
