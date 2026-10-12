import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace('<script src="app.js"></script>', '');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function boot(setup) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => errors.push(String(err)));
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));
  const dom = new JSDOM(html, {
    url: 'http://localhost:8099/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  dom.window.addEventListener('error', (e) => errors.push(String(e.error || e.message)));
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  if (setup) setup(dom);
  dom.window.eval(app);
  return { dom, errors, w: dom.window, d: dom.window.document };
}

test('boots as v0.6.0-beta with chip + find UI', () => {
  const { d, errors } = boot();
  assert.equal(errors.length, 0, errors.join(' | '));
  assert.equal(d.getElementById('app-version').textContent, 'v0.6.0-beta');
  assert.ok(d.getElementById('brewery-chip'));
  assert.ok(d.getElementById('find-links-btn'));
  assert.ok(d.getElementById('find-stats'));
  assert.equal(d.getElementById('camera-btn'), null);
});

test('parseUntappdBeerUrl normalizes www, query, slash', () => {
  const { w } = boot();
  const p = w.TappdIn.parseUntappdBeerUrl(
    'https://www.untappd.com/b/finback-brewery-something-mosaic/2706030/?ref=x'
  );
  assert.equal(p.url, 'https://untappd.com/b/finback-brewery-something-mosaic/2706030');
  assert.equal(p.id, '2706030');
});

test('listDisplayCandidates prefers numbered series over single auto-pick set', () => {
  const { w } = boot();
  const series = w.TappdIn.listDisplayCandidates([
    {
      slug: 'mortalis-brewing-company-strange-philosophies-112',
      url: 'https://untappd.com/b/mortalis-brewing-company-strange-philosophies-112/1',
      title: 'Strange Philosophies - Mortalis',
      score: 0.8,
      id: '1',
    },
    {
      slug: 'mortalis-brewing-company-strange-philosophies-108',
      url: 'https://untappd.com/b/mortalis-brewing-company-strange-philosophies-108/2',
      title: 'Strange Philosophies - Mortalis',
      score: 0.78,
      id: '2',
    },
    {
      slug: 'mortalis-brewing-company-nemean',
      url: 'https://untappd.com/b/mortalis-brewing-company-nemean/3',
      title: 'Nemean - Mortalis',
      score: 0.2,
      id: '3',
    },
  ]);
  assert.equal(series.mode, 'series');
  assert.equal(series.items.length, 2);
  assert.ok(series.items.every((c) => /strange-philosophies-\d+$/.test(c.slug)));

  const top = w.TappdIn.listDisplayCandidates([
    {
      slug: 'finback-brewery-something-mosaic',
      url: 'https://untappd.com/b/finback-brewery-something-mosaic/2706030',
      title: 'Something Mosaic - Finback Brewery',
      score: 1.2,
      id: '2706030',
    },
    {
      slug: 'finback-brewery-nothing-mosaic',
      url: 'https://untappd.com/b/finback-brewery-nothing-mosaic/9',
      title: 'Nothing Mosaic - Finback Brewery',
      score: 0.3,
      id: '9',
    },
  ]);
  assert.equal(top.mode, 'top');
  assert.equal(top.items.length, 2);
  assert.match(w.TappdIn.candidateLabel(top.items[0]), /Something Mosaic/);
});

test('picked candidate overrides cache as picked', () => {
  const { w } = boot();
  w.localStorage.clear();
  w.TappdIn.putCacheResolve('Finback', 'Something Mosaic', {
    url: 'https://untappd.com/b/wrong/1',
    id: '1',
    title: 'wrong',
    source: 'search',
  });
  w.TappdIn.putCacheResolve('Finback', 'Something Mosaic', {
    url: 'https://untappd.com/b/finback-brewery-something-mosaic/2706030',
    id: '2706030',
    title: 'Something Mosaic - Finback Brewery',
    source: 'picked',
  });
  const hit = w.TappdIn.getCachedResolve('Finback', 'Something Mosaic');
  assert.equal(hit.source, 'picked');
  assert.equal(hit.id, '2706030');
  assert.equal(w.TappdIn.rowSourceBadge({ status: 'done', source: 'picked', fromCache: false }), 'searched');
  assert.equal(w.TappdIn.rowSourceBadge({ status: 'done', source: 'cache', fromCache: true }), 'saved');
});

test('cache hit skips network on resolveBeer; bypassCache forces fetch', async () => {
  const { w } = boot();
  w.localStorage.clear();
  w.TappdIn.putCacheResolve('Finback', 'Something Mosaic', {
    url: 'https://untappd.com/b/finback-brewery-something-mosaic/2706030',
    id: '2706030',
    title: 'Something Mosaic',
    source: 'search',
  });
  let fetched = 0;
  w.fetch = async () => {
    fetched += 1;
    return {
      ok: true,
      async json() {
        return {
          confident: true,
          best: {
            url: 'https://untappd.com/b/finback-brewery-something-mosaic/2706030',
            id: '2706030',
            slug: 'finback-brewery-something-mosaic',
            title: 'Something Mosaic - Finback Brewery',
          },
          candidates: [],
          providerCalls: 1,
        };
      },
    };
  };
  const cached = await w.TappdIn.resolveBeer('Finback', 'Something Mosaic', {});
  assert.equal(fetched, 0);
  assert.equal(cached.fromCache, true);
  const retried = await w.TappdIn.resolveBeer('Finback', 'Something Mosaic', {}, { bypassCache: true });
  assert.equal(fetched, 1);
  assert.equal(retried.fromCache, false);
  assert.equal(retried.providerCalls, 1);
});

test('resolve worker supports batch + perplexity', () => {
  const worker = fs.readFileSync(path.join(root, 'proxy/resolve-worker.js'), 'utf8');
  assert.match(worker, /api\.perplexity\.ai\/search/);
  assert.match(worker, /resolve-batch/);
  assert.doesNotMatch(worker, /catalog\.beer/);
});
