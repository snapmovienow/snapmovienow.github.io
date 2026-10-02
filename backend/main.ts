const ORIGIN = "http://ccf.center:8444";
const SITE = "https://snapmovienow.github.io";

const actions: Record<string, string> = {
  vod_categories: "get_vod_categories",
  vod: "get_vod_streams",
  series_categories: "get_series_categories",
  series: "get_series",
  series_info: "get_series_info",
};

const headers = {
  "Access-Control-Allow-Origin": SITE,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

Deno.serve(async (req) => {
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

    if (op !== "auth" && !Object.hasOwn(actions, op)) {
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

    const url = new URL(ORIGIN + "/player_api.php");
    url.searchParams.set("username", String(body.username));
    url.searchParams.set("password", String(body.password));

    if (op !== "auth") {
      url.searchParams.set("action", actions[op]);
    }

    if (op === "series_info" && body.series_id) {
      url.searchParams.set("series_id", String(body.series_id));
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
