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

test('boots as v0.9.6-beta with chip + find UI', () => {
  const { d, errors } = boot();
  assert.equal(errors.length, 0, errors.join(' | '));
  assert.equal(d.getElementById('app-version').textContent, 'v0.9.6-beta');
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
  assert.equal(w.TappdIn.breweryFullFromInput('North Park Beer Company'), 'North Park Beer Company');
  assert.equal(w.TappdIn.breweryFullFromInput('North Park'), '');
  w.TappdIn.migrateBreweryHistory();
  const hist = JSON.parse(w.localStorage.getItem('tappd-in.breweryHistory'));
  assert.equal(hist.length, 1);
  assert.equal(hist[0].name, 'North Park');
  assert.equal(hist[0].fullName, 'North Park Beer Company');
  assert.equal(hist[0].count, 3);
});

test('queued brewery keeps full name for resolve/search while UI stays short', () => {
  const { d, w } = boot();
  d.getElementById('brewery-field').value = 'Mortalis Brewing Company';
  d.getElementById('brewery-field').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(d.getElementById('brewery-chip').textContent, 'Mortalis');
  d.getElementById('beer-field').value = 'Strange Philosophies';
  d.getElementById('add-beer-btn').click();
  const session = JSON.parse(w.localStorage.getItem('tappd-in.session'));
  assert.equal(session.groups[0].brewery, 'Mortalis');
  assert.equal(session.groups[0].breweryFull, 'Mortalis Brewing Company');
  assert.equal(
    w.TappdIn.resolveBreweryQuery(session.groups[0]),
    'Mortalis Brewing Company'
  );
  assert.match(
    w.TappdIn.untappdSearchWebUrl('Mortalis Brewing Company', 'Strange Philosophies'),
    /Mortalis\+Brewing\+Company/
  );
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

test('re-importing a check-ins CSV updates ratings and keeps local-only rows', () => {
  const { w } = boot();
  const csv = fs.readFileSync(
    path.join(root, 'test/fixtures/untappd-checkins-sample.csv'),
    'utf8'
  );
  const first = w.TappdIn.importCheckinsCsv(csv);
  assert.equal(first.added, 6);
  assert.equal(first.updated, 0);
  const again = w.TappdIn.importCheckinsCsv(csv);
  assert.equal(again.added, 0);
  assert.equal(again.updated, 0);
  assert.equal(again.unchanged, 6);
  assert.equal(again.rows, 6);

  const lib = JSON.parse(w.localStorage.getItem('tappd-in.beerLibrary'));
  lib.checkins.push({
    id: 'local-only',
    beer: 'Kitchen Test',
    brewery: 'Home',
    breweryFull: 'Home Brewing',
    rating: 3,
    createdAt: '2026-11-01 12:00:00',
  });
  w.localStorage.setItem('tappd-in.beerLibrary', JSON.stringify(lib));

  const updatedCsv = csv.replace(
    'TDH Infinite Content,North Park Beer Company,IPA - New England / Hazy,7.2,9,,Beer Barn,Gilbert,AZ,United States,33.3216,-111.72,4,',
    'TDH Infinite Content,North Park Beer Company,IPA - New England / Hazy,7.2,9,,Beer Barn,Gilbert,AZ,United States,33.3216,-111.72,4.75,'
  );
  const third = w.TappdIn.importCheckinsCsv(updatedCsv);
  assert.equal(third.added, 0);
  assert.equal(third.updated, 1);
  assert.equal(third.rows, 7);
  const after = JSON.parse(w.localStorage.getItem('tappd-in.beerLibrary'));
  const tdh = after.checkins.find((c) => c.beer === 'TDH Infinite Content');
  assert.equal(tdh.rating, 4.75);
  assert.ok(after.checkins.some((c) => c.id === 'local-only'));
  assert.equal(w.TappdIn.describeCheckinImport(third), 'Check-ins: 1 updated, 5 already saved');
});

test('Untappd search single hit links Driving Up the Coast', () => {
  const { w } = boot();
  const hit = {
    bid: 5210382,
    beer_name: 'Driving Up the Coast',
    brewery_name: 'Mikerphone Brewing',
    beer_slug: 'mikerphone-brewing-driving-up-the-coast',
  };
  const body = w.TappdIn.buildUntappdSearchResolution('mikerphone brewing', 'Driving up the coast', [hit], 1);
  assert.equal(body.confident, true);
  assert.equal(body.best.id, '5210382');
  assert.equal(body.meta.untappdSearchHits, 1);
  assert.match(body.untappdSearchUrl, /Driving\+up\+the\+coast/);

  const typo = w.TappdIn.buildUntappdSearchResolution('Brujos', 'Tres Maleditci', [{
    bid: 7142831,
    beer_name: 'Tres Maledicti',
    brewery_name: 'Brujos Brewing',
    beer_slug: 'brujos-brewing-tres-maledicti',
  }], 1);
  assert.equal(typo.confident, true);
  assert.equal(typo.best.id, '7142831');
  assert.equal(typo.best.url, 'https://untappd.com/b/brujos-brewing-tres-maledicti/7142831');

  const lookalike = {
    ...hit,
    bid: 1,
    beer_name: 'Driving Up the Coast Again',
    beer_slug: 'mikerphone-brewing-driving-up-the-coast-again',
  };
  const many = w.TappdIn.buildUntappdSearchResolution(
    'mikerphone brewing',
    'Driving up the coast',
    [lookalike, hit],
    2
  );
  assert.equal(many.confident, true);
  assert.equal(many.best.id, '5210382');
  assert.equal(w.TappdIn.untappdUsername('https://untappd.com/user/jr00ck'), 'jr00ck');
  assert.equal(w.TappdIn.untappdUsername('@jr00ck'), 'jr00ck');
});

test('profile HTML capture merges check-ins without duplicating', () => {
  const { w } = boot();
  const html = `
    <div class="item" data-checkin-id="988496714">
      <div class="checkin">
        <p class="text">
          <a href="/user/gregavola">Greg</a> is drinking an
          <a href="/b/alvarium-beer-company-i-remember-my-first-check-in-tepache-sour/4138042">I Remember My First Check-In: Tepache Sour</a>
          by <a href="/AlvariumBeer">Alvarium Beer Company</a>
          at <a href="/v/at-home/9917985">Untappd at Home</a>
        </p>
        <p class="comment-text">Nice beer</p>
        <div class="caps" data-rating="4.25"></div>
        <p class="serving"><span>Can</span></p>
        <a class="time" data-gregtime="Wed, 20 Jan 2021 23:48:00 +0000">20 Jan 21</a>
      </div>
    </div>`;
  const parsed = w.TappdIn.checkinsFromActivityHtml(html);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].beer, 'I Remember My First Check-In: Tepache Sour');
  assert.equal(parsed[0].brewery, 'Alvarium Beer Company');
  assert.equal(parsed[0].rating, 4.25);
  assert.equal(parsed[0].bid, '4138042');
  const first = w.TappdIn.importCapturedCheckins(JSON.stringify({ tappdInCapture: 1, checkins: parsed }));
  assert.equal(first.added, 1);
  const second = w.TappdIn.importCapturedCheckins(html);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.rows, 1);
  const lib = JSON.parse(w.localStorage.getItem('tappd-in.beerLibrary'));
  assert.equal(lib.checkins[0].rating, 4.25);
  assert.match(lib.checkins[0].createdAt, /^2021-01-20/);
  const bookmark = w.TappdIn.untappdCaptureBookmarklet();
  assert.match(bookmark, /^javascript:\(function\(\)/);
  assert.doesNotThrow(() => new w.Function(bookmark.slice('javascript:'.length)));
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
  assert.ok(d.getElementById('brewery-browse-filter'));
  assert.ok(d.querySelector('.sort-pill[data-sort="name"]'));
  list.querySelector('[data-brewery="North Park"]').click();
  assert.equal(d.getElementById('brewery-browse-detail').hidden, false);
  assert.match(d.getElementById('brewery-browse-name').textContent, /North Park/);
  assert.match(d.getElementById('brewery-browse-beers').textContent, /Lupulin/);
  d.getElementById('brewery-browse-queue').click();
  assert.equal(d.getElementById('page-log').hidden, false);
  assert.equal(d.getElementById('brewery-chip').textContent, 'North Park');
});

test('Breweries tab search + sort by rating / beers', () => {
  const { d, w } = boot();
  const csv = fs.readFileSync(
    path.join(root, 'test/fixtures/untappd-checkins-sample.csv'),
    'utf8'
  );
  w.TappdIn.importCheckinsCsv(csv);
  d.getElementById('nav-breweries').click();
  const sorted = w.TappdIn.sortBreweryBrowseList([
    { name: 'Zebra', beerCount: 1, avg: 4.9 },
    { name: 'Alpha', beerCount: 5, avg: 3.1 },
    { name: 'Mid', beerCount: 2, avg: null },
  ], 'rating');
  assert.equal(sorted[0].name, 'Zebra');
  assert.equal(w.TappdIn.sortBreweryBrowseList(sorted, 'beers')[0].name, 'Alpha');
  assert.equal(w.TappdIn.sortBreweryBrowseList(sorted, 'name')[0].name, 'Alpha');

  d.querySelector('.sort-pill[data-sort="beers"]').click();
  assert.match(d.getElementById('brewery-browse-list').textContent, /North Park/);
  const filter = d.getElementById('brewery-browse-filter');
  filter.value = 'north';
  filter.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.match(d.getElementById('brewery-browse-list').textContent, /North Park/);
  assert.doesNotMatch(d.getElementById('brewery-browse-list').textContent, /Other|Ghost/i);
  filter.value = 'zzzz-nope';
  filter.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(d.getElementById('breweries-filter-empty').hidden, false);
});

test('beer detail brewery edit moves the row and clears a miss', () => {
  const { d, w } = boot();
  d.getElementById('brewery-field').value = 'Bone';
  d.getElementById('brewery-field').dispatchEvent(new w.Event('change', { bubbles: true }));
  d.getElementById('beer-field').value = 'Haus IPA';
  d.getElementById('add-beer-btn').click();
  let session = JSON.parse(w.localStorage.getItem('tappd-in.session'));
  assert.equal(session.groups[0].brewery, 'Bone');
  session.groups[0].beers[0].status = 'error';
  session.groups[0].beers[0].error = 'No Untappd match';
  w.localStorage.setItem('tappd-in.session', JSON.stringify(session));
  // Re-boot session from storage by reloading UI path
  d.getElementById('session-groups').innerHTML = '';
  // Soft reopen: click the queued row through a fresh boot helper
  const { d: d2, w: w2 } = boot((dom) => {
    dom.window.localStorage.setItem('tappd-in.session', JSON.stringify(session));
  });
  d2.querySelector('[data-open-detail]')?.click();
  assert.equal(d2.getElementById('beer-detail').hidden, false);
  assert.equal(d2.getElementById('detail-beer').value, 'Haus IPA');
  assert.equal(d2.getElementById('detail-brewery').value, 'Bone');
  d2.getElementById('detail-brewery').value = 'Bone Haus Brewing';
  d2.getElementById('detail-brewery').dispatchEvent(new w.Event('change', { bubbles: true }));
  session = JSON.parse(w2.localStorage.getItem('tappd-in.session'));
  assert.equal(session.groups.length, 1);
  assert.equal(session.groups[0].brewery, 'Bone Haus');
  assert.equal(session.groups[0].breweryFull, 'Bone Haus Brewing');
  assert.equal(session.groups[0].beers[0].beer, 'Haus IPA');
  assert.equal(session.groups[0].beers[0].status, 'pending');
  assert.equal(d2.getElementById('detail-brewery').value, 'Bone Haus Brewing');
});

test('beerOpenHref prefers https Universal Links over untappd://', () => {
  const { w } = boot();
  assert.equal(
    w.TappdIn.beerOpenHref('https://untappd.com/b/foo/123', '123'),
    'https://untappd.com/b/foo/123'
  );
  assert.equal(w.TappdIn.beerOpenHref('', '99'), 'https://untappd.com/beer/99');
});

test('openUntappdSearch uses top-level search URL (not /home)', () => {
  const { w } = boot();
  const hrefs = [];
  const original = w.location;
  // jsdom location.href assignment — capture via defineProperty when possible
  let assigned = '';
  try {
    Object.defineProperty(w, 'location', {
      configurable: true,
      value: {
        ...original,
        set href(v) { assigned = String(v); },
        get href() { return assigned || original.href; },
        assign(v) { assigned = String(v); },
      },
    });
  } catch {
    // Some jsdom builds freeze location; assert URL builder instead.
  }
  const url = w.TappdIn.untappdSearchWebUrl('Bone Haus Brewing', 'Sparkling clover');
  assert.match(url, /untappd\.com\/search/);
  assert.match(url, /Bone\+Haus\+Brewing/);
  assert.match(url, /Sparkling\+clover|Sparkling%20clover/i);
  assert.doesNotMatch(url, /\/home/);
  if (typeof w.TappdIn.openUntappdSearch === 'function') {
    // Force “prefer app” path without touch: monkey-patch settings via storage
    w.localStorage.setItem('tappd-in.settings', JSON.stringify({ openInApp: true }));
    Object.defineProperty(w.navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
    w.TappdIn.openUntappdSearch('Bone Haus Brewing', 'Sparkling clover', null);
    if (assigned) {
      assert.match(assigned, /untappd\.com\/search/);
      assert.doesNotMatch(assigned, /untappd\.com\/home/);
    }
  }
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
  w.fetch = async (url) => {
    fetched += 1;
    const href = String(url);
    if (href.includes('algolia.net')) {
      return {
        ok: true,
        async json() {
          return {
            nbHits: 1,
            hits: [{
              bid: 2706030,
              beer_name: 'Something Mosaic',
              brewery_name: 'Finback Brewery',
              beer_slug: 'finback-brewery-something-mosaic',
            }],
          };
        },
      };
    }
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
  assert.equal(retried.providerCalls, 0);
  assert.equal(retried.best.id, '2706030');
  assert.equal(retried.pass, 'untappd_search');
});

test('resolve worker supports batch + perplexity', () => {
  const worker = fs.readFileSync(path.join(root, 'proxy/resolve-worker.js'), 'utf8');
  assert.match(worker, /api\.perplexity\.ai\/search/);
  assert.match(worker, /resolve-batch/);
  assert.doesNotMatch(worker, /catalog\.beer/);
});
