// Catalog acquisition has no DOM, authentication storage or player dependencies.
// The caller supplies an authenticated API and decides whether the result still
// belongs to its current session before rendering it.
globalThis.SMNCatalog = Object.freeze({
  async load({api, permissions}) {
    const unavailable = [];
    async function rows(op, enabled) {
      if (!enabled) return [];
      try {
        const data = await api(op);
        if (!Array.isArray(data)) throw Error('invalid_catalog');
        const valid = data.filter(item => item && typeof item === 'object' && !Array.isArray(item));
        if (valid.length !== data.length) unavailable.push(op);
        return valid;
      } catch {
        unavailable.push(op);
        return [];
      }
    }
    const [movies, series, external, live, categories] = await Promise.all([
      rows('vod', permissions.movies),
      rows('series', permissions.series),
      rows('gnula_catalog', permissions.movies || permissions.series),
      rows('live', permissions.tv),
      rows('live_categories', permissions.tv)
    ]);
    return {
      movies, series, live, categories,
      externalMovies: permissions.movies ? external.filter(item => item.type !== 'series') : [],
      externalSeries: permissions.series ? external.filter(item => item.type === 'series') : [],
      unavailable
    };
  }
});
