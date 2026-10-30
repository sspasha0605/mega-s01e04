import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};
const night = '2026-10-28';

let runsDir: string;
const previousLaneId = process.env.LANE_ID;
const previousLaneMarker = process.env.LANE_MARKER;

function writeNightFor(date: string, contents: string) {
  writeFileSync(join(runsDir, `${date}.jsonl`), contents, 'utf8');
}

function writeNight(contents: string) {
  writeNightFor(night, contents);
}

function bodyRow(html: string, job: string) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return [...body.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)]
    .map(([row]) => row)
    .find((row) => row.includes(`<td>${job}</td>`));
}

function restoreEnv(name: 'LANE_ID' | 'LANE_MARKER', value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  if (runsDir) rmSync(runsDir, { recursive: true, force: true });
  restoreEnv('LANE_ID', previousLaneId);
  restoreEnv('LANE_MARKER', previousLaneMarker);
});

describe('digest routes', () => {
  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    config.runsDir = runsDir;
  });

  it('serves matching, sorted rows as HTML and JSON, retaining nulls and timestamp offsets', async () => {
    writeNight([
      JSON.stringify({ at: '2026-10-28T07:00:00+02:00', job: 'zeta', status: 'retry', owner: null }),
      JSON.stringify({ at: '2026-10-28T06:30:00+01:00', job: 'alpha', status: 'ok', owner: 'Ada' }),
      JSON.stringify({ at: '2026-10-28T07:10:00+02:00', job: 'zeta', status: 'retry', owner: 'Bo', error: 'temporary' }),
      JSON.stringify({ at: '2026-10-28T07:20:00+02:00', job: 'zeta', status: 'retry', owner: 'Bo' }),
      JSON.stringify({ at: '2026-10-28T07:30:00+02:00', job: 'zeta', status: 'fail', owner: null }),
      '',
    ].join('\n'));

    const app = createApp({ ...config });
    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await page.text();
    const digest = await api.json();

    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(digest).toEqual({
      rows: [
        {
          job: 'alpha', owner: 'Ada', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T06:30:00+01:00', lastAt: '2026-10-28T06:30:00+01:00',
        },
        {
          job: 'zeta', owner: null, runs: 4, retries: 3, lastStatus: 'fail', lastError: null,
          firstAt: '2026-10-28T07:00:00+02:00', lastAt: '2026-10-28T07:30:00+02:00',
        },
      ],
      badLines: 0,
      counts: { ok: 1, retry: 3, fail: 1 },
    });
    expect(html.indexOf('alpha')).toBeLessThan(html.indexOf('zeta'));
    expect(html).toContain('job');
    expect(html).toContain('owner');
    expect(html).toContain('runs');
    expect(html).toContain('retries');
    expect(html).toContain('last status');
    expect(html).toContain('last error');
    expect(html).toContain('first time');
    expect(html).toContain('last time');
    expect(html).toContain('2026-10-28T06:30:00+01:00');
    expect(html).toContain('2026-10-28T07:30:00+02:00');
    expect(html).toContain('—');

    const zetaRow = bodyRow(html, 'zeta');
    expect(zetaRow).toBeDefined();
    expect(zetaRow).toContain('class="warn"');
  });

  it('returns 404 from both routes when the night file is missing', async () => {
    const app = createApp({ ...config });
    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    expect(page.status).toBe(404);
    expect(api.status).toBe(404);
  });


  it('links each temp night from the status board with its status counts', async () => {
    writeNight([
      JSON.stringify({ at: '2026-10-28T08:00:00+02:00', job: 'alpha', status: 'ok', owner: 'Ada' }),
      JSON.stringify({ at: '2026-10-28T08:01:00+02:00', job: 'beta', status: 'retry', owner: 'Bo' }),
      '',
    ].join('\n'));
    writeNightFor('2026-10-27', `${JSON.stringify({
      at: '2026-10-27T08:00:00+02:00', job: 'gamma', status: 'fail', owner: null,
    })}\n`);

    const response = await createApp({ ...config }).request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('href="/digest/2026-10-27"');
    expect(html).toContain('ok 1 · retry 1 · fail 0');
    expect(html).toContain('ok 0 · retry 0 · fail 1');
  });

  it('renders an existing empty night on both routes', async () => {
    writeNight('');
    const app = createApp({ ...config });
    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts malformed lines while keeping usable records and marks warning rows', async () => {
    writeNight([
      '{bad json',
      JSON.stringify({ at: '2026-10-28T08:00:00+02:00', job: 'frequent-retry', status: 'retry', owner: 'Kim' }),
      JSON.stringify({ at: '2026-10-28T08:01:00+02:00', job: 'frequent-retry', status: 'retry', owner: 'Kim' }),
      JSON.stringify({ at: '2026-10-28T08:02:00+02:00', job: 'frequent-retry', status: 'retry', owner: 'Kim' }),
      JSON.stringify({ at: '2026-10-28T08:03:00+02:00', job: 'ordinary-retry', status: 'retry', owner: 'Lee' }),
      JSON.stringify({ at: '2026-10-28T08:04:00+02:00', job: 'failed', status: 'fail', owner: 'Moe', error: 'broken' }),
      '',
    ].join('\n'));
    const app = createApp({ ...config });
    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await page.text();
    const digest = await api.json();

    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((row: { job: string }) => row.job)).toEqual([
      'failed', 'frequent-retry', 'ordinary-retry',
    ]);
    expect(html).toContain('bad lines: 1');
    expect(html).toContain('broken');
    expect(html).not.toContain('nothing ran');
    const failedRow = bodyRow(html, 'failed');
    const frequentRow = bodyRow(html, 'frequent-retry');
    const ordinaryRow = bodyRow(html, 'ordinary-retry');
    expect(failedRow).toContain('class="warn"');
    expect(frequentRow).toContain('class="warn"');
    expect(ordinaryRow).not.toContain('class="warn"');
  });

  it('escapes hostile job text and emits no client script', async () => {
    const job = '<script>alert("x")</script>';
    writeNight(`${JSON.stringify({
      at: '2026-10-28T09:00:00+02:00', job, status: 'ok', owner: null,
    })}\n`);
    const response = await createApp({ ...config }).request(`/digest/${night}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain(job);
    expect(html).not.toMatch(/<script\b/i);
  });
});
