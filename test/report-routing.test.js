import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPropertyReportTasks, getInferenceApiUmamiConfig } from '../lib/report.js';

test('getInferenceApiUmamiConfig maps the Inference API GA property to the Umami website', () => {
  const env = {
    UMAMI_GA_PROPERTY_ID_INFERENCE_API_APP: '512834239',
    UMAMI_WEBSITE_ID_INFERENCE_API_APP: '9ee22931-b645-4df8-853c-5eba51bfa9e4',
    UMAMI_HOST: 'https://umami.example.com',
    UMAMI_AUTH_TOKEN: 'token',
  };

  assert.deepEqual(getInferenceApiUmamiConfig(env), {
    gaPropertyId: '512834239',
    websiteId: '9ee22931-b645-4df8-853c-5eba51bfa9e4',
    host: 'https://umami.example.com',
    token: 'token',
  });
});

test('buildPropertyReportTasks routes only the configured Inference API property to Umami', async () => {
  let gaClientCreated = 0;
  const calls = [];
  const tasks = buildPropertyReportTasks({
    properties: [
      { id: '494488867', name: 'Morpheus Landing' },
      { id: '512834239', name: 'Inference API APP' },
    ],
    ranges: {
      startDate: '2026-05-26',
      endDate: '2026-06-01',
      prevStartDate: '2026-05-19',
      prevEndDate: '2026-05-25',
    },
    env: {
      UMAMI_GA_PROPERTY_ID_INFERENCE_API_APP: '512834239',
      UMAMI_WEBSITE_ID_INFERENCE_API_APP: '9ee22931-b645-4df8-853c-5eba51bfa9e4',
      UMAMI_HOST: 'https://umami.example.com',
      UMAMI_AUTH_TOKEN: 'token',
    },
    createClient: () => {
      gaClientCreated += 1;
      return { client: true };
    },
    fetchGaReport: async (client, propertyId) => {
      calls.push(['ga', propertyId, client]);
      return { propertyId, source: 'ga' };
    },
    fetchUmamiReport: async (options) => {
      calls.push(['umami', options.propertyId, options.websiteId]);
      return { propertyId: options.propertyId, source: 'umami' };
    },
  });

  const results = await Promise.all(tasks.map((task) => task()));

  assert.equal(gaClientCreated, 1);
  assert.deepEqual(results, [
    { propertyId: '494488867', source: 'ga' },
    { propertyId: '512834239', source: 'umami' },
  ]);
  assert.deepEqual(calls, [
    ['ga', '494488867', { client: true }],
    ['umami', '512834239', '9ee22931-b645-4df8-853c-5eba51bfa9e4'],
  ]);
});

test('buildPropertyReportTasks does not create a GA client when every property is Umami-backed', async () => {
  let gaClientCreated = 0;
  const tasks = buildPropertyReportTasks({
    properties: [{ id: '512834239', name: 'Inference API APP' }],
    ranges: {
      startDate: '2026-05-26',
      endDate: '2026-06-01',
      prevStartDate: '2026-05-19',
      prevEndDate: '2026-05-25',
    },
    env: {
      UMAMI_GA_PROPERTY_ID_INFERENCE_API_APP: '512834239',
      UMAMI_WEBSITE_ID_INFERENCE_API_APP: '9ee22931-b645-4df8-853c-5eba51bfa9e4',
      UMAMI_HOST: 'https://umami.example.com',
      UMAMI_AUTH_TOKEN: 'token',
    },
    createClient: () => {
      gaClientCreated += 1;
      throw new Error('GA client should not be created');
    },
    fetchGaReport: async () => {
      throw new Error('GA report should not be fetched');
    },
    fetchUmamiReport: async (options) => ({ propertyId: options.propertyId, source: 'umami' }),
  });

  assert.deepEqual(await Promise.all(tasks.map((task) => task())), [
    { propertyId: '512834239', source: 'umami' },
  ]);
  assert.equal(gaClientCreated, 0);
});

test('getInferenceApiUmamiConfig requires complete Umami env when mapping is enabled', () => {
  assert.throws(
    () => getInferenceApiUmamiConfig({
      UMAMI_GA_PROPERTY_ID_INFERENCE_API_APP: '512834239',
      UMAMI_WEBSITE_ID_INFERENCE_API_APP: '9ee22931-b645-4df8-853c-5eba51bfa9e4',
      UMAMI_HOST: 'https://umami.example.com',
    }),
    /Missing env var UMAMI_AUTH_TOKEN/
  );
});
