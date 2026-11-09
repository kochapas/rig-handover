import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLine } from './read.js';
import type { RunStatus } from './types.js';

export type NightCounts = Record<RunStatus, number>;

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

// Lines per status for one night. Bad lines are not counted (the digest page reports them).
// Returns null when runs/<night>.jsonl does not exist or the night is not a YYYY-MM-DD.
export function countNight(runsDir: string, night: string): NightCounts | null {
  if (!NIGHT.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return null;
  }
  const counts: NightCounts = { ok: 0, retry: 0, fail: 0 };
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line) counts[line.status]++;
  }
  return counts;
}
