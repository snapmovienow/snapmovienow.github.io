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

const streamTickets = new Map<string, Record<string, any>>();

const headers = {
  "Access-Control-Allow-Origin": SITE,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

Deno.serve(async (req) => {
  const requestUrl = new URL(req.url);

  if (requestUrl.pathname === "/health" && req.method === "GET") {
    try {
      return Response.json({ ok: true, tickets: "memory", version: "playback-v3" }, { headers: { ...headers, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } });
    } catch (e) {
      return Response.json({ ok: false, kv: false, error: String(e) }, { status: 500, headers });
    }
  }

  if (requestUrl.pathname === "/stream" && req.method === "GET") {
    try {
      const token = requestUrl.searchParams.get("t") || "";
      const data = streamTickets.get(token) || null;
      if (!data || data.expires < Date.now()) {
        streamTickets.delete(token);
        return new Response("Stream link expired", { status: 410 });
      }
      if (!data.username || !data.password || !data.id || !data.type) {
        return new Response("Bad stream request", { status: 400 });
      }
      const folder = data.type === "series" ? "series" : "movie";
      const ext = String(data.ext || "mp4").replace(/[^a-zA-Z0-9]/g, "") || "mp4";
      const target = ORIGIN + "/" + folder + "/" + encodeURIComponent(data.username) + "/" + encodeURIComponent(data.password) + "/" + encodeURIComponent(data.id) + "." + ext;
      const range = req.headers.get("range");
      const upstream = await fetch(target, { headers: range ? { Range: range } : {}, redirect: "follow" });
      const h = new Headers();
      for (const name of ["content-type","content-length","content-range","accept-ranges"]) {
        const v = upstream.headers.get(name); if (v) h.set(name,v);
      }
      h.set("Access-Control-Allow-Origin", SITE);
      h.set("Cache-Control","no-store");
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

    if (op !== "auth" && op !== "stream_token" && !Object.hasOwn(actions, op)) {
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

    if (op === "stream_token") {
      const token = crypto.randomUUID();
      streamTickets.set(token, { username: String(body.username), password: String(body.password), type: String(body.type || "movie"), id: String(body.id || ""), ext: String(body.ext || "mp4"), expires: Date.now() + 300000 });
      return Response.json({ url: requestUrl.origin + "/stream?t=" + token }, { headers });
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
