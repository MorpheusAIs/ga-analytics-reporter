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
```

Add each variable to the **Production** environment (and Preview/Development if desired).

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

Failed properties are noted in the Slack report rather than aborting the whole run.
