import test from 'node:test';
import assert from 'node:assert/strict';
import {browserResponse,withSessionCookie} from '../src/browser-sessions.mjs';

const env={WEB_ORIGINS:'https://app.snaptvnow.com'};
const req=(url='https://api.snaptvnow.com/health',origin='https://app.snaptvnow.com')=>new Request(url,{headers:origin?{Origin:origin}:{}});

test('JSON controls get conservative security headers without replacing stricter portal policies',async()=>{
 const response=browserResponse(Response.json({ok:true},{status:202,headers:{Vary:'Accept-Encoding','Cache-Control':'private, no-store'}}),req(),env);
 assert.equal(response.status,202);assert.deepEqual(await response.json(),{ok:true});
 assert.equal(response.headers.get('Strict-Transport-Security'),'max-age=86400');
 assert.equal(response.headers.get('Permissions-Policy'),'camera=(), microphone=(), geolocation=(), usb=()');
 assert.equal(response.headers.get('Content-Security-Policy'),"frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
 assert.equal(response.headers.get('X-Frame-Options'),'DENY');
 assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 assert.equal(response.headers.get('Vary'),'Accept-Encoding, Origin');
 const strict=browserResponse(new Response('page',{headers:{'Content-Type':'text/html','Strict-Transport-Security':'max-age=31536000','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Permissions-Policy':'camera=(), microphone=()','X-Frame-Options':'SAMEORIGIN'}}),req(),env);
 assert.equal(strict.headers.get('Strict-Transport-Security'),'max-age=31536000');
 assert.equal(strict.headers.get('Content-Security-Policy'),"default-src 'none'; frame-ancestors 'none'");
 assert.equal(strict.headers.get('Permissions-Policy'),'camera=(), microphone=()');
 assert.equal(strict.headers.get('X-Frame-Options'),'SAMEORIGIN');
 await strict.body.cancel();
});

test('media stream, range, validators, cache and cookies are retained without reading or buffering',async()=>{
 let pulls=0;
 const body=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array([0,1,2,3]));controller.close();}});
 const input=new Response(body,{status:206,statusText:'Partial Content',headers:{'Content-Type':'video/mp2t','Content-Length':'4','Content-Range':'bytes 8-11/100','Accept-Ranges':'bytes',ETag:'"unchanged"','Last-Modified':'Tue, 17 Nov 2026 00:00:00 GMT','Cache-Control':'private, no-store',Vary:'Origin, Range','Set-Cookie':'private=opaque; Secure; HttpOnly; SameSite=Strict'}});
 const before=pulls,response=browserResponse(input,req('https://api.snaptvnow.com/stream'),env);
 assert.equal(pulls,before);assert.equal(input.bodyUsed,false);
 assert.equal(response.body,body);assert.equal(response.status,206);assert.equal(response.statusText,'Partial Content');
 for(const name of ['Content-Type','Content-Length','Content-Range','Accept-Ranges','ETag','Last-Modified','Cache-Control','Vary','Set-Cookie'])assert.equal(response.headers.get(name),input.headers.get(name),name);
 assert.equal(response.headers.has('Content-Security-Policy'),false);
 assert.equal(response.headers.has('X-Frame-Options'),false);
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([0,1,2,3]));
 const playlist=browserResponse(new Response('#EXTM3U\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}}),req('https://api.snaptvnow.com/stream'),env);
 assert.equal(playlist.headers.has('Content-Security-Policy'),false);assert.equal(await playlist.text(),'#EXTM3U\n');
});

test('allowed CORS and secure session cookies survive; wrong origins and legacy HTTP retain their behavior',async()=>{
 const request=req(),input=withSessionCookie(Response.json({ok:true}),request,env,'admin','synthetic-token',7200),response=browserResponse(input,request,env);
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://app.snaptvnow.com');
 assert.equal(response.headers.get('Access-Control-Allow-Credentials'),'true');
 assert.equal(response.headers.get('Set-Cookie'),input.headers.get('Set-Cookie'));
 for(const flag of ['Secure','HttpOnly','SameSite=Strict','Path=/','Max-Age=7200'])assert.ok(response.headers.get('Set-Cookie').includes(flag));
 await response.body.cancel();
 const blocked=browserResponse(Response.json({ok:false},{status:403,headers:{'Access-Control-Allow-Origin':'https://app.snaptvnow.com','Access-Control-Allow-Credentials':'true'}}),req(undefined,'https://other.invalid'),env);
 assert.equal(blocked.status,403);assert.equal(blocked.headers.has('Access-Control-Allow-Origin'),false);assert.equal(blocked.headers.has('Access-Control-Allow-Credentials'),false);await blocked.body.cancel();
 const http=browserResponse(new Response(null,{status:204,headers:{Vary:'*'}}),req('http://api.snaptvnow.com/player_api.php'),env);
 assert.equal(http.status,204);assert.equal(http.headers.has('Strict-Transport-Security'),false);assert.equal(http.headers.has('Location'),false);assert.equal(http.headers.get('Vary'),'*');
});
