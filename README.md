# ga-analytics-reporter

A weekly Google Analytics 4 reporter that runs as a Vercel serverless function. Every Tuesday at 09:00 UTC a GitHub Actions cron job POSTs to the Vercel function with a shared secret, the function pulls GA4 metrics for one or more configured properties via the official `@google-analytics/data` SDK, formats a rich multi-property report with week-over-week deltas, and posts it to a Slack incoming webhook.

## Architecture

```
GitHub Actions cron (Tue 09:00 UTC)
        |
        | POST /api/report
        | x-webhook-secret: <secret>
        v
Vercel Serverless Function (Node 20)
        |
        |-- GA4 Data API (parallel per property) --> metrics, channels, pages, sources, devices, countries
        |-- X API v2 (optional) --> account metrics, weekly posts, top-post metrics
        |
        v
Slack Incoming Webhook --> #your-channel (Block Kit report with deltas)
```

## Setup

### 1. GCP service account and GA4 access

```bash
# In GCP Console:
# 1. Create a service account (IAM & Admin → Service Accounts → Create)
# 2. Enable the Google Analytics Data API for your project
# 3. Download a JSON key: Service Account → Keys → Add Key → JSON

# Minify the key to a single line for the env var:
cat your-key-file.json | python3 -m json.tool --compact
```

In each GA4 property's admin panel:
- Go to **Admin → Property access management**
- Click **+** and add the service account email (ends in `.iam.gserviceaccount.com`)
- Grant the **Viewer** role

### 2. Find your GA4 property IDs

In GA4: **Admin → Property details → Property ID** (numeric, e.g. `123456789`).

### 3. Create a Slack incoming webhook

Go to [api.slack.com/apps](https://api.slack.com/apps), select (or create) your app, navigate to **Incoming Webhooks**, and activate it. Add a new webhook to the target channel and copy the URL.

### 4. Set Vercel environment variables

```bash
vercel env add WEBHOOK_SECRET        # random shared secret, e.g. openssl rand -hex 32
vercel env add SLACK_WEBHOOK_URL     # https://hooks.slack.com/services/...
vercel env add GOOGLE_APPLICATION_CREDENTIALS_JSON  # single-line minified JSON key
vercel env add GA_PROPERTIES        # e.g. [{"id":"123456789","name":"Morpheus Site"}]
vercel env add UMAMI_GA_PROPERTY_ID_INFERENCE_API_APP # 512834239 routes only Inference API APP to Umami
vercel env add UMAMI_WEBSITE_ID_INFERENCE_API_APP # 9ee22931-b645-4df8-853c-5eba51bfa9e4
vercel env add UMAMI_HOST           # https://umami-production-5f98.up.railway.app
vercel env add UMAMI_AUTH_TOKEN     # self-hosted Umami bearer token
vercel env add X_BEARER_TOKEN       # enables @morpheusais X analytics
vercel env add X_USERNAME           # optional, defaults to morpheusais
vercel env add X_PREVIOUS_FOLLOWER_IDS # optional ID-mode override for the committed follower snapshot
vercel env add X_FOLLOWER_SNAPSHOT_MODE # optional, defaults to count
```

Add each variable to the **Production** environment (and Preview/Development if desired).

The Umami variables are optional unless `UMAMI_GA_PROPERTY_ID_INFERENCE_API_APP` is set. When it matches the `Inference API APP` entry in `GA_PROPERTIES`, only that property uses the self-hosted Umami API; every other `GA_PROPERTIES` entry continues to use GA4.

The only new required env var for X reporting is `X_BEARER_TOKEN`. `X_USERNAME` is optional and defaults to `morpheusais`; `X_PREVIOUS_FOLLOWER_IDS` is only an emergency/manual override for ID-mode exact comparisons because the workflow normally stores the previous snapshot in `data/x-followers.jsonl`. `X_FOLLOWER_SNAPSHOT_MODE` defaults to `count`, which records follower-count snapshots and reports reliable net follower change. Set it to `ids` only if the account size and X API rate limits make full follower-list snapshots practical; that optional mode can split new follows and unfollows exactly.

The X integration uses official X API v2 endpoints with `X_BEARER_TOKEN`; it does not scrape X. It reads `GET /2/users/by/username/:username` and paginated `GET /2/users/:id/tweets`; optional exact follower-ID mode also reads `GET /2/users/:id/followers`. The weekly report uses `public_metrics`, so views are reported as X public `impression_count`, and engagement is a derived public sum of likes, replies, reposts, quotes, and bookmarks. If you need private owned-account analytics such as organic impressions, URL clicks, profile clicks, exact account-level follow/unfollow events, or Enterprise engagement analytics, that requires X user-context/owned-account analytics access beyond this bearer-token setup.

### 5. Deploy

```bash
vercel --prod
```

Note the production URL (e.g. `https://ga-analytics-reporter.vercel.app`).

### 6. Set GitHub repo secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `WEBHOOK_SECRET` | Same value you set in Vercel |
| `REPORT_WEBHOOK_URL` | Your Vercel production URL + `/api/report` |

### 7. Enable GitHub Actions

Ensure GitHub Actions is enabled for the repository (**Settings → Actions → General → Allow all actions**). The workflow file is at `.github/workflows/weekly-report.yml`.

## Testing

**Trigger manually via GitHub CLI:**

```bash
gh workflow run "Weekly GA Report"
```

**Test locally with a `.env` file:**

```bash
cp .env.example .env
# Fill in .env with real values
npm run test:local
```

The local runner loads `.env` without any external dependency and calls `runReport()` directly.

The scheduled workflow also rewrites `data/x-followers.jsonl` with the latest X follower snapshot returned by `/api/report`, then commits it back to the repo. On the next deployed run, the reporter compares the current follower count with that snapshot to show net follower change. Exact new follow/unfollow split is only available in optional `ids` mode after a prior follower-ID snapshot exists. The committed snapshot must be deployed with the app before the next scheduled report; Vercel Git deployments normally handle this automatically after the workflow pushes the snapshot commit.

## Schedule

```
cron: 0 9 * * 2
```

Fires every **Tuesday at 09:00 UTC**.

## What the report includes

Per configured GA4 property, for the previous 7 full days (ending yesterday), with week-over-week deltas:

- **Key totals:** Sessions, Users, New Users, Pageviews, Engagement Rate, Bounce Rate, Average Session Duration, Events, Conversions
- **Channel breakdown:** Top 10 channel groups by sessions (Organic Search, Direct, Referral, etc.)
- **Top traffic sources:** Top 10 source/medium pairs by sessions
- **Top pages:** Top 10 pages by pageviews with average session duration
- **Device breakdown:** Sessions and users split by device category (desktop, mobile, tablet)
- **Country breakdown:** Top 10 countries by sessions
- **X account analytics (optional):** @morpheusais follower totals, weekly original/quote post count, weekly public impressions, derived public engagement totals/rate, text-based impressions chart, and top 10 posts with links and metrics. Net follower change is shown once `data/x-followers.jsonl` contains a previous count snapshot; exact new follow/unfollow split requires optional follower-ID snapshot mode.

Failed properties are noted in the Slack report rather than aborting the whole run.
