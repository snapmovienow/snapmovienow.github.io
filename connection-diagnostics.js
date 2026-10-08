(function (root) {
  'use strict';
  const safe = (value, pattern) => pattern.test(value || '') ? value : null;
  function metadata(response) {
    return {status: response.status,
      rayId: safe(response.headers.get('CF-Ray'), /^[a-f0-9]{8,32}-[a-z]{3}$/i),
      requestId: safe(response.headers.get('X-SMN-Request-ID'), /^[a-f0-9-]{36}$/i),
      version: safe(response.headers.get('X-SMN-Version'), /^\d{1,6}$/)};
  }
  function failure(code, response) {
    const error = new Error(code);
    error.status = response?.status || 0;
    error.diagnostics = response ? metadata(response) : {status: 0};
    return error;
  }
  async function readJSON(response) {
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { /* Edge errors can be HTML or text. */ }
    if (!response.ok) {
      const code = safe(data?.error, /^[a-z][a-z0-9_]{0,63}$/);
      const challenged = response.headers.get('cf-mitigated') === 'challenge';
      const blocked = response.status === 403 && /\berror code:\s*1010\b/i.test(text);
      throw failure(challenged || blocked ? 'edge_blocked' : code ||
        (response.status === 403 ? 'http_forbidden' : response.status >= 500 ? 'server_unavailable' : 'http_error'), response);
    }
    if (data === undefined) throw failure('invalid_response', response);
    return data;
  }
  async function transport(url, options) {
    let response;
    try { response = await root.fetch(url, options); }
    catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw failure('connection_timeout');
      throw failure('network_unreachable');
    }
    return response;
  }
  async function requestJSON(url, options) { return readJSON(await transport(url, options)); }
  function message(error, fallback) {
    const messages = {
      edge_blocked: 'Cloudflare bloqueó esta solicitud. Contacta al administrador con la referencia del error.',
      http_forbidden: 'El servidor rechazó el acceso (HTTP 403). Contacta al administrador.',
      network_unreachable: 'No se pudo conectar al servidor. Comprueba tu conexión o contacta al administrador.',
      connection_timeout: 'El servidor tardó demasiado en responder.',
      server_unavailable: 'El servidor no está disponible en este momento.',
      upstream_unavailable: 'El proveedor no entregó el contenido. Contacta al administrador.',
      service_unavailable: 'No se pudo completar la solicitud en el servidor.',
      invalid_response: 'El servidor devolvió una respuesta que no se pudo leer.'
    };
    const text = messages[error?.message];
    if (!text) return fallback;
    const info = error.diagnostics || {}, ref = info.rayId || info.requestId;
    return text + (ref ? ' Referencia: ' + ref + '.' : '');
  }
  async function check(origin) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('invalid_api_origin');
    const started = performance.now();
    const response = await transport(new URL('/health', url), {cache: 'no-store', signal: AbortSignal.timeout(12000)});
    const info = metadata(response), health = await readJSON(response);
    if (health?.ok !== true || health.service !== 'snapmovienow-edge' || !health.capabilities?.includes('xtream')) throw failure('invalid_response', response);
    const auth = await transport(new URL('/player_api.php', url), {cache: 'no-store', signal: AbortSignal.timeout(12000)});
    let protectedAPI = false;
    try { await readJSON(auth); }
    catch (error) {
      if (auth.status === 401 && error.message === 'credentials_required') protectedAPI = true;
      else throw error;
    }
    if (!protectedAPI) throw failure('invalid_response', auth);
    return {...info, origin: url.origin, version: health.version, elapsedMs: Math.round(performance.now() - started), checkedAt: new Date().toISOString(), protectedAPI};
  }
  root.SMNConnection = Object.freeze({readJSON, requestJSON, message, check});
})(globalThis);
