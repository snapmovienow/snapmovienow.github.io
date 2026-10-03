const ORIGIN = "http://ccf.center:8444";
const SITE = "https://snapmovienow.github.io";

const actions: Record<string, string> = {
  vod_categories: "get_vod_categories",
  vod: "get_vod_streams",
  series_categories: "get_series_categories",
  series: "get_series",
  series_info: "get_series_info",
  vod_info: "get_vod_info",
};

let kv: Deno.Kv | null = null;
try { kv = await Deno.openKv(); } catch { kv = null; }
const streamTickets = new Map<string, Record<string, any>>();
async function putTicket(token:string,data:Record<string,any>){
  if(kv){ await kv.set(["stream_ticket",token],data,{expireIn:43200000}); return "kv"; }
  streamTickets.set(token,data); return "memory";
}
async function getTicket(token:string){
  if(kv){ return (await kv.get<Record<string,any>>(["stream_ticket",token])).value; }
  return streamTickets.get(token)||null;
}

const headers = {
  "Access-Control-Allow-Origin": SITE,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, range, if-range",
  "Cache-Control": "no-store",
};

Deno.serve(async (req) => {
  const requestUrl = new URL(req.url);

  if (requestUrl.pathname === "/health" && req.method === "GET") {
    try {
      return Response.json({ ok: true, tickets: kv ? "kv" : "memory-fallback", version: "playback-v4" }, { headers: { ...headers, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } });
    } catch (e) {
      return Response.json({ ok: false, kv: false, error: String(e) }, { status: 500, headers });
    }
  }

  if (requestUrl.pathname === "/storage-health" && req.method === "GET") {
    try {
      const kv = await Deno.openKv();
      const key = ["health", crypto.randomUUID()];
      await kv.set(key, "ok", { expireIn: 60000 });
      const value = await kv.get(key);
      await kv.delete(key);
      kv.close();
      return Response.json({ ok: value.value === "ok", storage: "deno-kv" }, { headers });
    } catch (e) {
      return Response.json({ ok: false, storage: "deno-kv", error: String(e) }, { status: 500, headers });
    }
  }

  if (requestUrl.pathname === "/stream" && req.method === "GET") {
    try {
      const token = requestUrl.searchParams.get("t") || "";
      const data = await getTicket(token);
      if (!data || data.expires < Date.now()) {
        if (!kv) streamTickets.delete(token);\n        return new Response("Stream link expired", { status: 410 });
      }
      if (!data.username || !data.password || !data.id || !data.type) {
        return new Response("Bad stream request", { status: 400 });
      }
      const folder = data.type === "series" ? "series" : "movie";
      const ext = String(data.ext || "mp4").replace(/[^a-zA-Z0-9]/g, "") || "mp4";
      const target = ORIGIN + "/" + folder + "/" + encodeURIComponent(data.username) + "/" + encodeURIComponent(data.password) + "/" + encodeURIComponent(data.id) + "." + ext;
      const range = req.headers.get("range");
      const upstreamHeaders = new Headers();
      if (range) upstreamHeaders.set("Range", range);
      const ifRange = req.headers.get("if-range");
      if (ifRange) upstreamHeaders.set("If-Range", ifRange);
      const upstream = await fetch(target, { headers: upstreamHeaders, redirect: "follow" });
      const h = new Headers();
      for (const name of ["content-type","content-length","content-range","accept-ranges","etag","last-modified"]) {
        const v = upstream.headers.get(name); if (v) h.set(name,v);
      }
      h.set("Access-Control-Allow-Origin", SITE);
      h.set("Access-Control-Expose-Headers","Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, X-Stream-Range-Warning");
      h.set("Cache-Control","no-store");
      if (range && upstream.status !== 206) h.set("X-Stream-Range-Warning", "upstream-did-not-return-206");
      return new Response(upstream.body,{status:upstream.status,headers:h});
    } catch {
      return new Response("Stream unavailable",{status:502});
    }
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers },
    );
  }

  try {
    const body = await req.json();
    const op = String(body.op || "");

    if (op !== "auth" && op !== "stream_token" && op !== "stream_probe" && !Object.hasOwn(actions, op)) {
      return Response.json(
        { error: "operation_not_allowed" },
        { status: 403, headers },
      );
    }

    if (!body.username || !body.password) {
      return Response.json(
        { error: "credentials_required" },
        { status: 400, headers },
      );
    }

    if (op === "stream_probe") {
      const folder = body.type === "series" ? "series" : "movie";
      const ext = String(body.ext || "mp4").replace(/[^a-zA-Z0-9]/g, "") || "mp4";
      const target = ORIGIN + "/" + folder + "/" + encodeURIComponent(String(body.username)) + "/" + encodeURIComponent(String(body.password)) + "/" + encodeURIComponent(String(body.id || "")) + "." + ext;
      const started = performance.now();
      const first = await fetch(target, { headers: { Range: "bytes=0-1" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
      const cr = first.headers.get("content-range"), ar = first.headers.get("accept-ranges"), ct = first.headers.get("content-type"), cl = first.headers.get("content-length");
      const initialMs = Math.round(performance.now() - started);
      await first.body?.cancel();
      let randomStatus = 0, randomRange = null, randomMs = null;
      const totalMatch = cr?.match(/\/(\d+)$/);
      if (first.status === 206 && totalMatch) {
        const total = Number(totalMatch[1]), pos = Math.max(0, Math.floor(total * 0.5)), t1 = performance.now();
        const second = await fetch(target, { headers: { Range: "bytes=" + pos + "-" + (pos + 1) }, redirect: "follow", signal: AbortSignal.timeout(12000) });
        randomStatus = second.status; randomRange = second.headers.get("content-range"); randomMs = Math.round(performance.now() - t1);
        await second.body?.cancel();
      }
      return Response.json({ rangeSupported:first.status===206 && !!cr, initialStatus:first.status, contentRange:cr, acceptRanges:ar, contentType:ct, contentLength:cl, initialMs, randomStatus, randomRange, randomMs }, { headers });
    }

    if (op === "stream_token") {
      const token = crypto.randomUUID();
      const ticket={ username:String(body.username), password:String(body.password), type:String(body.type||"movie"), id:String(body.id||""), ext:String(body.ext||"mp4"), expires:Date.now()+43200000 };
      const store=await putTicket(token,ticket);
      return Response.json({ url:requestUrl.origin+"/stream?t="+token, ticket_store:store }, { headers });
    }

    const url = new URL(ORIGIN + "/player_api.php");
    url.searchParams.set("username", String(body.username));
    url.searchParams.set("password", String(body.password));

    if (op !== "auth") {
      url.searchParams.set("action", actions[op]);
    }

    if (op === "series_info" && body.series_id) {
      url.searchParams.set("series_id", String(body.series_id));
    }
    if (op === "vod_info" && body.vod_id) {
      url.searchParams.set("vod_id", String(body.vod_id));
    }

    const upstream = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        ...headers,
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch {
    return Response.json(
      { error: "upstream_unavailable" },
      { status: 502, headers },
    );
  }
});
