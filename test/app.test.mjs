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

test('boots without errors and shows v0.2.0-beta', () => {
  const { d, errors } = boot();
  assert.equal(errors.length, 0, errors.join(' | '));
  assert.equal(d.getElementById('app-version').textContent, 'v0.2.0-beta');
  assert.ok(d.getElementById('voice-btn'));
  assert.ok(d.getElementById('aiche-key'));
  assert.ok(d.getElementById('open-untappd-btn'));
});

test('Updated badge renders release notes', () => {
  const { d } = boot((dom) => {
    dom.window.localStorage.setItem('tappd-in.lastSeenVersion', '0.1.0');
  });
  const badge = d.getElementById('updated-badge');
  const panel = d.getElementById('whats-new');
  assert.equal(badge.hidden, false);
  badge.click();
  assert.equal(panel.hidden, false);
  assert.match(panel.querySelector('.whats-new-title').textContent, /v0\.2\.0-beta/);
});

test('manifest locks portrait; pinch zoom stays off', () => {
  assert.match(html, /user-scalable=no/);
  assert.match(html, /maximum-scale=1/);
  const manifest = fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8');
  assert.match(manifest, /"orientation":\s*"portrait"/);
});

test('public Untappd URL helpers cover beer, brewery, user, check-in, venue, RSS', () => {
  const { w } = boot();
  const T = w.TappdIn;

  const beer = T.parseUntappdUrl('https://untappd.com/b/finback-brewery-something-mosaic/2706030');
  assert.equal(beer.type, 'beer');
  assert.equal(beer.beerId, '2706030');
  assert.equal(beer.url, T.beerUrl('finback-brewery-something-mosaic', '2706030'));

  const brewery = T.parseUntappdUrl('https://untappd.com/w/finback-brewery/12345');
  assert.equal(brewery.type, 'brewery');
  assert.equal(brewery.breweryId, '12345');

  const user = T.parseUntappdUrl('https://untappd.com/user/cdyde');
  assert.equal(user.type, 'user');
  assert.equal(user.username, 'cdyde');

  const checkin = T.parseUntappdUrl('https://untappd.com/user/cdyde/checkin/1593590563');
  assert.equal(checkin.type, 'checkin');
  assert.equal(checkin.checkinId, '1593590563');

  const venue = T.parseUntappdUrl('https://untappd.com/v/untappd-hq-ilm/4871493');
  assert.equal(venue.type, 'venue');
  assert.equal(venue.venueId, '4871493');

  const rss = T.parseUntappdUrl('https://untappd.com/rss/venue/4871493');
  assert.equal(rss.type, 'venue_rss');

  assert.equal(T.beerUrl('bad slug!', '1'), null);
  assert.equal(T.parseUntappdUrl('http://untappd.com/b/x/1'), null);
  assert.equal(T.parseUntappdUrl('https://evil.com/b/x/1'), null);
});

test('parseVoiceBeerText splits brewery and beer', () => {
  const { w } = boot();
  const a = w.TappdIn.parseVoiceBeerText(
    'Roses by the Stairs, Fresh Hop This Is Growing Up'
  );
  assert.match(a.brewery, /Roses by the Stairs/i);
  assert.match(a.beer, /This Is Growing Up/i);

  const b = w.TappdIn.parseVoiceBeerText(
    'brewery Finback beer Something Mosaic'
  );
  assert.equal(b.brewery, 'Finback');
  assert.equal(b.beer, 'Something Mosaic');
});

test('parseLabelText pulls brewery and beer lines', () => {
  const { w } = boot();
  const parsed = w.TappdIn.parseLabelText(`Finback Brewery
Something Mosaic
IPA
6.5% ABV`);
  assert.match(parsed.brewery, /Finback/i);
  assert.match(parsed.beer, /Something Mosaic/i);
});

test('candidateFromApiItem builds URL only from API slug + bid', () => {
  const { w } = boot();
  const c = w.TappdIn.candidateFromApiItem({
    bid: 2706030,
    beer_slug: 'finback-brewery-something-mosaic',
    beer_name: 'Something Mosaic',
    beer_style: 'IPA - New England / Hazy',
    beer_abv: 6.5,
    brewery: { brewery_name: 'Finback Brewery' },
  });
  assert.equal(c.url, 'https://untappd.com/b/finback-brewery-something-mosaic/2706030');
  assert.equal(w.TappdIn.candidateFromApiItem({ bid: 1, beer_slug: '' }), null);
});

test('paste URL selects match and enables Open in Untappd', () => {
  const { d } = boot();
  d.getElementById('paste-url').value =
    'https://untappd.com/b/finback-brewery-something-mosaic/2706030';
  d.getElementById('apply-paste-btn').click();
  assert.equal(d.getElementById('match-panel').hidden, false);
  assert.equal(
    d.getElementById('open-untappd-btn').href,
    'https://untappd.com/b/finback-brewery-something-mosaic/2706030'
  );
});

test('AICHE key saves to localStorage only', () => {
  const { d, w } = boot();
  d.getElementById('aiche-key').value = 'sk_live_test_key_not_real';
  d.getElementById('save-settings-btn').click();
  const stored = JSON.parse(w.localStorage.getItem('tappd-in.settings'));
  assert.equal(stored.aicheApiKey, 'sk_live_test_key_not_real');
  assert.equal(stored.proxyUrl, '');
});

test('deploy workflow ships on v* tags like Gassy', () => {
  const wf = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(wf, /tags:\s*\n\s*-\s*'v\*'/);
  assert.match(wf, /actions\/deploy-pages@v4/);
});
