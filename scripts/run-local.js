import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env from the project root manually — no dotenv dependency needed
const envPath = resolve(new URL('../.env', import.meta.url).pathname);
try {
  const contents = readFileSync(envPath, 'utf8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
  console.log(`[run-local] Loaded .env from ${envPath}`);
} catch (err) {
  if (err.code === 'ENOENT') {
    console.warn('[run-local] No .env file found — proceeding with existing env vars');
  } else {
    throw err;
  }
}

const { runReport } = await import('../lib/report.js');

console.log('[run-local] Starting report run...');
try {
  const result = await runReport();
  console.log('[run-local] Done:', result);
} catch (err) {
  console.error('[run-local] Report failed:', err);
  process.exit(1);
}
