import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';

const base=dirname(fileURLToPath(import.meta.url));
const temp=mkdtempSync(join(tmpdir(),'meridiano-proxy-check-'));
const openssl=args=>execFileSync('openssl',args,{cwd:temp,stdio:'ignore'});
try {
  openssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','root.key','-out','root.pem','-days','2',
    '-subj','/CN=Meridiano-Local-Test-CA','-addext','basicConstraints=critical,CA:TRUE',
    '-addext','keyUsage=critical,digitalSignature,keyCertSign,cRLSign']);
  openssl(['req','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=origin.test']);
  writeFileSync(join(temp,'extensions.cnf'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:origin.test,DNS:proxy.test\n');
  openssl(['x509','-req','-in','server.csr','-CA','root.pem','-CAkey','root.key','-CAcreateserial','-out','server.pem','-days','2','-sha256','-extfile','extensions.cnf']);
  const output=join(temp,'protocol-check.bundle.mjs');
  buildSync({entryPoints:[join(base,'protocol-check.mjs')],bundle:true,platform:'node',format:'esm',target:'node24',
    outfile:output,alias:{'cloudflare:sockets':join(base,'cloudflare-socket-fixture.mjs')},logLevel:'warning'});
  execFileSync(process.execPath,[output],{env:{...process.env,MERIDIANO_TLS_FIXTURE:temp},stdio:'inherit'});
} finally {rmSync(temp,{recursive:true,force:true});}
