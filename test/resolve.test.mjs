import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUntappdBeerUrl,
  scoreCandidate,
  buildResolveResponse,
  buildQueryVariants,
  flattenProviderResults,
  groupProviderResults,
  isConfident,
  cleanUntappdTitle,
  parseTitleParts,
} from '../proxy/resolve-core.js';

test('cleanUntappdTitle strips Photos chrome before beer/brewery split', () => {
  assert.equal(
    cleanUntappdTitle('X-Raying Rakau - North Park Beer Co | Photos'),
    'X-Raying Rakau - North Park Beer Co'
  );
  const parts = parseTitleParts('Lupulin - North Park Beer Co | Photos');
  assert.equal(parts.beer, 'Lupulin');
  assert.equal(parts.brewery, 'North Park Beer Co');
});

test('buildResolveResponse prefers cleaned titles without | Photos', () => {
  const body = buildResolveResponse('North Park', 'X-Raying Rakau', [
    {
      title: 'X-Raying Rakau - North Park Beer Co | Photos',
      url: 'https://untappd.com/b/north-park-beer-co-x-raying-rakau/6899298/photos',
      snippet: '',
    },
  ]);
  assert.equal(body.best?.title, 'X-Raying Rakau - North Park Beer Co');
  assert.ok(!/Photos/i.test(body.best?.title || ''));
});

test('parseUntappdBeerUrl accepts /photos, www, query; ignores checkin/venue', () => {
  assert.equal(
    parseUntappdBeerUrl(
      'https://www.untappd.com/b/finback-brewery-something-mosaic/2706030/photos?ref=1'
    ).url,
    'https://untappd.com/b/finback-brewery-something-mosaic/2706030'
  );
  assert.equal(
    parseUntappdBeerUrl('https://untappd.com/user/x/checkin/123'),
    null
  );
  assert.equal(parseUntappdBeerUrl('https://untappd.com/v/some-venue/9'), null);
  assert.equal(parseUntappdBeerUrl('https://untappd.com/w/finback/1'), null);
});

test('buildQueryVariants returns up to 5 strings', () => {
  const q = buildQueryVariants('Finback', 'Something Mosaic');
  assert.ok(q.length >= 4 && q.length <= 5);
  assert.ok(q.some((s) => /untappd/i.test(s)));
});

test('flattenProviderResults handles grouped multi-query arrays', () => {
  const flat = flattenProviderResults({
    results: [
      [{ title: 'A', url: 'https://untappd.com/b/a/1', snippet: '' }],
      [{ title: 'B', url: 'https://untappd.com/b/b/2', snippet: '' }],
    ],
  });
  assert.equal(flat.length, 2);
  assert.equal(flat[1].url, 'https://untappd.com/b/b/2');
});

test('groupProviderResults keeps per-query buckets for batch resolve', () => {
  const groups = groupProviderResults({
    results: [
      [{ title: 'A', url: 'https://untappd.com/b/a/1', snippet: '' }],
      [{ title: 'B', url: 'https://untappd.com/b/b/2', snippet: '' }],
    ],
  });
  assert.equal(groups.length, 2);
  assert.equal(groups[0][0].url, 'https://untappd.com/b/a/1');
  assert.equal(groups[1][0].url, 'https://untappd.com/b/b/2');
});

test('Finback Something Mosaic beats Double/Nothing look-alikes; /photos + checkin fixtures', () => {
  const pages = [
    {
      title: 'Double Something Mosaic - Finback Brewery',
      url: 'https://untappd.com/b/finback-brewery-double-something-mosaic/9990001',
      snippet: '',
    },
    {
      title: 'Nothing Mosaic - Finback Brewery',
      url: 'https://untappd.com/b/finback-brewery-nothing-mosaic/9990002/photos',
      snippet: '',
    },
    {
      title: 'Something Mosaic - Finback Brewery',
      url: 'https://untappd.com/b/finback-brewery-something-mosaic/2706030/photos',
      snippet: 'Hoppy IPA',
    },
    {
      title: 'Check-in',
      url: 'https://untappd.com/user/someone/checkin/1600097809',
      snippet: 'had Something Mosaic https://untappd.com/b/finback-brewery-something-mosaic/2706030',
    },
  ];
  const body = buildResolveResponse('Finback', 'Something Mosaic', pages);
  assert.equal(body.best.url, 'https://untappd.com/b/finback-brewery-something-mosaic/2706030');
  assert.equal(body.best.id, '2706030');
  assert.equal(body.confident, true);
  // Dedupe by id — photos + checkin snippet → one candidate id
  const ids = body.candidates.map((c) => c.id);
  assert.equal(ids.filter((id) => id === '2706030').length, 1);
  assert.ok(
    scoreCandidate(
      'Finback',
      'Something Mosaic',
      { slug: 'finback-brewery-something-mosaic', id: '2706030', url: body.best.url },
      'Something Mosaic - Finback Brewery'
    )
    > scoreCandidate(
      'Finback',
      'Something Mosaic',
      { slug: 'finback-brewery-double-something-mosaic', id: '9', url: 'x' },
      'Double Something Mosaic - Finback Brewery'
    )
  );
});

test('Ballast Point Sculpin fixture resolves confidently', () => {
  const body = buildResolveResponse('Ballast Point', 'Sculpin', [
    {
      title: 'Sculpin - Ballast Point Brewing Company',
      url: 'https://untappd.com/b/ballast-point-brewing-company-sculpin/5558',
      snippet: '',
    },
    {
      title: 'Grapefruit Sculpin - Ballast Point',
      url: 'https://www.untappd.com/b/ballast-point-brewing-company-grapefruit-sculpin/285658/nearby',
      snippet: '',
    },
  ]);
  assert.equal(body.best.id, '5558');
  assert.equal(body.confident, true);
});

test('Mortalis Strange Philosophies fixture resolves confidently', () => {
  const body = buildResolveResponse('Mortalis', 'Strange Philosophies', [
    {
      title: 'Strange Philosophies - Mortalis Brewing Company',
      url: 'https://untappd.com/b/mortalis-brewing-company-strange-philosophies/6162765',
      snippet: '',
    },
    {
      title: 'Nemean - Mortalis',
      url: 'https://untappd.com/b/mortalis-brewing-company-nemean/3496237/photos',
      snippet: '',
    },
  ]);
  assert.match(body.best.slug, /strange-philosophies/);
  assert.equal(body.confident, true);
  assert.ok(isConfident(body.best, body.candidates[1], 'Strange Philosophies', 'Mortalis'));
});

test('North Park X-Raying Rakau / racau typo beats Nelson look-alike', () => {
  const pages = [
    {
      title: 'X-Raying Nelson - North Park Beer Company',
      url: 'https://untappd.com/b/north-park-beer-company-x-raying-nelson/5559529',
      snippet: '',
    },
    {
      title: 'X-Raying Rakau - North Park Beer Company',
      url: 'https://untappd.com/b/north-park-beer-company-x-raying-rakau/6899298',
      snippet: '',
    },
  ];
  const exact = buildResolveResponse('North Park', 'X-Raying Rakau', pages);
  assert.equal(exact.best.id, '6899298');
  assert.equal(exact.confident, true);
  const typo = buildResolveResponse('North Park', 'x-raying racau', pages);
  assert.equal(typo.best.id, '6899298');
  assert.equal(typo.confident, true);
});
