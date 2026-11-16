import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createVpnRelay} from './relay.mjs';

export function createRelayHttpServer(relay) {
  const server = createServer(async (input, output) => {
  const controller = new AbortController();
  output.on('close', () => controller.abort());
  try {
    const request = new Request('http://relay' + input.url, {method: input.method, headers: input.headers, signal: controller.signal});
    const response = await relay(request);
    output.writeHead(response.status, Object.fromEntries(response.headers));
    if (input.method === 'HEAD' || !response.body) output.end();
    else await pipeline(Readable.fromWeb(response.body), output);
  } catch {
    if (!output.headersSent) output.writeHead(503, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
    output.end('{"error":"relay_unavailable"}');
  }
  });
  server.requestTimeout = 30000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const token = readFileSync('/run/secrets/relay_token', 'utf8').trim();
  const relay = createVpnRelay({token, edgeOrigin: process.env.EDGE_ORIGIN});
  createRelayHttpServer(relay).listen(8787, '0.0.0.0');
}
