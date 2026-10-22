export const THEME_KEY = "mf-theme";
const normalize = (value) => value === "dark" ? "dark" : "light";

export function readTheme(storage) {
  try { return normalize((storage || globalThis.localStorage)?.getItem(THEME_KEY)); }
  catch { return "light"; }
}

export function applyTheme(value, document = globalThis.document) {
  const theme = normalize(value);
  if (!document?.documentElement) return theme;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content", theme === "dark" ? "#0d171f" : "#087c66",
  );
  for (const select of document.querySelectorAll("[data-theme-selector]")) select.value = theme;
  return theme;
}

export function saveTheme(value, storage) {
  const theme = applyTheme(value);
  try { (storage || globalThis.localStorage)?.setItem(THEME_KEY, theme); return true; }
  catch { return false; }
}

if (globalThis.document) {
  applyTheme(readTheme());
  document.addEventListener("change", (event) => {
    if (event.target.matches?.("[data-theme-selector]")) {
      const saved = saveTheme(event.target.value);
      for (const status of document.querySelectorAll("[data-theme-status]")) status.textContent = saved
        ? "Preferência de tema salva neste navegador."
        : "Tema aplicado nesta sessão. O navegador não permitiu salvar a preferência.";
    }
  });
  globalThis.addEventListener?.("storage", (event) => {
    if (event.key === THEME_KEY || event.key === null) applyTheme(readTheme());
  });
}
