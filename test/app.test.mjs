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

test('boots without errors and shows v0.1.0', () => {
  const { d, errors } = boot();
  assert.equal(errors.length, 0, errors.join(' | '));
  assert.equal(d.getElementById('app-version').textContent, 'v0.1.0');
  assert.ok(d.getElementById('camera-btn'));
  assert.ok(d.getElementById('open-untappd-btn'));
});

test('Updated badge renders release notes', () => {
  const { d } = boot((dom) => {
    dom.window.localStorage.setItem('tappd-in.lastSeenVersion', '0.0.1');
  });
  const badge = d.getElementById('updated-badge');
  const panel = d.getElementById('whats-new');
  assert.equal(badge.hidden, false);
  badge.click();
  assert.equal(panel.hidden, false);
  assert.match(panel.querySelector('.whats-new-title').textContent, /v0\.1\.0/);
  const items = [...panel.querySelectorAll('.whats-new-list li')].map((li) => li.textContent);
  assert.ok(items.length >= 1);
});

test('manifest locks portrait; pinch zoom stays off', () => {
  assert.match(html, /user-scalable=no/);
  assert.match(html, /maximum-scale=1/);
  const manifest = fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8');
  assert.match(manifest, /"orientation":\s*"portrait"/);
  assert.match(manifest, /"name":\s*"Tappd In"/);
});

test('parseBeerUrl accepts canonical Finback Something Mosaic URL only', () => {
  const { w } = boot();
  const { parseBeerUrl } = w.TappdIn;
  const good = parseBeerUrl('https://untappd.com/b/finback-brewery-something-mosaic/2706030');
  assert.ok(good);
  assert.equal(good.slug, 'finback-brewery-something-mosaic');
  assert.equal(good.beerId, '2706030');
  assert.equal(good.url, 'https://untappd.com/b/finback-brewery-something-mosaic/2706030');
  assert.equal(parseBeerUrl('https://untappd.com/b/finback-brewery-something-mosaic/'), null);
  assert.equal(parseBeerUrl('https://evil.com/b/finback-brewery-something-mosaic/2706030'), null);
  assert.equal(parseBeerUrl('http://untappd.com/b/finback-brewery-something-mosaic/2706030'), null);
  assert.equal(parseBeerUrl('https://untappd.com/search?q=finback'), null);
});

test('parseLabelText pulls brewery and beer lines', () => {
  const { w } = boot();
  const parsed = w.TappdIn.parseLabelText(`Finback Brewery
Something Mosaic
IPA
6.5% ABV`);
  assert.match(parsed.brewery, /Finback/i);
  assert.match(parsed.beer, /Something Mosaic/i);
  assert.ok(parsed.raw.includes('IPA'));
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
  assert.equal(c.beerId, '2706030');
  assert.equal(w.TappdIn.candidateFromApiItem({ bid: 1, beer_slug: '' }), null);
  assert.equal(w.TappdIn.candidateFromApiItem({ beer_slug: 'x' }), null);
});

test('paste URL selects match and enables Open in Untappd', () => {
  const { d } = boot();
  d.getElementById('paste-url').value =
    'https://untappd.com/b/finback-brewery-something-mosaic/2706030';
  d.getElementById('apply-paste-btn').click();
  const panel = d.getElementById('match-panel');
  assert.equal(panel.hidden, false);
  assert.equal(
    d.getElementById('open-untappd-btn').href,
    'https://untappd.com/b/finback-brewery-something-mosaic/2706030'
  );
  assert.equal(
    d.getElementById('match-url').textContent,
    'https://untappd.com/b/finback-brewery-something-mosaic/2706030'
  );
});

test('deploy workflow ships on v* tags like Gassy', () => {
  const wf = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(wf, /tags:\s*\n\s*-\s*'v\*'/);
  assert.match(wf, /actions\/deploy-pages@v4/);
  assert.match(wf, /path: \./);
});
