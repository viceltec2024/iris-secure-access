import { getChatGPTUser } from "../../chatgpt-auth";
import { provisionIrisUser } from "../../../lib/authz";
import { enforceRateLimit } from "../../../lib/rate-limit";
import { fetchLiveTape, fetchMarketBoard, fetchMarketChart, isMarketRange, isMarketSymbol, normalizeMarketSymbol, searchMarket } from "../../../lib/iris-market";

export const dynamic = "force-dynamic";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

const liveHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await enforceRateLimit(`iris-market:${user.email}`, 40, 60 * 1000))) {
    return Response.json({ error: "Too many live market requests" }, { status: 429, headers: { "Retry-After": "20" } });
  }

  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "live";
  const language = url.searchParams.get("language") === "en" ? "en" : "es";

  try {
    if (view === "live") {
      return Response.json(await fetchLiveTape(), { headers: liveHeaders });
    }
    if (view === "board") {
      return Response.json(await fetchMarketBoard(language), { headers: liveHeaders });
    }
    if (view === "chart") {
      const symbol = normalizeMarketSymbol(url.searchParams.get("symbol") || "");
      const chosen = url.searchParams.get("range") || "1d";
      if (!isMarketSymbol(symbol)) return Response.json({ error: "Invalid symbol" }, { status: 400 });
      const chart = await fetchMarketChart(symbol, isMarketRange(chosen) ? chosen : "1d");
      return Response.json({ ...chart, live: chart.quote.live }, { headers: liveHeaders });
    }
    if (view === "search") {
      const query = (url.searchParams.get("q") || "").trim();
      return Response.json({ results: await searchMarket(query) }, { headers: liveHeaders });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Live market feed unavailable" }, { status: 502 });
  }

  return Response.json({ error: "Unsupported view" }, { status: 400 });
}
