// Connection deadlines must not abort a healthy, long-running media body.
export async function fetchMedia(url, options = {}, headerTimeout = 12000, idleTimeout = 20000) {
  const abort = new AbortController();
  const headerTimer = setTimeout(() => abort.abort(Error('media_timeout')), headerTimeout);
  let response;
  try {response = await fetch(url, {...options, signal:abort.signal})}
  finally {clearTimeout(headerTimer)}
  if (!response.body) return response;
  const reader = response.body.getReader(); let closed = false, idleTimer;
  const body = new ReadableStream({
    async pull(controller) {
      if (closed) return;
      try {
        const next = await Promise.race([reader.read(), new Promise((_, reject) => {
          idleTimer = setTimeout(() => {const error = Error('media_idle_timeout'); abort.abort(error); reject(error)}, idleTimeout);
        })]); clearTimeout(idleTimer);
        if (closed) return;
        if (next.done) {closed = true; controller.close()}
        else controller.enqueue(next.value);
      } catch (error) {
        clearTimeout(idleTimer); if (closed) return;
        closed = true; abort.abort(error); reader.cancel(error).catch(() => {}); controller.error(error);
      }
    },
    async cancel(reason) {closed = true; clearTimeout(idleTimer); abort.abort(reason); await reader.cancel(reason).catch(() => {})}
  });
  return new Response(body, {status:response.status, statusText:response.statusText, headers:response.headers});
}

// Resume a truncated static segment/file at the exact missing byte. Never mix
// a different resource or a server that ignores Range into the client's body.
export function recoverMedia(response, fetchRange, authorized, attempts = 2) {
  const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  const declared = response.headers.get('content-length');
  const length = declared === null && range ? Number(range[2]) - Number(range[1]) + 1 : Number(declared);
  if (!response.ok || !response.body || !Number.isSafeInteger(length) || length <= 0 || (response.status === 206 && !range)) return response;
  const start = range ? Number(range[1]) : 0, total = range ? Number(range[3]) : length;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(total) || start + length > total || (range && Number(range[2]) !== start + length - 1)) return response;
  const etag = response.headers.get('etag'), validatorName = etag && !etag.startsWith('W/') ? 'etag' : 'last-modified';
  const validator = response.headers.get(validatorName);
  let reader = response.body.getReader(), received = 0, retries = 0, closed = false;
  const body = new ReadableStream({
    async pull(controller) {
      while (!closed) {
        try {
          const next = await reader.read();
          if (closed) return;
          if (next.done) {if (received !== length) throw Error('truncated_http_body'); closed = true; controller.close(); return}
          if (received + next.value.byteLength > length) {closed = true; await reader.cancel(); controller.error(Error('invalid_media_length')); return}
          received += next.value.byteLength; controller.enqueue(next.value); return;
        } catch (error) {
          await reader.cancel().catch(() => {}); if (closed) return;
          let resumed;
          try {
            if (received >= length || retries++ >= attempts || !await authorized()) {closed = true; controller.error(error); return}
            if (closed) return;
            const from = start + received;
            resumed = await fetchRange(`bytes=${from}-${start + length - 1}`, validator);
            const match = resumed.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
            const sameValidator = !validator || validator === resumed.headers.get(validatorName);
            if (resumed.status !== 206 || !resumed.body || !match || Number(match[1]) !== from || Number(match[2]) !== start + length - 1 || Number(match[3]) !== total || !sameValidator) {
              await resumed.body?.cancel(); throw Error('invalid_media_resume');
            }
            if (closed) {await resumed.body?.cancel(); return}
            reader = resumed.body.getReader();
          } catch (failure) {closed = true; controller.error(failure); return}
        }
      }
    },
    async cancel(reason) {closed = true; await reader.cancel(reason).catch(() => {})}
  });
  return new Response(body, {status:response.status, statusText:response.statusText, headers:response.headers});
}
