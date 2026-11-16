import tls from 'node:tls';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {Readable, Writable} from 'node:stream';

// Local-only adapter: these tests never connect to a public host.
export function connect(address, options) {
  if (address.hostname !== 'proxy.test' || options.secureTransport !== 'on') throw Error('Only the local TLS proxy fixture is permitted');
  const socket = tls.connect({host:'127.0.0.1', port:globalThis.proxyFixturePort,
    servername:'proxy.test', ca:readFileSync(join(process.env.MERIDIANO_TLS_FIXTURE,'root.pem')), rejectUnauthorized:true});
  const opened = new Promise((resolve,reject)=>{socket.once('secureConnect',resolve);socket.once('error',reject)});
  opened.catch(()=>{});
  return {readable:Readable.toWeb(socket), writable:Writable.toWeb(socket), opened,
    closed:new Promise(resolve=>socket.once('close',resolve)),
    close:async()=>{socket.destroy()},
    startTls(){throw Error('Native nested TLS is deliberately unavailable in this fixture')}};
}
