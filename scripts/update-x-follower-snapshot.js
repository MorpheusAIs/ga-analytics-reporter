import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const responsePath = resolve(process.argv[2] || 'report-response.json');
const outputPath = resolve(process.argv[3] || 'data/x-followers.jsonl');

const response = JSON.parse(readFileSync(responsePath, 'utf8'));
const snapshot = response.xFollowerSnapshot;

if (typeof snapshot?.followerCount !== 'number') {
  console.log('[x-snapshot] No follower snapshot returned; leaving snapshot file unchanged.');
  process.exit(0);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(snapshot) + '\n');
console.log(`[x-snapshot] Wrote ${snapshot.followerCount} follower ${snapshot.mode === 'ids' ? 'ids' : 'count'} to ${outputPath}`);
