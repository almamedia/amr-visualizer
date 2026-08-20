const MAX_SOURCE_BYTES = 6 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon",
};

export async function fetchWithTimeout(
  url: string,
  ms = FETCH_TIMEOUT_MS,
  init?: RequestInit
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 AMR-Aineistostudio/0.1",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Lataa kuva ja palauta data-URI:na. Palauttaa null jos lataus epäonnistuu,
 * kuva on liian iso tai se ei ole kuva. Kutsuja jatkaa ilman kuvaa.
 */
export async function toDataUri(url: string): Promise<string | null> {
  // Käyttäjän koneelta ladattu kuva on jo data-URI. Sitä ei haeta verkosta
  // eikä sen polusta yritetä päätellä tiedostotyyppiä.
  if (url.startsWith("data:image/")) return url;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;

    const declared = res.headers.get("content-type")?.split(";")[0]?.trim();
    const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
    const mime =
      declared && declared.startsWith("image/")
        ? declared
        : MIME_BY_EXT[ext] ?? null;
    if (!mime) return null;

    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_SOURCE_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_SOURCE_BYTES) return null;

    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Lataa useita kuvia rinnakkain; epäonnistuneet pudotetaan pois. */
export async function toDataUris(
  urls: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const results = await Promise.all(
    urls.map(async (u) => [u, await toDataUri(u)] as const)
  );
  for (const [u, d] of results) if (d) out.set(u, d);
  return out;
}
