export const marketState = {
  macro: null,
  brazil: null,
  global: null,
  samples: null,
  errors: {},
  loading: false,
};
const prefix = "mf-public-v1:";
const feeds = ["macro", "brazil", "global", "samples"];
const maxItems = 20;
const maxCacheAge = 24 * 60 * 60 * 1000;
const retry = {};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, limit = 300) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";
const timestamp = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
function publicURL(value, domains) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return "";
    if (
      domains &&
      !domains.some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith("." + domain),
      )
    )
      return "";
    return url.href;
  } catch {
    return "";
  }
}
function itemFor(feed, value, fromCache) {
  if (!object(value)) return null;
  let result;
  if (feed === "macro") {
    if (
      !text(value.id, 60) ||
      !text(value.name, 100) ||
      !Number.isFinite(value.value) ||
      Math.abs(value.value) > 1e9 ||
      !text(value.unit, 40) ||
      !text(value.source, 160)
    )
      return null;
    result = {
      id: text(value.id, 60),
      name: text(value.name, 100),
      value: value.value,
      unit: text(value.unit, 40),
      reference: text(value.reference, 100),
      source: text(value.source, 160),
    };
    if (value.url) {
      result.url = publicURL(value.url, ["bcb.gov.br", "ibge.gov.br"]);
      if (!result.url) return null;
    }
    if (text(value.note)) result.note = text(value.note);
  } else if (feed === "samples") {
    if (
      !text(value.symbol, 30) ||
      !Number.isFinite(value.price) ||
      value.price <= 0 ||
      !Number.isSafeInteger(Math.round(value.price * 100)) ||
      (value.change != null && !Number.isFinite(value.change))
    )
      return null;
    result = {
      symbol: text(value.symbol, 30),
      price: value.price,
      change: value.change ?? null,
      reference: text(value.reference, 100),
    };
  } else {
    const url = publicURL(
      value.url,
      feed === "brazil" ? ["ibge.gov.br"] : ["federalreserve.gov"],
    );
    if (!text(value.title, 500) || !text(value.source, 160) || !url)
      return null;
    result = {
      title: text(value.title, 500),
      source: text(value.source, 160),
      url,
      publishedAt: text(value.publishedAt, 100),
      language: value.language === "en" ? "en" : "pt-BR",
      kind: text(value.kind, 100) || "Publicação oficial",
    };
  }
  if (fromCache && value._stale === true) {
    result._stale = true;
    if (timestamp(value._fetchedAt)) result._fetchedAt = value._fetchedAt;
  }
  return result;
}
function validFeed(data, feed, now, fromCache = false) {
  if (
    !object(data) ||
    !Array.isArray(data.items) ||
    !timestamp(data.fetchedAt) ||
    !timestamp(data.expiresAt)
  )
    throw new Error("Resposta inválida da fonte pública.");
  const fetched = Date.parse(data.fetchedAt),
    expires = Date.parse(data.expiresAt);
  if (fetched > now + 5 * 60 * 1000 || expires < fetched)
    throw new Error("Datas inválidas na resposta da fonte pública.");
  const items = data.items
    .slice(0, maxItems)
    .map((item) => itemFor(feed, item, fromCache))
    .filter(Boolean);
  const errors = Array.isArray(data.errors)
    ? data.errors
        .map((value) => text(value))
        .filter(Boolean)
        .slice(0, 20)
    : [];
  if (items.length < Math.min(data.items.length, maxItems))
    errors.push("Alguns registros inválidos da fonte foram descartados.");
  if (!items.length)
    throw new Error(
      errors.join(" · ") || "Fonte sem informações válidas no momento.",
    );
  return {
    items,
    errors,
    fetchedAt: new Date(fetched).toISOString(),
    expiresAt: new Date(Math.min(expires, fetched + maxCacheAge)).toISOString(),
    source: text(data.source, 160),
    sourceUrl: publicURL(data.sourceUrl),
  };
}
export function restorePublicCache() {
  for (const feed of feeds) {
    try {
      const raw = localStorage.getItem(prefix + feed);
      if (!raw) continue;
      if (raw.length > 256 * 1024)
        throw new Error("Cache público acima do limite.");
      const data = validFeed(JSON.parse(raw), feed, Date.now(), true);
      marketState[feed] = data;
      if (data.errors.length)
        marketState.errors[feed] = data.errors.join(" · ");
    } catch {
      // Cache é descartável: nunca usar timestamps/URLs/números não validados.
      marketState[feed] = null;
      try {
        localStorage.removeItem(prefix + feed);
      } catch {
        /* armazenamento opcional */
      }
    }
  }
}
export function stale(data) {
  if (!timestamp(data?.fetchedAt) || !timestamp(data?.expiresAt)) return true;
  const fetched = Date.parse(data.fetchedAt),
    expires = Date.parse(data.expiresAt),
    now = Date.now();
  return (
    fetched > now + 5 * 60 * 1000 ||
    expires < fetched ||
    Math.min(expires, fetched + maxCacheAge) <= now
  );
}
function retryTime(response, now) {
  const header = response.headers?.get?.("Retry-After");
  if (response.status === 429 && header) {
    const delay = /^\d+$/.test(header.trim())
      ? Number(header) * 1000
      : Date.parse(header) - now;
    if (Number.isFinite(delay) && delay > 0)
      return now + Math.min(delay, maxCacheAge);
  }
  return now + (response.status === 429 ? 60 * 60 * 1000 : 5 * 60 * 1000);
}
async function updateFeed(feed, onChange) {
  if (!stale(marketState[feed]) || retry[feed] > Date.now()) return;
  try {
    const response = await fetch("/api/data?feed=" + feed, {
      signal: AbortSignal.timeout(feed === "samples" ? 45000 : 18000),
    });
    let raw;
    try {
      raw = await response.json();
    } catch {
      throw new Error(
        response.ok
          ? "Resposta inválida da fonte pública."
          : `Fonte indisponível (HTTP ${response.status}).`,
      );
    }
    if (!response.ok) {
      retry[feed] = retryTime(response, Date.now());
      throw new Error(
        text(raw?.error) || `Fonte indisponível (HTTP ${response.status}).`,
      );
    }
    const data = validFeed(raw, feed, Date.now());
    const previous = marketState[feed];
    if (feed === "macro" && data.errors.length && previous?.items) {
      const present = new Set(data.items.map((item) => item.id));
      data.items.push(
        ...previous.items
          .filter((item) => !present.has(item.id))
          .map((item) => ({
            ...item,
            _stale: true,
            _fetchedAt: item._fetchedAt || previous.fetchedAt,
          })),
      );
      data.items = data.items.slice(0, maxItems);
    }
    marketState[feed] = data;
    if (data.errors.length) marketState.errors[feed] = data.errors.join(" · ");
    else delete marketState.errors[feed];
    delete retry[feed];
    try {
      localStorage.setItem(prefix + feed, JSON.stringify(data));
    } catch {
      /* dados públicos permanecem em memória */
    }
  } catch (error) {
    if (!retry[feed] || retry[feed] <= Date.now())
      retry[feed] = Date.now() + 5 * 60 * 1000;
    marketState.errors[feed] =
      error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "A fonte demorou para responder. Tente novamente mais tarde."
        : error instanceof TypeError
          ? "Não foi possível acessar a fonte pública. Confira a conexão."
          : text(error?.message) || "Fonte pública indisponível.";
    if (marketState[feed])
      marketState[feed] = {
        ...marketState[feed],
        expiresAt: new Date(Date.now() - 1).toISOString(),
      };
  }
  onChange();
}
export async function updateMarket(
  onChange = () => {},
  includeSamples = false,
) {
  if (marketState.loading) return;
  marketState.loading = true;
  try {
    onChange();
    await Promise.all(
      ["macro", "brazil", "global", ...(includeSamples ? ["samples"] : [])].map(
        (feed) => updateFeed(feed, onChange),
      ),
    );
  } finally {
    marketState.loading = false;
    onChange();
  }
}
