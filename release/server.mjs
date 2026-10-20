import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createMarketService } from "./market-server.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_FILES = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "finance.mjs",
  "legacy-finance.mjs",
  "storage.mjs",
  "crypto.mjs",
  "views.mjs",
  "imports.mjs",
  "market.mjs",
  "form-utils.mjs",
  "sw.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
]);
const TYPES = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
};

export function createAppServer({
  root = ROOT,
  marketService = createMarketService(),
} = {}) {
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Cache-Control", "no-cache");
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
    if (!PUBLIC_FILES.has(filename))
      return send(404, "Arquivo não encontrado.");
    try {
      const body = await readFile(resolve(root, filename));
      const etag = '"' + createHash("sha256").update(body).digest("hex") + '"';
      response.setHeader("ETag", etag);
      if (filename === "sw.js")
        response.setHeader("Service-Worker-Allowed", "/");
      if (filename === "index.html") {
        response.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        );
      }
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304);
        return response.end();
      }
      return send(
        200,
        body,
        TYPES[filename.split(".").pop()] || "application/octet-stream",
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
