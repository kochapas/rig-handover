import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import { readNight } from '../src/digest/read.js';
import type { DigestRow } from '../src/digest/types.js';

// Plan morning-digest § 2d. Routes under test: GET /digest/:night (§ 2a) and
// GET /api/digest/:night (§ 2b). Fixtures live in a temp runs dir; runs/ is read-only.

const GOOD = '2026-03-01'; // every job, no bad line
const BAD = '2026-03-02'; // two good jobs and one line that does not parse
const EMPTY = '2026-03-03'; // a file with nothing in it
const MISSING = '2026-03-04'; // no file at all

// Written out of order on purpose: both routes must sort by job.
const line = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify(error === undefined ? { at, job, status, owner } : { at, job, status, owner, error });

const good = [
  line('2026-03-01T23:00:01+01:00', 'zeta/steady', 'ok', 'lane-07'),
  line('2026-03-02T01:30:00+01:00', 'alpha/flaky', 'retry', 'rook', 'upstream 503'),
  line('2026-03-02T01:33:00+01:00', 'alpha/flaky', 'retry', 'rook'),
  line('2026-03-02T01:36:00+01:00', 'alpha/flaky', 'retry', 'rook'),
  line('2026-03-02T01:39:00+01:00', 'alpha/flaky', 'ok', 'rook'),
  line('2026-03-02T02:00:00+01:00', 'mid/two-retries', 'retry', 'lane-07'),
  line('2026-03-02T02:05:00+01:00', 'mid/two-retries', 'retry', 'lane-07'),
  line('2026-03-02T02:10:00+01:00', 'mid/two-retries', 'ok', 'lane-07'),
  line('2026-03-02T03:00:00+01:00', 'mid/broken', 'fail', 'lane-07', 'quota exceeded'),
  line('2026-03-02T04:00:00+01:00', 'ghost/ownerless', 'ok', null),
].join('\n');

const bad = [
  line('2026-03-02T23:00:01+01:00', 'zeta/steady', 'ok', 'lane-07'),
  '{oops',
  line('2026-03-03T01:00:00+01:00', 'alpha/flaky', 'ok', 'rook'),
].join('\n');

const SORTED_JOBS = ['alpha/flaky', 'ghost/ownerless', 'mid/broken', 'mid/two-retries', 'zeta/steady'];

let dir: string;
let app: ReturnType<typeof createApp>;
let savedMarker: string | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  writeFileSync(join(dir, `${GOOD}.jsonl`), `${good}\n`);
  writeFileSync(join(dir, `${BAD}.jsonl`), `${bad}\n`);
  writeFileSync(join(dir, `${EMPTY}.jsonl`), '');
  const config: RigConfig = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: dir,
  };
  app = createApp(config);
  savedMarker = process.env.LANE_MARKER;
  process.env.LANE_MARKER = 'TEST-MARKER';
});

afterAll(() => {
  if (savedMarker === undefined) delete process.env.LANE_MARKER;
  else process.env.LANE_MARKER = savedMarker;
  rmSync(dir, { recursive: true, force: true });
});

// Markup helpers: loose on purpose, so a restyled table still passes.
const decode = (html: string) => html.replace(/&#39;|&#x27;|&apos;/g, "'");
const tableRows = (html: string) => html.match(/<tr\b[\s\S]*?<\/tr>/g) ?? [];
const rowFor = (html: string, job: string): string => {
  const hit = tableRows(html).find((r) => r.includes(job));
  expect(hit, `a table row for ${job}`).toBeDefined();
  return hit!;
};
const isWarn = (row: string) => /^<tr\b[^>]*\bclass="[^"]*\bwarn\b/.test(row);
const jobsOnPage = (html: string) =>
  tableRows(html)
    .map((r) => SORTED_JOBS.find((j) => r.includes(j)))
    .filter((j): j is string => j !== undefined);

type ApiBody = { night: string; rows: DigestRow[]; badLines: number };

describe('GET /digest/:night', () => {
  it('renders the table inside the layout, one row per job, sorted by job', async () => {
    const res = await app.request(`/digest/${GOOD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER'); // lane banner: it is inside the layout
    expect(html).toContain(GOOD);
    expect(jobsOnPage(html)).toEqual(SORTED_JOBS);
    expect(decode(html)).not.toContain("didn't parse");
  });

  it('marks rows with 3 or more retries, and rows whose last status is fail', async () => {
    const html = await (await app.request(`/digest/${GOOD}`)).text();
    expect(isWarn(rowFor(html, 'alpha/flaky'))).toBe(true); // 3 retries, last status ok
    expect(isWarn(rowFor(html, 'mid/broken'))).toBe(true); // last status fail
    expect(isWarn(rowFor(html, 'mid/two-retries'))).toBe(false); // 2 retries is not enough
    expect(isWarn(rowFor(html, 'zeta/steady'))).toBe(false);
    expect(isWarn(rowFor(html, 'ghost/ownerless'))).toBe(false);
  });

  it('renders a null owner and a null last error as "—", never empty', async () => {
    const html = await (await app.request(`/digest/${GOOD}`)).text();
    const row = rowFor(html, 'ghost/ownerless');
    expect((row.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(2); // owner and last error
    expect(rowFor(html, 'mid/broken')).toContain('quota exceeded');
  });

  it('counts a bad line instead of failing, and still shows the good rows', async () => {
    const res = await app.request(`/digest/${BAD}`);
    const html = decode(await res.text());
    expect(res.status).toBe(200);
    expect(html).toContain("didn't parse");
    expect(html).toContain('zeta/steady');
    expect(html).toContain('alpha/flaky');
  });

  it('renders an empty night as "nothing ran"', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).toContain('TEST-MARKER');
    expect(jobsOnPage(html)).toEqual([]);
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns { night, rows, badLines } with the same rows readNight gives, in the same order', async () => {
    const res = await app.request(`/api/digest/${GOOD}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as ApiBody;
    const expected = readNight(dir, GOOD)!;
    expect(body).toEqual({ night: GOOD, rows: expected.rows, badLines: 0 });
    expect(body.rows.map((r) => r.job)).toEqual(SORTED_JOBS);
  });

  it('keeps null owners and null last errors as null', async () => {
    const body = (await (await app.request(`/api/digest/${GOOD}`)).json()) as ApiBody;
    const ghost = body.rows.find((r) => r.job === 'ghost/ownerless');
    expect(ghost).toMatchObject({ owner: null, lastError: null, lastStatus: 'ok' });
    expect(body.rows.find((r) => r.job === 'alpha/flaky')).toMatchObject({ runs: 4, retries: 3 });
  });

  it('counts a bad line and still returns the good rows', async () => {
    const res = await app.request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiBody;
    expect(body.night).toBe(BAD);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['alpha/flaky', 'zeta/steady']);
  });

  it('returns no rows for an empty night', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiBody;
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });
});

describe('page and JSON agree (ADR 0001)', () => {
  it('list the same jobs in the same order for the same night', async () => {
    const html = await (await app.request(`/digest/${GOOD}`)).text();
    const body = (await (await app.request(`/api/digest/${GOOD}`)).json()) as ApiBody;
    expect(jobsOnPage(html)).toEqual(body.rows.map((r) => r.job));
    expect(jobsOnPage(html)).toEqual(SORTED_JOBS);
  });
});
