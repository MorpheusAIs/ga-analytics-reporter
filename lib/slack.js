const fmt = new Intl.NumberFormat('en-US');

function fmtNum(n) {
  return fmt.format(Math.round(n));
}

function fmtPct(n) {
  return n.toFixed(2) + '%';
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text ?? '';
  return text.slice(0, maxLength - 1) + '…';
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

function bar(value, max) {
  if (max <= 0 || value <= 0) return '▏';
  const width = Math.max(1, Math.round((value / max) * 12));
  return '█'.repeat(width).padEnd(12, '░');
}

function xBlocks(x) {
  const blocks = [];
  blocks.push(header(`X Analytics: @${x.username}`));

  if (x.error) {
    blocks.push(mrkdwn(`:warning: *X analytics failed:* ${x.error}`));
    return blocks;
  }

  const snapshotWindow = x.followerChanges?.previousCapturedAt
    ? ` since ${x.followerChanges.previousCapturedAt.slice(0, 10)}${x.followerChanges.daysSincePreviousSnapshot ? ` (${x.followerChanges.daysSincePreviousSnapshot} days)` : ''}`
    : '';
  let changes = '*Follower change:* pending until a previous follower snapshot exists';
  if (x.followerChanges?.mode === 'ids') {
    changes = `*New follows${snapshotWindow}:* ${fmtNum(x.followerChanges.newFollows)}\n*Unfollows${snapshotWindow}:* ${fmtNum(x.followerChanges.unfollows)}`;
  } else if (x.followerChanges?.mode === 'count') {
    changes = `*Net follower change${snapshotWindow}:* ${x.followerChanges.netFollowerChange >= 0 ? '+' : ''}${fmtNum(x.followerChanges.netFollowerChange)}\n*New follows / unfollows:* exact split requires optional follower-ID snapshot mode`;
  }

  blocks.push(mrkdwn([
    `*Account:* <${x.accountUrl}|@${x.username}>`,
    `*Total users (followers):* ${fmtNum(x.followers)}`,
    `*Following:* ${fmtNum(x.following)}`,
    `*Listed:* ${fmtNum(x.listed)}`,
    `*Original/quote posts this week:* ${fmtNum(x.totals.posts)}`,
    `*Public impressions this week:* ${fmtNum(x.totals.impressions)}`,
    `*Public engagement sum:* ${fmtNum(x.totals.engagements)} (${fmtPct(x.totals.engagementRate)})`,
    changes,
    x.followerSnapshotWarning ? `*Follower snapshot:* unavailable (${x.followerSnapshotWarning})` : null,
    x.followerSnapshot ? '*Follower snapshot:* refreshed for next week' : null,
  ].filter(Boolean).join('\n')));

  if (x.topPosts?.length) {
    const maxViews = Math.max(...x.topPosts.map((post) => post.impressions));
    const chartLines = x.topPosts.slice(0, 5).map((post, i) => (
      `${i + 1}. ${bar(post.impressions, maxViews)} ${fmtNum(post.impressions)} public impressions · ${fmtPct(post.engagementRate)}`
    ));
    blocks.push(mrkdwn(`*Top Post Views Chart*\n\`\`\`\n${chartLines.join('\n')}\n\`\`\``));

    const postLines = x.topPosts.map((post, i) => (
      `${i + 1}. <${post.url}|${truncate(post.text.replace(/\s+/g, ' '), 90)}>\n` +
      `   ${fmtNum(post.impressions)} public impressions · ${fmtNum(post.engagements)} public engagement sum · ${fmtPct(post.engagementRate)} ER · ` +
      `${fmtNum(post.likes)} likes · ${fmtNum(post.reposts)} reposts · ${fmtNum(post.replies)} replies · ${fmtNum(post.bookmarks)} bookmarks`
    ));
    blocks.push(mrkdwn(`*Top 10 Posts*\n${postLines.join('\n')}`));
  } else {
    blocks.push(mrkdwn('*Top 10 Posts*\nNo original posts were returned for this week.'));
  }

  return blocks;
}

export function formatReport({ properties, x, dateRange }) {
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

  if (x) {
    blocks.push(...xBlocks(x));
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
