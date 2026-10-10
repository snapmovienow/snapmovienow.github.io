import {isAdult} from './content-permissions.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (!/^\d+$/.test(String(value))) return null;
  const n = Number(value);
  return Number.isInteger(n) && n <= 2147483647 ? n : null;
};
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value : fallback;
const episodeRow=row=>object(row)&&/^\d{1,16}$/.test(String(row.id))&&Number.isSafeInteger(Number(row.id));
export const countSeriesEpisodes=data=>Object.values(data?.episodes||{}).reduce((sum,rows)=>sum+(Array.isArray(rows)?rows.filter(episodeRow).length:episodeRow(rows)?1:0),0);

// SNAP reads the episode groups directly. Other Xtream players first select a
// season from `seasons`, then use its number to read `episodes`. Build both from
// the same permitted rows, even when the provider omits season metadata.
// This runs on already sanitised metadata; playback IDs/URLs are mapped later.
export function normaliseSeries(data, adults = true) {
  const info = object(data.info) ? {...data.info} : {};
  const groups = new Map();
  for (const [key, rows] of Object.entries(data.episodes || {})) {
    const grouped=Array.isArray(rows);
    if (!grouped&&!episodeRow(rows)) continue;
    for (const [index, row] of (grouped?rows:[rows]).entries()) {
      if (!episodeRow(row)) continue;
      if (!adults && (isAdult(row) || isAdult(row.info))) continue;
      const season = (grouped?integer(key):null) ?? integer(row.season) ?? integer(row.info?.season) ?? (!grouped?1:null);
      if (season === null) continue;
      const episode = integer(row.episode_num) || (grouped?index+1:(groups.get(season)?.length||0)+1);
      if (!groups.has(season)) groups.set(season, []);
      groups.get(season).push({...row,season,episode_num:episode,
        title:text(row.title, `Episode ${episode}`),info:object(row.info) ? {...row.info} : {}});
    }
  }
  const metadata = new Map();
  for (const [key, season] of Object.entries(data.seasons || {})) {
    if (!object(season)) continue;
    const number = integer(season.season_number) ?? (!Array.isArray(data.seasons) ? integer(key) : null);
    if (number !== null && !metadata.has(number)) metadata.set(number, season);
  }
  const episodes = {}, seasons = [];
  for (const [number, rows] of [...groups].sort(([a], [b]) => a - b)) {
    rows.sort((a, b) => a.episode_num - b.episode_num);
    episodes[String(number)] = rows;
    const original = metadata.get(number) || {};
    const cover = text(original.cover, text(info.cover));
    seasons.push({...original,season_number:number,id:integer(original.id) ?? number,
      name:text(original.name, number === 0 ? 'Specials' : `Season ${number}`),
      episode_count:rows.length,air_date:text(original.air_date),overview:text(original.overview),
      cover,cover_big:text(original.cover_big,cover)});
  }
  return {info,seasons,episodes};
}
