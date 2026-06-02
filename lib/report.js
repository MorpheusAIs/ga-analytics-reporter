import { createAnalyticsClient, fetchPropertyReport } from './ga.js';
import { formatReport, postToSlack } from './slack.js';
import { fetchUmamiPropertyReport } from './umami.js';
import { fetchXReport } from './x.js';

function utcDateString(date) {
  return date.toISOString().slice(0, 10);
}

function computeDateRanges() {
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const sevenDaysAgo = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate() - 6));
  const fourteenDaysAgo = new Date(Date.UTC(sevenDaysAgo.getUTCFullYear(), sevenDaysAgo.getUTCMonth(), sevenDaysAgo.getUTCDate() - 7));
  const eightDaysAgo = new Date(Date.UTC(sevenDaysAgo.getUTCFullYear(), sevenDaysAgo.getUTCMonth(), sevenDaysAgo.getUTCDate() - 1));

  return {
    startDate: utcDateString(sevenDaysAgo),
    endDate: utcDateString(yesterday),
    prevStartDate: utcDateString(fourteenDaysAgo),
    prevEndDate: utcDateString(eightDaysAgo),
  };
}

export function getInferenceApiUmamiConfig(env = process.env) {
  const gaPropertyId = env.UMAMI_GA_PROPERTY_ID_INFERENCE_API_APP;
  if (!gaPropertyId) return null;

  const required = [
    'UMAMI_WEBSITE_ID_INFERENCE_API_APP',
    'UMAMI_HOST',
    'UMAMI_AUTH_TOKEN',
  ];

  for (const key of required) {
    if (!env[key]) throw new Error(`Missing env var ${key} for Inference API APP Umami reporting.`);
  }

  return {
    gaPropertyId,
    websiteId: env.UMAMI_WEBSITE_ID_INFERENCE_API_APP,
    host: env.UMAMI_HOST,
    token: env.UMAMI_AUTH_TOKEN,
  };
}

export function buildPropertyReportTasks({
  properties,
  ranges,
  env = process.env,
  createClient = createAnalyticsClient,
  fetchGaReport = fetchPropertyReport,
  fetchUmamiReport = fetchUmamiPropertyReport,
}) {
  const umamiConfig = getInferenceApiUmamiConfig(env);
  const hasGaProperties = properties.some((prop) => prop.id !== umamiConfig?.gaPropertyId);
  const client = hasGaProperties ? createClient() : null;

  return properties.map((prop) => {
    if (prop.id === umamiConfig?.gaPropertyId) {
      return () => fetchUmamiReport({
        propertyId: prop.id,
        websiteId: umamiConfig.websiteId,
        host: umamiConfig.host,
        token: umamiConfig.token,
        ...ranges,
      });
    }

    return () => fetchGaReport(client, prop.id, ranges);
  });
}

export async function runReport() {
  const rawProperties = process.env.GA_PROPERTIES;
  if (!rawProperties) {
    throw new Error(
      'Missing env var GA_PROPERTIES. Expected a JSON array like [{"id":"123456789","name":"My Site"}].'
    );
  }

  let properties;
  try {
    properties = JSON.parse(rawProperties);
  } catch (err) {
    throw new Error('Failed to parse GA_PROPERTIES as JSON: ' + err.message);
  }

  if (!Array.isArray(properties) || properties.length === 0) {
    throw new Error('GA_PROPERTIES must be a non-empty JSON array of {id, name} objects.');
  }

  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (!slackUrl) {
    throw new Error('Missing env var SLACK_WEBHOOK_URL.');
  }

  const { startDate, endDate, prevStartDate, prevEndDate } = computeDateRanges();
  const ranges = { startDate, endDate, prevStartDate, prevEndDate };
  const propertyTasks = buildPropertyReportTasks({ properties, ranges });

  const [gaResults, xResult] = await Promise.all([
    Promise.allSettled(propertyTasks.map((task) => task())),
    (async () => {
      try {
        const report = await fetchXReport({ username: process.env.X_USERNAME || 'morpheusais', startDate, endDate });
        return { report };
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    })(),
  ]);

  let propertiesProcessed = 0;
  let propertiesFailed = 0;

  const reportProps = gaResults.map((result, i) => {
    const prop = properties[i];
    if (result.status === 'fulfilled') {
      propertiesProcessed++;
      return { ...result.value, name: prop.name };
    } else {
      propertiesFailed++;
      console.error(`[ga-reporter] Property ${prop.id} (${prop.name}) failed:`, result.reason);
      return {
        propertyId: prop.id,
        name: prop.name,
        error: result.reason?.message ?? String(result.reason),
      };
    }
  });

  const message = formatReport({
    properties: reportProps,
    x: xResult.report ? xResult.report : xResult.error ? { username: process.env.X_USERNAME || 'morpheusais', error: xResult.error } : null,
    dateRange: { start: startDate, end: endDate },
  });

  await postToSlack(slackUrl, message);

  return { propertiesProcessed, propertiesFailed, xFollowerSnapshot: xResult.report?.followerSnapshot ?? null };
}
