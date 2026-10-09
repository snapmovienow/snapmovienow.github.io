// One reviewed API destination; URL parameters cannot redirect credentials.
globalThis.SMNConfig=Object.freeze({
 version:'43',
 api:location.hostname==='localhost'||location.hostname==='127.0.0.1'
  ?'http://127.0.0.1:8787':'https://api.snaptvnow.com',
 cookieMode:['app.snaptvnow.com','panel.snaptvnow.com'].includes(location.hostname)
});
