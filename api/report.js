import crypto from 'node:crypto';
import { runReport } from '../lib/report.js';
import { postErrorToSlack } from '../lib/slack.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error('[ga-reporter] WEBHOOK_SECRET env var is not set');
    return res.status(500).json({ ok: false, error: 'Server misconfiguration: WEBHOOK_SECRET is not set' });
  }

  const incoming = req.headers['x-webhook-secret'];
  if (!incoming) {
    return res.status(401).json({ ok: false, error: 'Missing x-webhook-secret header' });
  }

  let authorized = false;
  try {
    const a = Buffer.from(incoming);
    const b = Buffer.from(secret);
    // Buffers must be the same length for timingSafeEqual; pad to avoid length leaks
    const maxLen = Math.max(a.length, b.length);
    const aPadded = Buffer.alloc(maxLen);
    const bPadded = Buffer.alloc(maxLen);
    a.copy(aPadded);
    b.copy(bPadded);
    authorized = crypto.timingSafeEqual(aPadded, bPadded) && a.length === b.length;
  } catch {
    authorized = false;
  }

  if (!authorized) {
    return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });
  }

  try {
    const { propertiesProcessed, propertiesFailed, xFollowerSnapshot } = await runReport();
    return res.status(200).json({ ok: true, propertiesProcessed, propertiesFailed, slackPosted: true, xFollowerSnapshot });
  } catch (err) {
    console.error('[ga-reporter] runReport failed:', err);
    await postErrorToSlack(process.env.SLACK_WEBHOOK_URL, err);
    return res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
}
