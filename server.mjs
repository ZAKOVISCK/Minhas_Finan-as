import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createMarketService } from "./lib/market-server.mjs";
import { PUBLIC_FILES } from "./lib/public-files.mjs";
import { SECURITY_HEADERS } from "./lib/security.mjs";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const HTML = fileURLToPath(new URL("./lib/shell.html", import.meta.url));
const {version}=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8'));
let sourceCommit=process.env.APP_SOURCE_COMMIT;
if(!sourceCommit){try{sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{sourceCommit=null;}}
const release={version,commit:sourceCommit,repository:'https://github.com/ZAKOVISCK/Minhas_Finan-as'};

export function createAppServer({
  root = ROOT,
  marketService = createMarketService(),
} = {}) {
  return createServer(async (request, response) => {
    for(const [name,value]of Object.entries(SECURITY_HEADERS))response.setHeader(name,value);
    if(sourceCommit)response.setHeader("X-App-Source-Commit",sourceCommit);
    // O servidor local é HTTP. Forçar upgrade aqui impede módulos no WebKit;
    // a produção HTTPS (ou proxy HTTPS) mantém a política completa.
    if(!request.socket.encrypted && request.headers['x-forwarded-proto']!=='https')
      response.setHeader('Content-Security-Policy',SECURITY_HEADERS['Content-Security-Policy'].replace('; upgrade-insecure-requests',''));
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    const send = (status, text, type = "text/plain; charset=utf-8") => {
      response.writeHead(status, { "Content-Type": type });
      response.end(request.method === "HEAD" ? undefined : text);
    };
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      return send(405, "Método não permitido.");
    }
    let pathname, requestURL;
    try {
      requestURL = new URL(request.url, "http://localhost");
      pathname = decodeURIComponent(requestURL.pathname);
    } catch {
      return send(400, "Endereço inválido.");
    }
    if (pathname === "/version.json")return send(200,JSON.stringify(release),"application/json; charset=utf-8");
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      const json = (status, body) =>
        send(status, JSON.stringify(body), "application/json; charset=utf-8");
      if (pathname === "/api/health") return json(200, { ok: true });
      if (pathname !== "/api/data")
        return json(404, { error: "Endpoint não encontrado." });
      if (
        requestURL.searchParams.getAll("feed").length !== 1 ||
        [...requestURL.searchParams.keys()].some((key) => key !== "feed")
      )
        return json(400, { error: "Informe somente um parâmetro feed." });
      // No CORS permission is granted. Reject explicitly cross-site browser requests too.
      let sameOrigin = true;
      try {
        if (request.headers.origin)
          sameOrigin =
            new URL(request.headers.origin).host === request.headers.host;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin || request.headers["sec-fetch-site"] === "cross-site")
        return json(403, {
          error: "Consulta permitida somente pela mesma origem.",
        });
      try {
        const result = await marketService.getFeed(
          requestURL.searchParams.get("feed"),
        );
        if (result.retryAfter)
          response.setHeader("Retry-After", String(result.retryAfter));
        return json(result.status, result.body);
      } catch {
        return json(503, { error: "Fonte pública indisponível no momento." });
      }
    }
    const filename = pathname === "/" ? "index.html" : pathname.slice(1);
    // Serve only the public application: never expose .git, backups, or local configuration.
    if (!Object.hasOwn(PUBLIC_FILES,filename))
      return send(404, "Arquivo não encontrado.");
    try {
      const body = await readFile(filename === "index.html" && root === ROOT ? HTML : resolve(root, filename));
      const etag = '"' + createHash("sha256").update(body).digest("hex") + '"';
      response.setHeader("ETag", etag);
      if (filename === "sw.js")
        response.setHeader("Service-Worker-Allowed", "/");
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304);
        return response.end();
      }
      return send(
        200,
        body,
        PUBLIC_FILES[filename],
      );
    } catch (error) {
      return send(
        error.code === "ENOENT" ? 404 : 500,
        error.code === "ENOENT"
          ? "Arquivo não encontrado."
          : "Não foi possível ler o arquivo.",
      );
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT precisa ser um número entre 1 e 65535.");
  const server = createAppServer();
  server.on("error", (error) => {
    console.error("Servidor não iniciado:", error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () =>
    console.log(`Minhas finanças: http://${host}:${port}`),
  );
}
