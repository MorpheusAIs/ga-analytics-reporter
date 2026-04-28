const fmt = new Intl.NumberFormat('en-US');

function fmtNum(n) {
  return fmt.format(Math.round(n));
}

function fmtPct(n) {
  return n.toFixed(2) + '%';
}

function fmtDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function fmtDelta(delta) {
  if (delta === null || delta === undefined) return '—';
  if (delta > 0) return `▲ ${delta.toFixed(1)}%`;
  if (delta < 0) return `▼ ${Math.abs(delta).toFixed(1)}%`;
  return '— 0%';
}

function mrkdwn(text) {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function header(text) {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } };
}

function divider() {
  return { type: 'divider' };
}

function propertyBlocks(prop) {
  const blocks = [];
  const t = prop.totals;

  blocks.push(header(`Property: ${prop.name} (${prop.propertyId})`));

  const keyMetrics = [
    `*Sessions:* ${fmtNum(t.sessions.value)} ${fmtDelta(t.sessions.delta)}`,
    `*Users:* ${fmtNum(t.totalUsers.value)} ${fmtDelta(t.totalUsers.delta)}`,
    `*New Users:* ${fmtNum(t.newUsers.value)} ${fmtDelta(t.newUsers.delta)}`,
    `*Pageviews:* ${fmtNum(t.screenPageViews.value)} ${fmtDelta(t.screenPageViews.delta)}`,
    `*Engagement Rate:* ${fmtPct(t.engagementRate.value)} ${fmtDelta(t.engagementRate.delta)}`,
    `*Bounce Rate:* ${fmtPct(t.bounceRate.value)} ${fmtDelta(t.bounceRate.delta)}`,
    `*Avg Duration:* ${fmtDuration(t.averageSessionDuration.value)} ${fmtDelta(t.averageSessionDuration.delta)}`,
    `*Events:* ${fmtNum(t.eventCount.value)} ${fmtDelta(t.eventCount.delta)}`,
    `*Conversions:* ${fmtNum(t.conversions.value)} ${fmtDelta(t.conversions.delta)}`,
  ];

  blocks.push(mrkdwn(keyMetrics.join('\n')));

  if (prop.channels?.length) {
    const lines = prop.channels.slice(0, 6).map(
      (c) => `• ${c.channel}: ${fmtNum(c.sessions)} sessions (${fmtPct(c.engagementRate)} eng.)`
    );
    blocks.push(mrkdwn(`*Top Channels*\n${lines.join('\n')}`));
  }

  if (prop.sources?.length) {
    const lines = prop.sources.slice(0, 5).map(
      (s) => `• ${s.source} / ${s.medium}: ${fmtNum(s.sessions)}`
    );
    blocks.push(mrkdwn(`*Top Sources*\n${lines.join('\n')}`));
  }

  if (prop.pages?.length) {
    const lines = prop.pages.slice(0, 5).map(
      (p) => `• \`${p.path}\`: ${fmtNum(p.views)} views, ${fmtDuration(p.avgDuration)} avg`
    );
    blocks.push(mrkdwn(`*Top Pages*\n${lines.join('\n')}`));
  }

  if (prop.devices?.length) {
    const lines = prop.devices.map(
      (d) => `• ${d.device}: ${fmtNum(d.sessions)} sessions`
    );
    blocks.push(mrkdwn(`*Devices*\n${lines.join('\n')}`));
  }

  if (prop.countries?.length) {
    const lines = prop.countries.slice(0, 5).map(
      (c) => `• ${c.country}: ${fmtNum(c.sessions)} sessions`
    );
    blocks.push(mrkdwn(`*Top Countries*\n${lines.join('\n')}`));
  }

  return blocks;
}

export function formatReport({ properties, dateRange }) {
  const blocks = [];

  blocks.push(header(`📊 Weekly GA Report — ${dateRange.start} → ${dateRange.end}`));
  blocks.push(mrkdwn(`Covering *${dateRange.start}* through *${dateRange.end}* (previous 7 days). Deltas vs. prior 7-day window.`));
  blocks.push(divider());

  for (const prop of properties) {
    if (prop.error) {
      blocks.push(mrkdwn(`:warning: *${prop.name} (${prop.propertyId})* failed: ${prop.error}`));
    } else {
      blocks.push(...propertyBlocks(prop));
    }
    blocks.push(divider());
  }

  blocks.push(mrkdwn(`_Generated at ${new Date().toUTCString()}_`));

  return { blocks };
}

export async function postToSlack(webhookUrl, message) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    throw new Error(`Slack webhook returned ${res.status}: ${body}`);
  }
}

export async function postErrorToSlack(webhookUrl, error) {
  if (!webhookUrl) return;
  const message = {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:red_circle: *GA Reporter failed*\n\`\`\`${String(error).slice(0, 2000)}\`\`\``,
        },
      },
    ],
  };
  try {
    await postToSlack(webhookUrl, message);
  } catch {
    // Best-effort; don't throw from error handler
  }
}
