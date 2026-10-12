import { test, mock } from 'node:test';
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

test('boots as v0.4.3-beta with quick-entry UI', () => {
  const { d, errors } = boot();
  assert.equal(errors.length, 0, errors.join(' | '));
  assert.equal(d.getElementById('app-version').textContent, 'v0.4.3-beta');
  assert.ok(d.getElementById('brewery-field'));
  assert.ok(d.getElementById('beer-field'));
  assert.ok(d.getElementById('new-brewer-btn'));
  assert.equal(d.getElementById('camera-btn'), null);
});

test('parseUntappdBeerUrl normalizes www, query, slash', () => {
  const { w } = boot();
  const p = w.TappdIn.parseUntappdBeerUrl(
    'https://www.untappd.com/b/finback-brewery-something-mosaic/2706030/?ref=x'
  );
  assert.equal(p.url, 'https://untappd.com/b/finback-brewery-something-mosaic/2706030');
  assert.equal(p.id, '2706030');
  assert.equal(w.TappdIn.parseUntappdBeerUrl('https://untappd.com/search?q=x'), null);
});

test('normalizeMatchText + cacheKey', () => {
  const { w } = boot();
  assert.equal(
    w.TappdIn.cacheKey('Finback Brewing Co.', 'Something Mosaic'),
    w.TappdIn.cacheKey('finback', 'something mosaic')
  );
  assert.match(w.TappdIn.normalizeMatchText('The Ale & Lager Brewery'), /ale and lager/);
});

test('scoreCandidate prefers matching slug', () => {
  const { w } = boot();
  const good = w.TappdIn.scoreCandidate(
    'Finback',
    'Something Mosaic',
    { slug: 'finback-brewery-something-mosaic', id: '1', url: 'https://untappd.com/b/finback-brewery-something-mosaic/1' },
    'Something Mosaic'
  );
  const bad = w.TappdIn.scoreCandidate(
    'Finback',
    'Something Mosaic',
    { slug: 'other-brewery-ipa', id: '2', url: 'https://untappd.com/b/other-brewery-ipa/2' },
    'IPA'
  );
  assert.ok(good > bad);
  assert.ok(w.TappdIn.isConfident({ score: 0.95 }, { score: 0.5 }));
  assert.equal(w.TappdIn.isConfident({ score: 0.5 }, null), false);
});

test('cache hit skips network on resolveBeer', async () => {
  const { w } = boot();
  w.localStorage.clear();
  w.TappdIn.putCacheResolve('Finback', 'Something Mosaic', {
    url: 'https://untappd.com/b/finback-brewery-something-mosaic/2706030',
    id: '2706030',
    title: 'Something Mosaic',
    source: 'search',
  });
  let fetched = false;
  w.fetch = async () => {
    fetched = true;
    throw new Error('network should not run');
  };
  const result = await w.TappdIn.resolveBeer('Finback', 'Something Mosaic', {});
  assert.equal(fetched, false);
  assert.equal(result.fromCache, true);
  assert.equal(result.best.id, '2706030');
  assert.equal(result.confident, true);
});

test('manual cache override wins over prior search entry', () => {
  const { w } = boot();
  w.localStorage.clear();
  w.TappdIn.putCacheResolve('Finback', 'Something Mosaic', {
    url: 'https://untappd.com/b/wrong-slug/1',
    id: '1',
    title: 'wrong',
    source: 'search',
  });
  w.TappdIn.putCacheResolve('Finback', 'Something Mosaic', {
    url: 'https://untappd.com/b/finback-brewery-something-mosaic/2706030',
    id: '2706030',
    title: 'Something Mosaic',
    source: 'manual',
  });
  const hit = w.TappdIn.getCachedResolve('Finback', 'Something Mosaic');
  assert.equal(hit.source, 'manual');
  assert.equal(hit.id, '2706030');
});

test('resolve worker file is Perplexity-based', () => {
  const worker = fs.readFileSync(path.join(root, 'proxy/resolve-worker.js'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'proxy/resolve-core.js'), 'utf8');
  assert.match(worker, /api\.perplexity\.ai\/search/);
  assert.match(worker, /searchType:\s*'fast'/);
  assert.match(worker, /PERPLEXITY_API_KEY/);
  assert.match(worker, /\/resolve/);
  assert.match(core, /buildQueryVariants/);
  assert.doesNotMatch(worker, /catalog\.beer/);
});
