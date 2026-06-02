import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

function toNum(value) {
  return Number(value ?? 0);
}

function parseSnapshot(raw) {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Fall through to comma-separated parsing for simple env var usage.
  }

  return raw.split(',').map((id) => id.trim()).filter(Boolean);
}

function parseSnapshotLine(line) {
  if (!line) return null;

  try {
    const parsed = JSON.parse(line);
    if (Array.isArray(parsed)) return { followerIds: parsed.map(String).filter(Boolean) };
    if (Array.isArray(parsed?.followerIds)) {
      return {
        capturedAt: parsed.capturedAt,
        followerCount: parsed.followerCount,
        followerIds: parsed.followerIds.map(String).filter(Boolean),
      };
    }
    if (typeof parsed?.followerCount === 'number') {
      return {
        capturedAt: parsed.capturedAt,
        followerCount: parsed.followerCount,
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function readPreviousFollowerSnapshot(username) {
  const envSnapshot = parseSnapshot(process.env.X_PREVIOUS_FOLLOWER_IDS);
  if (envSnapshot?.length) return { followerIds: envSnapshot };

  try {
    const snapshotPath = join(process.cwd(), 'data', 'x-followers.jsonl');
    const contents = await readFile(snapshotPath, 'utf8');
    const lines = contents.split('\n').map((line) => line.trim()).filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i--) {
      const parsed = JSON.parse(lines[i]);
      if (!parsed.username || parsed.username === username) {
        return parseSnapshotLine(lines[i]);
      }
    }
  } catch {
    return null;
  }

  return null;
}

function calcEngagementRate(metrics) {
  const impressions = toNum(metrics.impression_count);
  if (impressions === 0) return 0;

  const engagements =
    toNum(metrics.like_count) +
    toNum(metrics.reply_count) +
    toNum(metrics.retweet_count) +
    toNum(metrics.quote_count) +
    toNum(metrics.bookmark_count);

  return Math.round((engagements / impressions) * 10000) / 100;
}

function getTweetUrl(username, id) {
  return `https://x.com/${username}/status/${id}`;
}

const X_FETCH_TIMEOUT = 15000;

async function xFetch(path, bearerToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), X_FETCH_TIMEOUT);

  try {
    const res = await fetch(`https://api.x.com/2${path}`, {
      headers: { authorization: `Bearer ${bearerToken}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)');
      throw new Error(`X API returned ${res.status}: ${body.slice(0, 500)}`);
    }

    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`X API timeout after ${X_FETCH_TIMEOUT}ms: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFollowerIds(userId, bearerToken) {
  const ids = [];
  let paginationToken;

  do {
    const params = new URLSearchParams({
      max_results: '1000',
      'user.fields': 'id',
    });
    if (paginationToken) params.set('pagination_token', paginationToken);

    const payload = await xFetch(`/users/${userId}/followers?${params.toString()}`, bearerToken);
    ids.push(...(payload.data ?? []).map((user) => user.id).filter(Boolean));
    paginationToken = payload.meta?.next_token;
  } while (paginationToken);

  return ids;
}

function compareFollowerSnapshot(previousIds, currentIds) {
  if (!previousIds) return null;

  const previous = new Set(previousIds);
  const current = new Set(currentIds);
  let newFollows = 0;
  let unfollows = 0;

  for (const id of current) {
    if (!previous.has(id)) newFollows++;
  }

  for (const id of previous) {
    if (!current.has(id)) unfollows++;
  }

  return { newFollows, unfollows };
}

function compareFollowerCount(previousCount, currentCount) {
  if (typeof previousCount !== 'number') return null;
  return { netFollowerChange: currentCount - previousCount };
}

function daysBetween(start, end) {
  if (!start) return null;
  const startTime = Date.parse(start);
  if (Number.isNaN(startTime)) return null;
  return Math.round(((Date.parse(end) - startTime) / 86400000) * 10) / 10;
}

async function fetchWeeklyPosts(userId, bearerToken, { startDate, endDate }) {
  const posts = [];
  let paginationToken;

  do {
    const tweetParams = new URLSearchParams({
      exclude: 'retweets,replies',
      max_results: '100',
      'tweet.fields': 'created_at,public_metrics,text',
      start_time: `${startDate}T00:00:00Z`,
      end_time: `${endDate}T23:59:59Z`,
    });
    if (paginationToken) tweetParams.set('pagination_token', paginationToken);

    const tweetsPayload = await xFetch(`/users/${userId}/tweets?${tweetParams.toString()}`, bearerToken);
    posts.push(...(tweetsPayload.data ?? []));
    paginationToken = tweetsPayload.meta?.next_token;
  } while (paginationToken);

  return posts;
}

export async function fetchXReport({ username, startDate, endDate }) {
  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken) return null;

  const account = username || process.env.X_USERNAME || 'morpheusais';
  const userParams = new URLSearchParams({
    'user.fields': 'created_at,description,public_metrics',
  });
  const userPayload = await xFetch(`/users/by/username/${account}?${userParams.toString()}`, bearerToken);
  const user = userPayload.data;

  if (!user?.id) {
    throw new Error(`X account ${account} was not found.`);
  }

  const fetchedPosts = await fetchWeeklyPosts(user.id, bearerToken, { startDate, endDate });

  const posts = fetchedPosts.map((tweet) => {
    const metrics = tweet.public_metrics ?? {};
    const impressions = toNum(metrics.impression_count);
    const engagements =
      toNum(metrics.like_count) +
      toNum(metrics.reply_count) +
      toNum(metrics.retweet_count) +
      toNum(metrics.quote_count) +
      toNum(metrics.bookmark_count);

    return {
      id: tweet.id,
      createdAt: tweet.created_at,
      text: tweet.text,
      url: getTweetUrl(account, tweet.id),
      impressions,
      engagements,
      engagementRate: calcEngagementRate(metrics),
      likes: toNum(metrics.like_count),
      replies: toNum(metrics.reply_count),
      reposts: toNum(metrics.retweet_count),
      quotes: toNum(metrics.quote_count),
      bookmarks: toNum(metrics.bookmark_count),
    };
  });

  const totals = posts.reduce(
    (acc, post) => ({
      posts: acc.posts + 1,
      impressions: acc.impressions + post.impressions,
      engagements: acc.engagements + post.engagements,
      likes: acc.likes + post.likes,
      replies: acc.replies + post.replies,
      reposts: acc.reposts + post.reposts,
      quotes: acc.quotes + post.quotes,
      bookmarks: acc.bookmarks + post.bookmarks,
    }),
    { posts: 0, impressions: 0, engagements: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, bookmarks: 0, engagementRate: 0 }
  );
  totals.engagementRate = totals.impressions === 0 ? 0 : Math.round((totals.engagements / totals.impressions) * 10000) / 100;

  let followerChanges = null;
  let followerSnapshot = null;
  let followerSnapshotWarning = null;
  const followerSnapshotMode = process.env.X_FOLLOWER_SNAPSHOT_MODE === 'ids' ? 'ids' : 'count';

  try {
    const capturedAt = new Date().toISOString();
    const previousFollowerSnapshot = await readPreviousFollowerSnapshot(account);
    const currentFollowerCount = toNum(user.public_metrics?.followers_count);

    if (followerSnapshotMode === 'ids') {
      const currentFollowerIds = await fetchFollowerIds(user.id, bearerToken);
      followerChanges = previousFollowerSnapshot?.followerIds
        ? {
            ...compareFollowerSnapshot(previousFollowerSnapshot.followerIds, currentFollowerIds),
            previousCapturedAt: previousFollowerSnapshot.capturedAt ?? null,
            daysSincePreviousSnapshot: daysBetween(previousFollowerSnapshot.capturedAt, capturedAt),
            mode: 'ids',
          }
        : null;
      followerSnapshot = {
        username: account,
        capturedAt,
        followerCount: currentFollowerIds.length,
        followerIds: currentFollowerIds,
        mode: 'ids',
      };
    } else {
      followerChanges = previousFollowerSnapshot
        ? {
            ...compareFollowerCount(previousFollowerSnapshot.followerCount, currentFollowerCount),
            previousCapturedAt: previousFollowerSnapshot.capturedAt ?? null,
            daysSincePreviousSnapshot: daysBetween(previousFollowerSnapshot.capturedAt, capturedAt),
            mode: 'count',
          }
        : null;
      followerSnapshot = {
        username: account,
        capturedAt,
        followerCount: currentFollowerCount,
        mode: 'count',
      };
    }
  } catch (err) {
    followerSnapshotWarning = err?.message ?? String(err);
  }

  return {
    username: account,
    accountUrl: `https://x.com/${account}`,
    userId: user.id,
    followers: toNum(user.public_metrics?.followers_count),
    following: toNum(user.public_metrics?.following_count),
    listed: toNum(user.public_metrics?.listed_count),
    totalTweets: toNum(user.public_metrics?.tweet_count),
    followerChanges,
    followerSnapshot,
    followerSnapshotWarning,
    totals,
    topPosts: posts.sort((a, b) => b.impressions - a.impressions).slice(0, 10),
  };
}
