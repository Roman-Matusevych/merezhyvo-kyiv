import http from "node:http";
import { URL } from "node:url";

const PORT = process.env.PORT || 3000;
const HOST = "https://app.yasno.ua/api/blackout-service/public/shutdowns";
const REGION = "25";
const DSO = "902";
const cache = new Map();
const CACHE_MS = 4 * 60 * 1000;

function send(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  res.end(JSON.stringify(data));
}
async function yasno(path) {
  const key = path;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const response = await fetch(`${HOST}${path}`, {
    headers: { "accept": "application/json", "user-agent": "Merezhyvo-KYIV/0.1 (public information viewer)" },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`YASNO upstream HTTP ${response.status}`);
  const data = await response.json();
  cache.set(key, { at: Date.now(), data });
  return data;
}
function queryParam(v) {
  return encodeURIComponent((v || "").trim());
}
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {"access-control-allow-origin":"*", "access-control-allow-methods":"GET,OPTIONS", "access-control-allow-headers":"content-type"});
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    try {
      let data;
      if (url.pathname === "/api/streets") {
        const q = (url.searchParams.get("q") || "").trim();
        if (q.length < 3) return send(res, 400, {error:"Введіть щонайменше 3 літери назви вулиці."});
        data = await yasno(`/addresses/v2/streets?regionId=${REGION}&dsoId=${DSO}&query=${queryParam(q)}`);
      } else if (url.pathname === "/api/houses") {
        const streetId = url.searchParams.get("streetId");
        const q = (url.searchParams.get("q") || "").trim();
        if (!streetId || !q) return send(res, 400, {error:"Потрібні streetId та номер будинку."});
        data = await yasno(`/addresses/v2/houses?regionId=${REGION}&dsoId=${DSO}&streetId=${queryParam(streetId)}&query=${queryParam(q)}`);
      } else if (url.pathname === "/api/group") {
        const streetId = url.searchParams.get("streetId");
        const houseId = url.searchParams.get("houseId");
        if (!streetId || !houseId) return send(res, 400, {error:"Потрібні streetId та houseId."});
        data = await yasno(`/addresses/v2/group?regionId=${REGION}&dsoId=${DSO}&streetId=${queryParam(streetId)}&houseId=${queryParam(houseId)}`);
      } else if (url.pathname === "/api/schedule") {
        data = await yasno(`/regions/${REGION}/dsos/${DSO}/planned-outages`);
      } else if (url.pathname === "/api/health") {
        data = {ok:true, service:"Merezhyvo KYIV API", region:REGION, operator:DSO};
      } else {
        return send(res, 404, {error:"API endpoint not found"});
      }
      return send(res, 200, data);
    } catch (e) {
      return send(res, 502, {error:"Не вдалося отримати актуальні дані від джерела.", detail:e.message});
    }
  }
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = new URL(`.${path}`, `file://${process.cwd()}/public/`);
  try {
    const fs = await import("node:fs/promises");
    const target = `${process.cwd()}/public/${path.replace(/^\/+/, "")}`;
    const body = await fs.readFile(target);
    const ext = target.split(".").pop();
    const types = {html:"text/html; charset=utf-8", css:"text/css", js:"text/javascript", json:"application/json", svg:"image/svg+xml", webmanifest:"application/manifest+json"};
    res.writeHead(200, {"content-type":types[ext] || "application/octet-stream"});
    res.end(body);
  } catch {
    send(res, 404, {error:"Not found"});
  }
});
server.listen(PORT, () => console.log(`Merezhyvo KYIV running on ${PORT}`));
