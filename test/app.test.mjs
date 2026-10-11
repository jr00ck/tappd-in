import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract\.js@5\/dist\/tesseract\.min\.js"><\/script>\s*/g, '')
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

test('boots without errors and shows v0.3.1-beta', () => {
  const { d, errors } = boot();
  assert.equal(errors.length, 0, errors.join(' | '));
  assert.equal(d.getElementById('app-version').textContent, 'v0.3.1-beta');
  assert.ok(d.getElementById('catalog-key'));
  assert.ok(d.getElementById('search-btn'));
  assert.ok(d.getElementById('open-catalog-btn'));
});

test('Catalog.beer settings save on device only', () => {
  const { d, w } = boot();
  d.getElementById('catalog-key').value = 'test-catalog-key';
  d.getElementById('catalog-proxy-url').value = 'https://example.workers.dev/search';
  d.getElementById('save-settings-btn').click();
  const stored = JSON.parse(w.localStorage.getItem('tappd-in.settings'));
  assert.equal(stored.catalogApiKey, 'test-catalog-key');
  assert.equal(stored.catalogProxyUrl, 'https://example.workers.dev/search');
});

test('sortCatalogCandidates prefers matching brewery + beer', () => {
  const { w } = boot();
  const ranked = w.TappdIn.sortCatalogCandidates([
    {
      beerName: 'Duality // Mortalis',
      breweryName: 'Woven Water Brewing',
    },
    {
      beerName: 'Strange Philosophies',
      breweryName: 'Mortalis Brewing Company',
    },
    {
      beerName: 'A Long Strange Ride',
      breweryName: 'Joyride Brewing Company',
    },
  ], 'Mortalis', 'Strange Philosophies');
  assert.equal(ranked[0].beerName, 'Strange Philosophies');
  assert.equal(ranked[0].breweryName, 'Mortalis Brewing Company');
});

test('candidateFromCatalogItem builds catalog.beer URL from UUID only', () => {
  const { w } = boot();
  const c = w.TappdIn.candidateFromCatalogItem({
    id: '6a7119c6-92a2-40d2-b87a-2e4529c8577a',
    name: 'Sculpin IPA',
    style: 'American-Style India Pale Ale',
    abv: 7,
    ibu: 70,
    brewer: { id: 'ab94abb7-a3e8-4cce-8945-4758cac66a53', name: 'Ballast Point Brewing Company' },
  });
  assert.equal(c.source, 'catalog');
  assert.equal(c.catalogUrl, 'https://catalog.beer/beer/6a7119c6-92a2-40d2-b87a-2e4529c8577a');
  assert.equal(c.breweryName, 'Ballast Point Brewing Company');
  assert.equal(w.TappdIn.candidateFromCatalogItem({ id: 'not-a-uuid', name: 'X' }), null);
  assert.equal(w.TappdIn.catalogBeerPageUrl('nope'), null);
});

test('selecting a catalog candidate sets Catalog + Untappd search links', () => {
  const { d, w } = boot();
  const c = w.TappdIn.candidateFromCatalogItem({
    id: '6a7119c6-92a2-40d2-b87a-2e4529c8577a',
    name: 'Sculpin IPA',
    style: 'IPA',
    abv: 7,
    brewer: { name: 'Ballast Point Brewing Company' },
  });
  w.TappdIn.selectMatch(c);
  assert.equal(d.getElementById('match-panel').hidden, false);
  assert.equal(
    d.getElementById('open-catalog-btn').href,
    'https://catalog.beer/beer/6a7119c6-92a2-40d2-b87a-2e4529c8577a'
  );
  assert.match(d.getElementById('open-untappd-btn').href, /untappd\.com\/search/);
  assert.match(decodeURIComponent(d.getElementById('open-untappd-btn').href), /Ballast/);
  assert.equal(d.getElementById('open-untappd-btn').textContent.trim(), 'Search on Untappd');
});

test('public Untappd URL helpers still work', () => {
  const { w } = boot();
  const beer = w.TappdIn.parseUntappdUrl(
    'https://untappd.com/b/finback-brewery-something-mosaic/2706030'
  );
  assert.equal(beer.type, 'beer');
  assert.equal(beer.beerId, '2706030');
});

test('paste Untappd URL still opens exact beer link', () => {
  const { d } = boot();
  d.getElementById('paste-url').value =
    'https://untappd.com/b/finback-brewery-something-mosaic/2706030';
  d.getElementById('apply-paste-btn').click();
  assert.equal(d.getElementById('match-panel').hidden, false);
  assert.equal(
    d.getElementById('open-untappd-btn').href,
    'https://untappd.com/b/finback-brewery-something-mosaic/2706030'
  );
  assert.equal(d.getElementById('open-untappd-btn').textContent.trim(), 'Open in Untappd');
});

test('voice UI is demoted under details', () => {
  assert.match(html, /Voice \(AICHE/);
  assert.match(html, /voice-details/);
  assert.match(html, /Catalog\.beer API key/);
});

test('catalog worker stub exists', () => {
  const worker = fs.readFileSync(path.join(root, 'proxy/catalog-worker.js'), 'utf8');
  assert.match(worker, /api\.catalog\.beer\/beer\/search/);
  assert.match(worker, /api\.catalog\.beer\/brewer\/search/);
  assert.match(worker, /CATALOG_BEER_API_KEY/);
  assert.match(worker, /smartSearch|brewer_beers|brewery-first/i);
});
