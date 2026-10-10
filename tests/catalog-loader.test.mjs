import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../catalog-loader.js', import.meta.url), 'utf8'), context);
const permissions = {movies: true, series: true, tv: true};
const movie = {stream_id: 1, name: 'Movie'};
const show = {series_id: 2, name: 'Series'};
const channel = {stream_id: 3, name: 'Live'};

// A malformed category response used to throw during rendering and clear login.
// Preserve the independent, healthy catalogs and report exactly what failed.
const data = await context.SMNCatalog.load({permissions, api: async op => {
  if (op === 'vod') return null;
  if (op === 'series') return [null, show, 42, 'invalid'];
  if (op === 'live') return [channel];
  if (op === 'live_categories') return {error: 'upstream response'};
  throw Error('provider unavailable');
}});
assert.equal(data.movies.length, 0);
assert.equal(data.series.length, 1);
assert.equal(data.series[0], show);
assert.equal(data.live[0], channel);
assert.equal(data.categories.length, 0);
assert.deepEqual([...data.unavailable].sort(), ['gnula_catalog', 'live_categories', 'series', 'vod']);

// No request or externally supplied rows may open a disabled content family.
for (const allowed of [{movies: true, series: false, tv: false}, {movies: false, series: true, tv: false}]) {
  const requested = [];
  const result = await context.SMNCatalog.load({permissions: allowed, api: async op => {
    requested.push(op);
    return op === 'gnula_catalog' ? [{...movie, type: 'movie'}, {...show, type: 'series'}] : [];
  }});
  assert.equal(requested.includes('live'), false);
  assert.equal(requested.includes('live_categories'), false);
  assert.equal(requested.includes('vod'), allowed.movies);
  assert.equal(requested.includes('series'), allowed.series);
  assert.equal(result.externalMovies.length, Number(allowed.movies));
  assert.equal(result.externalSeries.length, Number(allowed.series));
}
let calls = 0;
const disabled = await context.SMNCatalog.load({permissions: {}, api: async () => {calls++;}});
assert.equal(calls, 0);
assert.equal(disabled.unavailable.length, 0);
console.log('PASS: malformed/partial catalogs preserve healthy content and disabled families remain isolated.');
