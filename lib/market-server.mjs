/** Public reference data only. Financial records never enter this module. */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TTL = {
  macro: 2 * HOUR,
  brazil: HOUR,
  global: HOUR,
  samples: 5 * MINUTE,
};
const SOURCES = {
  brazil:
    "https://servicodados.ibge.gov.br/api/v3/noticias/?qtd=10&tipo=noticia",
  global: "https://www.federalreserve.gov/feeds/press_monetary.xml",
  samples: "https://brapi.dev/api/quote/PETR4,VALE3",
};
const ALLOWED_HOSTS = new Set([
  "api.bcb.gov.br",
  "olinda.bcb.gov.br",
  "servicodados.ibge.gov.br",
  "www.federalreserve.gov",
  "brapi.dev",
]);
const MAX_BODY = 1024 * 1024;
const text = (value, max = 500) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => structuredClone(value);

class SourceError extends Error {
  constructor(message, retryMs = 5 * MINUTE) {
    super(message);
    this.retryMs = retryMs;
  }
}

function isoDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T12:00:00Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
}
function brDay(value) {
  if (typeof value !== "string" || !/^\d{2}\/\d{2}\/\d{4}$/.test(value))
    return null;
  const [day, month, year] = value.split("/");
  return isoDay(`${year}-${month}-${day}`);
}
function officialURL(value, domain, upgradeHTTP = false) {
  try {
    const url = new URL(value);
    if (upgradeHTTP && url.protocol === "http:" && !url.port)
      url.protocol = "https:";
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return null;
    return url.hostname === domain || url.hostname.endsWith("." + domain)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function decimal(value) {
  if (typeof value === "string" && /^-?\d+(?:[.,]\d+)?$/.test(value.trim()))
    value = Number(value.replace(",", "."));
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function timeoutError() {
  return new SourceError("A fonte excedeu o tempo de resposta.");
}
function brazilDate(now) {
  return new Date(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(now)) + "T12:00:00Z",
  );
}
function sgsURL(code, now) {
  let end = brazilDate(now),
    start;
  if (code === 433) {
    end = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0, 12));
    start = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 12, 1, 12),
    );
  } else start = new Date(end.getTime() - 30 * DAY);
  const format = (date) =>
    `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
  const url = new URL(
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados`,
  );
  url.searchParams.set("formato", "json");
  url.searchParams.set("dataInicial", format(start));
  url.searchParams.set("dataFinal", format(end));
  return url.href.replace(/\+/g, "%20");
}

async function source(url, kind, fetchImpl, now, timeoutMs) {
  const target = new URL(url);
  // No URL, symbol, hostname, or credentials from the API request reach fetch.
  if (
    target.protocol !== "https:" ||
    !ALLOWED_HOSTS.has(target.hostname) ||
    target.username ||
    target.password ||
    target.port
  )
    throw new SourceError("Destino de fonte inválido.");
  const controller = new AbortController();
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timeoutError());
    }, timeoutMs);
  });
  const read = async () => {
    const response = await fetchImpl(target.href, {
      signal: controller.signal,
      redirect: "error",
      headers: {
        Accept:
          kind === "json"
            ? "application/json"
            : "application/rss+xml, application/xml, text/xml",
        "User-Agent": "MinhasFinancas/1.1 (public reference data)",
      },
    });
    if (!response.ok) {
      let retryMs = response.status === 429 ? HOUR : 5 * MINUTE;
      const retryAfter = response.headers.get("retry-after");
      if (response.status === 429 && retryAfter) {
        const delay = /^\d+$/.test(retryAfter.trim())
          ? Number(retryAfter) * 1000
          : Date.parse(retryAfter) - now();
        if (Number.isFinite(delay) && delay > 0)
          retryMs = Math.min(Math.max(delay, MINUTE), DAY);
      }
      await response.body?.cancel();
      throw new SourceError(
        response.status === 429
          ? "A fonte atingiu o limite de consultas."
          : `A fonte retornou HTTP ${response.status}.`,
        retryMs,
      );
    }
    const contentType = (response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (
      kind === "json"
        ? !["application/json", "text/json"].includes(contentType)
        : !["application/rss+xml", "application/xml", "text/xml"].includes(
            contentType,
          )
    ) {
      await response.body?.cancel();
      throw new SourceError("A fonte respondeu com um formato inesperado.");
    }
    const length = response.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) {
      await response.body?.cancel();
      throw new SourceError("Resposta da fonte acima do limite.");
    }
    if (!response.body)
      throw new SourceError("A fonte respondeu sem conteúdo.");
    const reader = response.body.getReader();
    const cancel = () => {
      reader.cancel().catch(() => {});
    };
    controller.signal.addEventListener("abort", cancel, { once: true });
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        if (controller.signal.aborted) throw timeoutError();
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > MAX_BODY) {
          await reader.cancel();
          throw new SourceError("Resposta da fonte acima do limite.");
        }
        chunks.push(item.value);
      }
    } finally {
      controller.signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
    if (controller.signal.aborted) throw timeoutError();
    const raw = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      raw.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let decoded;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      throw new SourceError("A fonte respondeu com codificação inválida.");
    }
    if (kind === "xml") return decoded;
    try {
      return JSON.parse(decoded);
    } catch {
      throw new SourceError("A fonte respondeu com JSON inválido.");
    }
  };
  try {
    return await Promise.race([read(), timedOut]);
  } catch (error) {
    throw error instanceof SourceError
      ? error
      : new SourceError("Não foi possível consultar a fonte pública.");
  } finally {
    clearTimeout(timer);
  }
}

function series(data, now, maxRows) {
  if (!Array.isArray(data) || !data.length || data.length > maxRows)
    throw new SourceError("Série do BCB inválida.");
  const day = new Date(now()).toISOString().slice(0, 10),
    rows = new Map();
  for (const row of data) {
    const date = brDay(row?.data),
      value = decimal(row?.valor);
    if (
      !date ||
      date > day ||
      value === null ||
      Math.abs(value) > 1000 ||
      rows.has(date)
    )
      throw new SourceError("Observação do BCB inválida.");
    rows.set(date, { date, value });
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function selicItems(data, now) {
  const row = series(data, now, 40).at(-1);
  if (row.value < 0) throw new SourceError("Selic inválida.");
  if (now() - Date.parse(row.date + "T12:00:00Z") > 30 * DAY)
    throw new SourceError("A última observação da Selic está desatualizada.");
  return [
    {
      id: "selic",
      name: "Selic meta",
      value: row.value,
      unit: "% a.a.",
      reference: row.date,
      source: "BCB · SGS 432",
      url: "https://www.bcb.gov.br/controleinflacao/taxaselic",
    },
  ];
}
function ipcaItems(data, now) {
  const rows = series(data, now, 20);
  if (rows.some((row) => row.value <= -100))
    throw new SourceError("Variação do IPCA inválida.");
  const last = rows.at(-1);
  if (now() - Date.parse(last.date + "T12:00:00Z") > 100 * DAY)
    throw new SourceError("A última observação do IPCA está desatualizada.");
  const items = [
    {
      id: "ipca",
      name: "IPCA mensal",
      value: last.value,
      unit: "% no mês",
      reference: last.date.slice(0, 7),
      source: "IBGE via BCB · SGS 433",
      url: "https://www.ibge.gov.br/explica/inflacao.php",
    },
  ];
  const year = rows.slice(-12);
  if (
    year.length !== 12 ||
    year.some(
      (row, index) =>
        index &&
        Number(row.date.slice(0, 4)) * 12 + Number(row.date.slice(5, 7)) !==
          Number(year[index - 1].date.slice(0, 4)) * 12 +
            Number(year[index - 1].date.slice(5, 7)) +
            1,
    )
  )
    return {
      items,
      errors: [
        "IPCA em 12 meses indisponível: a série não contém 12 meses consecutivos.",
      ],
    };
  items.push({
    id: "ipca12",
    name: "IPCA em 12 meses",
    value:
      (year.reduce((total, row) => total * (1 + row.value / 100), 1) - 1) * 100,
    unit: "% em 12 meses",
    reference: last.date.slice(0, 7),
    source: "Cálculo composto · 12 variações SGS 433",
    url: "https://www.ibge.gov.br/explica/inflacao.php",
  });
  return { items, errors: [] };
}
function ptaxURL(now) {
  const format = (date) =>
    `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}-${date.getUTCFullYear()}`;
  const end = new Date(now()),
    start = new Date(now() - 10 * DAY);
  const url = new URL(
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)",
  );
  url.searchParams.set("@dataInicial", `'${format(start)}'`);
  url.searchParams.set("@dataFinalCotacao", `'${format(end)}'`);
  url.searchParams.set("$format", "json");
  url.searchParams.set("$top", "10");
  url.searchParams.set("$orderby", "dataHoraCotacao desc");
  // Olinda treats '+' literally in OData options rather than as a form space.
  return url.href.replace(/\+/g, "%20");
}
function ptaxItems(data, now) {
  if (
    !object(data) ||
    !Array.isArray(data.value) ||
    !data.value.length ||
    data.value.length > 100
  )
    throw new SourceError("Cotação PTAX inválida.");
  const rows = data.value
    .map((row) => {
      const reference = text(row?.dataHoraCotacao, 40),
        value = decimal(row?.cotacaoVenda);
      if (
        !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(reference) ||
        !isoDay(reference.slice(0, 10)) ||
        !Number.isFinite(
          Date.parse(reference.replace(" ", "T").slice(0, 23) + "-03:00"),
        ) ||
        Date.parse(reference.replace(" ", "T").slice(0, 23) + "-03:00") >
          now() + 5 * MINUTE ||
        value === null ||
        value <= 0 ||
        value > 1_000_000
      )
        throw new SourceError("Observação PTAX inválida.");
      return { reference, value };
    })
    .sort((a, b) => b.reference.localeCompare(a.reference));
  if (
    now() - Date.parse(rows[0].reference.slice(0, 10) + "T12:00:00Z") >
    10 * DAY
  )
    throw new SourceError("A última cotação PTAX está desatualizada.");
  return [
    {
      id: "ptax",
      name: "Dólar PTAX venda",
      value: rows[0].value,
      unit: "R$/US$",
      reference: rows[0].reference,
      source: "BCB · PTAX de fechamento",
      url: "https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes",
      note: "Referência diária; não é dólar em tempo real.",
    },
  ];
}
function brazilItems(data, now) {
  if (!object(data) || !Array.isArray(data.items))
    throw new SourceError("Resposta de notícias do IBGE inválida.");
  const seen = new Set(),
    items = [];
  for (const row of data.items.slice(0, 100)) {
    const title = text(row?.titulo),
      url = officialURL(row?.link, "ibge.gov.br", true),
      rawDate = text(row?.data_publicacao, 40);
    const match = rawDate.match(/^(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}:\d{2})$/),
      date = match && brDay(match[1]);
    const published = date && `${date}T${match[2]}-03:00`;
    if (
      !title ||
      !url ||
      !published ||
      !Number.isFinite(Date.parse(published)) ||
      Date.parse(published) > now() + 5 * MINUTE ||
      seen.has(url)
    )
      continue;
    seen.add(url);
    items.push({
      title,
      url,
      publishedAt: new Date(published).toISOString(),
      source: "Agência IBGE Notícias",
      language: "pt-BR",
      kind: "Publicação oficial",
    });
  }
  if (!items.length)
    throw new SourceError("O IBGE não retornou notícias válidas.");
  return items
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 10);
}
function xmlText(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
      const named = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const code =
        entity[2].toLowerCase() === "x"
          ? parseInt(entity.slice(3, -1), 16)
          : Number(entity.slice(2, -1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "";
    })
    .trim();
}
function globalItems(data, now) {
  if (
    typeof data !== "string" ||
    /<!DOCTYPE|<!ENTITY/i.test(data) ||
    !/<rss\b/i.test(data)
  )
    throw new SourceError("RSS do Federal Reserve inválido.");
  const field = (raw, tag) =>
    xmlText(
      raw.match(
        new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"),
      )?.[1] || "",
    );
  const items = [],
    seen = new Set();
  for (const match of data.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = text(field(match[1], "title")),
      url = officialURL(field(match[1], "link"), "federalreserve.gov"),
      date = Date.parse(field(match[1], "pubDate"));
    if (
      !title ||
      !url ||
      !Number.isFinite(date) ||
      date > now() + 5 * MINUTE ||
      seen.has(url)
    )
      continue;
    seen.add(url);
    items.push({
      title,
      url,
      publishedAt: new Date(date).toISOString(),
      source: "Federal Reserve",
      language: "en",
      kind: "Comunicado oficial",
    });
    if (items.length >= 20) break;
  }
  if (!items.length)
    throw new SourceError(
      "O Federal Reserve não retornou comunicados válidos.",
    );
  return items
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 10);
}
function sampleItems(data, now) {
  if (!object(data) || !Array.isArray(data.results))
    throw new SourceError("Resposta das amostras de ações inválida.");
  const seen = new Set(),
    items = [];
  for (const row of data.results.slice(0, 20)) {
    const price = decimal(row?.regularMarketPrice),
      change =
        row?.regularMarketChangePercent == null
          ? null
          : decimal(row.regularMarketChangePercent),
      timestamp = Date.parse(row?.regularMarketTime);
    if (
      !["PETR4", "VALE3"].includes(row?.symbol) ||
      seen.has(row.symbol) ||
      price === null ||
      price <= 0 ||
      !Number.isSafeInteger(Math.round(price * 100)) ||
      !Number.isFinite(timestamp) ||
      timestamp > now() + 5 * MINUTE ||
      (change === null && row.regularMarketChangePercent != null)
    )
      continue;
    seen.add(row.symbol);
    items.push({
      symbol: row.symbol,
      price,
      change,
      reference: new Date(timestamp).toISOString(),
    });
  }
  if (!items.length)
    throw new SourceError("A fonte não retornou amostras válidas.");
  return items;
}

/** Bounded, shared cache. Four feed names are the entire public API surface. */
export function createMarketService({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = 12_000,
} = {}) {
  if (
    typeof fetchImpl !== "function" ||
    typeof now !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000
  )
    throw new TypeError("Configuração de fontes inválida.");
  const cache = new Map(),
    inFlight = new Map(),
    failures = new Map();
  const load = async (feed) => {
    const get = (url, kind = "json") =>
      source(url, kind, fetchImpl, now, timeoutMs);
    let items,
      errors = [],
      retryMs = 5 * MINUTE;
    if (feed === "macro") {
      const labels = ["Selic", "IPCA", "PTAX"];
      const parts = await Promise.allSettled([
        get(sgsURL(432, now())).then((data) => ({
          items: selicItems(data, now),
          errors: [],
        })),
        get(sgsURL(433, now())).then((data) => ipcaItems(data, now)),
        get(ptaxURL(now)).then((data) => ({
          items: ptaxItems(data, now),
          errors: [],
        })),
      ]);
      items = [];
      for (const [index, part] of parts.entries()) {
        if (part.status === "fulfilled") {
          items.push(...part.value.items);
          errors.push(...part.value.errors);
        } else {
          errors.push(`${labels[index]}: ${part.reason.message}`);
          retryMs = Math.max(retryMs, part.reason.retryMs || 0);
        }
      }
      if (!items.length) throw new SourceError(errors.join(" · "), retryMs);
    } else if (feed === "brazil")
      items = brazilItems(await get(SOURCES.brazil), now);
    else if (feed === "global")
      items = globalItems(await get(SOURCES.global, "xml"), now);
    else items = sampleItems(await get(SOURCES.samples), now);
    const timestamp = now(),
      ttl = errors.length ? Math.min(TTL[feed], retryMs) : TTL[feed];
    const data = {
      items,
      errors,
      fetchedAt: new Date(timestamp).toISOString(),
      expiresAt: new Date(timestamp + ttl).toISOString(),
      source: {
        macro: "BCB e IBGE",
        brazil: "IBGE",
        global: "Federal Reserve",
        samples: "brapi · amostras gratuitas",
      }[feed],
      sourceUrl: {
        macro: "https://dadosabertos.bcb.gov.br/",
        brazil: "https://servicodados.ibge.gov.br/api/docs/noticias?versao=3",
        global: "https://www.federalreserve.gov/feeds/feeds.htm",
        samples: "https://brapi.dev/",
      }[feed],
    };
    cache.set(feed, data);
    failures.delete(feed);
    return { status: 200, body: clone(data) };
  };
  const afterFailure = (feed, failure) => {
    const old = cache.get(feed),
      remaining = Math.max(1, Math.ceil((failure.retryAt - now()) / 1000));
    if (old && now() - Date.parse(old.fetchedAt) <= DAY) {
      return {
        status: 200,
        retryAfter: remaining,
        body: {
          ...clone(old),
          expiresAt: new Date(
            Math.min(Date.parse(old.expiresAt), now() - 1),
          ).toISOString(),
          errors: [
            ...new Set([
              ...old.errors,
              failure.message,
              "Exibindo a última consulta válida; os dados estão desatualizados.",
            ]),
          ],
        },
      };
    }
    return {
      status: 503,
      retryAfter: remaining,
      body: { error: failure.message },
    };
  };
  return {
    async getFeed(feed) {
      if (!Object.hasOwn(TTL, feed))
        return {
          status: 400,
          body: {
            error: "Fonte inválida. Use macro, brazil, global ou samples.",
          },
        };
      const old = cache.get(feed);
      if (old && Date.parse(old.expiresAt) > now())
        return { status: 200, body: clone(old) };
      const failure = failures.get(feed);
      if (failure?.retryAt > now()) return afterFailure(feed, failure);
      if (!inFlight.has(feed)) {
        const pending = load(feed)
          .catch((error) => {
            const safe =
              error instanceof SourceError
                ? error
                : new SourceError("Fonte pública indisponível no momento.");
            const record = {
              message: safe.message.slice(0, 900),
              retryAt: now() + safe.retryMs,
            };
            failures.set(feed, record);
            return afterFailure(feed, record);
          })
          .finally(() => inFlight.delete(feed));
        inFlight.set(feed, pending);
      }
      return clone(await inFlight.get(feed));
    },
  };
}
