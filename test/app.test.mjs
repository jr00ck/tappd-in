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

test('boots as v0.9.1-beta with chip + find UI', () => {
  const { d, errors } = boot();
  assert.equal(errors.length, 0, errors.join(' | '));
  assert.equal(d.getElementById('app-version').textContent, 'v0.9.1-beta');
  assert.ok(d.getElementById('brewery-chip'));
  assert.ok(d.getElementById('brewery-suggest'));
  assert.ok(d.getElementById('nav-trends'));
  assert.ok(d.getElementById('nav-breweries'));
  assert.ok(d.getElementById('page-breweries'));
  assert.equal(d.getElementById('brewery-recent'), null);
  assert.equal(d.getElementById('brewery-suggestions'), null);
  assert.ok(d.getElementById('find-links-btn'));
  assert.ok(d.getElementById('beer-detail'));
  assert.ok(d.getElementById('import-export-btn'));
  assert.equal(d.getElementById('camera-btn'), null);
  assert.match(d.querySelector('.entry-flow-hint')?.textContent || '', /Find links/);
});

test('shortBreweryName + history migrate collapses North Park dupes', () => {
  const { w } = boot((dom) => {
    dom.window.localStorage.setItem('tappd-in.breweryHistory', JSON.stringify([
      { name: 'North Park Beer Company', count: 2, lastUsed: 2 },
      { name: 'North park', count: 1, lastUsed: 1 },
    ]));
  });
  assert.equal(w.TappdIn.shortBreweryName('North Park Beer Company'), 'North Park');
  w.TappdIn.migrateBreweryHistory();
  const hist = JSON.parse(w.localStorage.getItem('tappd-in.breweryHistory'));
  assert.equal(hist.length, 1);
  assert.equal(hist[0].name, 'North Park');
  assert.equal(hist[0].count, 3);
});

test('import checkins CSV marks Had and resolves Lupulin from export', () => {
  const { w } = boot();
  const csv = fs.readFileSync(
    path.join(root, 'test/fixtures/untappd-checkins-sample.csv'),
    'utf8'
  );
  const r = w.TappdIn.importCheckinsCsv(csv);
  assert.equal(r.rows, 6);
  assert.ok(r.beers >= 5);
  w.TappdIn.importCheckinsCsv(csv);
  const lib = JSON.parse(w.localStorage.getItem('tappd-in.beerLibrary'));
  assert.equal(lib.checkins.length, 6);
  const hit = w.TappdIn.libraryLookup('North Park', 'Lupulin Collider Batch 6');
  assert.ok(hit);
  assert.equal(hit.bid, '6628541');
  assert.equal(hit.checkins, 1);
  assert.equal(
    w.TappdIn.parseUntappdBeerUrl('https://untappd.com/beer/6628541').id,
    '6628541'
  );
  const groups = w.TappdIn.groupCheckinsByMonth(lib.checkins);
  assert.deepEqual(Array.from(groups, (g) => g.key), ['2026-10', '2026-01', '2025-12', '2025-08', '2025-06']);
  assert.deepEqual(
    Array.from(groups.find((g) => g.key === '2025-12').checkins, (c) => c.beer),
    ['Warm Glow', 'Crispy Morning']
  );
});

test('account JSON is saved beers, not dated check-ins', () => {
  const { w, d } = boot();
  const csv = fs.readFileSync(
    path.join(root, 'test/fixtures/untappd-checkins-sample.csv'),
    'utf8'
  );
  w.TappdIn.importCheckinsCsv(csv);
  assert.throws(
    () => w.TappdIn.importAccountJson('{"user":{}}'),
    /Check-ins live in the CSV/
  );
  w.TappdIn.importAccountJson(JSON.stringify({
    custom_lists: [{
      name: 'Wishlist',
      items: [
        { item_type: 'beer', item_id: '999', beer_name: 'Ghost', beer_brewery_name: 'Other Brewing' },
        {
          item_type: 'beer',
          item_id: '6628541',
          beer_name: 'Lupulin Collider Batch 6',
          beer_brewery_name: 'North Park Beer Company',
        },
      ],
    }],
  }));
  assert.equal(w.TappdIn.libraryLookup('Other', 'Ghost'), null);
  const hit = w.TappdIn.libraryLookup('North Park', 'Lupulin Collider Batch 6');
  assert.equal(hit.wishlist, true);
  assert.equal(hit.checkins, 1);
  w.TappdIn.renderHadLog();
  const panel = d.getElementById('had-panel');
  assert.equal(panel.hidden, false);
  assert.equal(d.getElementById('had-count').textContent, '6');
  assert.match(d.getElementById('had-summary').textContent, /3\s*brewer/);
  const months = [...d.querySelectorAll('#had-list > .month-group')];
  assert.equal(months.length, 6);
  assert.equal(months[0].classList.contains('is-open'), true);
  assert.match(months[0].textContent, /Lupulin Collider Batch 6/);
  assert.match(months[0].textContent, /North Park/);
  assert.match(months[0].textContent, /4\.4/);
  assert.ok(months[0].querySelector('.entry-brewery'));
  assert.doesNotMatch(months[0].textContent, /Ghost/);
  assert.match(months[5].textContent, /Saved/);
  months[5].querySelector('.month-toggle').click();
  assert.match(d.getElementById('had-list').textContent, /Ghost/);

  d.querySelector('.entry[data-id]').click();
  const editor = d.getElementById('checkin-editor');
  assert.equal(editor.hidden, false);
  assert.equal(d.getElementById('checkin-advanced').hidden, true);
  assert.equal(d.getElementById('checkin-beer').value, 'Lupulin Collider Batch 6');
  assert.equal(d.getElementById('checkin-brewery').value, 'North Park');
  assert.equal(d.getElementById('checkin-rating').value, '4.4');
  assert.equal(d.getElementById('checkin-serving').value, 'Can');
  assert.equal(d.getElementById('checkin-venue').value, 'Untappd at Home');
  d.getElementById('checkin-advanced-toggle').click();
  assert.equal(d.getElementById('checkin-advanced').hidden, false);
  assert.equal(d.getElementById('checkin-style').value, 'IPA - Triple New England / Hazy');
  assert.equal(d.getElementById('checkin-bid').value, '6628541');
  assert.match(d.getElementById('checkin-facts').textContent, /Untappd 4\.38/);
  assert.match(d.getElementById('checkin-facts').textContent, /Saved on Wishlist/);
  d.getElementById('checkin-rating').value = '4.75';
  editor.requestSubmit();
  assert.equal(editor.hidden, true);
  assert.equal(
    w.TappdIn.libraryLookup('North Park', 'Lupulin Collider Batch 6').rating,
    4.75
  );
  assert.match(d.querySelector('.entry[data-id]').textContent, /4\.75/);
});

test('cleans Photos chrome and prefers beer display names', () => {
  const { w } = boot();
  assert.equal(
    w.TappdIn.cleanUntappdTitle('X-Raying Rakau - North Park Beer Co | Photos'),
    'X-Raying Rakau - North Park Beer Co'
  );
  assert.equal(
    w.TappdIn.parseTitleParts('X-Raying Rakau - North Park Beer Co | Photos').brewery,
    'North Park Beer Co'
  );
  assert.equal(
    w.TappdIn.displayBeerName({
      title: 'X-Raying Rakau - North Park Beer Co | Photos',
      beer: 'x-raying',
    }),
    'X-Raying Rakau'
  );
  assert.equal(w.TappdIn.rowKind({ status: 'done', url: 'https://x', confident: true }), 'linked');
  assert.equal(w.TappdIn.rowKind({ status: 'done', candidates: [{ url: 'https://x' }] }), 'pick');
  assert.equal(w.TappdIn.rowKind({ status: 'done' }), 'miss');
});

test('brewery and beer suggest pills appear while typing, not as a default Recent list', () => {
  const { d, w } = boot((dom) => {
    dom.window.localStorage.setItem('tappd-in.breweryHistory', JSON.stringify([
      { name: 'Finback', count: 3, lastUsed: 2 },
      { name: 'North Park', count: 1, lastUsed: 1 },
    ]));
  });
  const csv = fs.readFileSync(
    path.join(root, 'test/fixtures/untappd-checkins-sample.csv'),
    'utf8'
  );
  w.TappdIn.importCheckinsCsv(csv);
  assert.equal(d.getElementById('brewery-suggest').hidden, true);
  assert.notEqual(d.activeElement, d.getElementById('brewery-field'));
  const breweryField = d.getElementById('brewery-field');
  breweryField.value = 'Nor';
  breweryField.dispatchEvent(new w.Event('input', { bubbles: true }));
  const brewSuggest = d.getElementById('brewery-suggest');
  assert.equal(brewSuggest.hidden, false);
  assert.match(brewSuggest.textContent, /North Park/);
  d.querySelector('#brewery-suggest-chips [data-value]').click();
  assert.equal(d.getElementById('brewery-chip').textContent, 'North Park');
  assert.equal(brewSuggest.hidden, true);
  assert.equal(d.activeElement, d.getElementById('beer-field'));

  const beerField = d.getElementById('beer-field');
  beerField.value = 'Lup';
  beerField.dispatchEvent(new w.Event('input', { bubbles: true }));
  const beerSuggest = d.getElementById('beer-suggest');
  assert.equal(beerSuggest.hidden, false);
  assert.match(beerSuggest.textContent, /Lupulin Collider Batch 6/);
});

test('brewery suggest tap wins over blur change with partial typed text', () => {
  const { d, w } = boot((dom) => {
    dom.window.localStorage.setItem('tappd-in.breweryHistory', JSON.stringify([
      { name: 'North Park', count: 2, lastUsed: 1 },
    ]));
  });
  const csv = fs.readFileSync(
    path.join(root, 'test/fixtures/untappd-checkins-sample.csv'),
    'utf8'
  );
  w.TappdIn.importCheckinsCsv(csv);
  const breweryField = d.getElementById('brewery-field');
  breweryField.value = 'Nort';
  breweryField.dispatchEvent(new w.Event('input', { bubbles: true }));
  const chip = d.querySelector('#brewery-suggest-chips [data-value="North Park"]');
  assert.ok(chip);
  // Mobile-ish sequence: pointerdown (prevent blur commit), then change with
  // partial text, then click the chip.
  chip.dispatchEvent(new w.Event('pointerdown', { bubbles: true, cancelable: true }));
  breweryField.dispatchEvent(new w.Event('change', { bubbles: true }));
  chip.click();
  assert.equal(d.getElementById('brewery-chip').textContent, 'North Park');
  assert.notEqual(d.getElementById('brewery-chip').textContent, 'Nort');
});

test('Breweries tab lists logged breweries and opens beer stats', () => {
  const { d, w } = boot();
  const csv = fs.readFileSync(
    path.join(root, 'test/fixtures/untappd-checkins-sample.csv'),
    'utf8'
  );
  w.TappdIn.importCheckinsCsv(csv);
  d.getElementById('nav-breweries').click();
  assert.equal(d.getElementById('page-log').hidden, true);
  assert.equal(d.getElementById('page-breweries').hidden, false);
  const list = d.getElementById('brewery-browse-list');
  assert.match(list.textContent, /North Park/);
  list.querySelector('[data-brewery="North Park"]').click();
  assert.equal(d.getElementById('brewery-browse-detail').hidden, false);
  assert.match(d.getElementById('brewery-browse-name').textContent, /North Park/);
  assert.match(d.getElementById('brewery-browse-beers').textContent, /Lupulin/);
  d.getElementById('brewery-browse-queue').click();
  assert.equal(d.getElementById('page-log').hidden, false);
  assert.equal(d.getElementById('brewery-chip').textContent, 'North Park');
});

test('trends page renders check-in charts from the library', () => {
  const { d, w } = boot();
  const csv = fs.readFileSync(
    path.join(root, 'test/fixtures/untappd-checkins-sample.csv'),
    'utf8'
  );
  w.TappdIn.importCheckinsCsv(csv);
  d.getElementById('nav-trends').click();
  assert.equal(d.getElementById('page-log').hidden, true);
  assert.equal(d.getElementById('page-trends').hidden, false);
  assert.equal(d.getElementById('trends-empty').hidden, true);
  assert.equal(d.getElementById('chart-checkins').hidden, false);
  assert.equal(d.getElementById('chart-breweries').hidden, false);
  assert.match(d.getElementById('chart-checkins-body').innerHTML, /svg/);
});

test('brewery avg and beer match hint reuse the Had list without a new page', () => {
  const { d, w } = boot();
  const csv = fs.readFileSync(
    path.join(root, 'test/fixtures/untappd-checkins-sample.csv'),
    'utf8'
  );
  w.TappdIn.importCheckinsCsv(csv);
  const stats = w.TappdIn.breweryStats('North Park');
  assert.equal(stats.beerCount, 3);
  assert.ok(stats.avg > 4);
  assert.equal(stats.beers.length, 3);

  const had = w.TappdIn.beerMatchState('North Park', 'Lupulin Collider Batch 6');
  assert.equal(had.kind, 'had');
  assert.equal(had.rating, 4.4);
  assert.ok(had.breweryAvg > 4);

  const fresh = w.TappdIn.beerMatchState('North Park', 'Brand New Double');
  assert.equal(fresh.kind, 'new');

  d.getElementById('brewery-field').value = 'North Park';
  d.getElementById('brewery-field').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(d.getElementById('brewery-chip').textContent, 'North Park');
  const shelf = d.getElementById('brewery-shelf');
  assert.equal(shelf.hidden, false);
  assert.match(d.getElementById('brewery-shelf-summary').textContent, /3 beers/);
  assert.match(d.getElementById('brewery-shelf-summary').textContent, /avg/);
  d.getElementById('brewery-shelf-toggle').click();
  assert.equal(d.getElementById('brewery-shelf-panel').hidden, false);
  assert.match(d.getElementById('brewery-shelf-list').textContent, /Lupulin Collider Batch 6/);
  assert.match(d.getElementById('brewery-shelf-list').textContent, /4\.4/);

  d.getElementById('beer-field').value = 'Lupulin Collider Batch 6';
  d.getElementById('beer-field').dispatchEvent(new w.Event('input', { bubbles: true }));
  const hint = d.getElementById('beer-match-hint');
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /Had/);
  assert.match(hint.textContent, /4\.4/);
  assert.match(hint.textContent, /avg/);
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
