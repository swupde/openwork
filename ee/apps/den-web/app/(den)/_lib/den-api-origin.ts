let denApiBaseUrlOverride: string | null = null;

function normalizeBaseUrl(input: string | null | undefined): string | null {
  const trimmed = input?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname === "/" ? "" : pathname}`;
  } catch {
    return null;
  }
}

export function setDenApiBaseUrlOverride(input: string | null | undefined) {
  denApiBaseUrlOverride = normalizeBaseUrl(input);
}

// Browser-facing API origin. DEN_API_PUBLIC_URL is the origin the browser can
// reach (runtime-config hands it to clients); DEN_API_BASE is the server-side
// upstream, which in containers is an in-network URL the browser cannot reach.
// Prefer the public one and keep DEN_API_BASE as the documented fallback.
// Mirrored in next-config-den-api-redirects.cjs (keep in sync).
function configuredDenApiOrigin(): string | null {
  for (const value of [process.env.DEN_API_PUBLIC_URL, process.env.DEN_API_BASE]) {
    const configuredOrigin = value?.trim();
    if (!configuredOrigin) continue;
    try {
      const url = new URL(configuredOrigin);
      // Scheme-less values like `localhost:18788` parse with a `localhost:`
      // scheme and an opaque "null" origin; skip them like the build-time rule.
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {}
  }
  return null;
}

export function denApiOriginForWebOrigin(webOrigin: string): string | null {
  const configuredOrigin = configuredDenApiOrigin();
  if (configuredOrigin) {
    return configuredOrigin;
  }

  let url: URL;
  try {
    url = new URL(webOrigin);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const apiHostname = hostname === "api" || hostname.startsWith("api.")
    ? hostname
    : `api.${hostname}`;

  url.hostname = apiHostname;
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function currentDenApiBaseUrlForWebOrigin(webOrigin: string): string | null {
  return denApiBaseUrlOverride ?? denApiOriginForWebOrigin(webOrigin);
}

export function currentDenApiBaseUrl(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return currentDenApiBaseUrlForWebOrigin(window.location.origin);
}

export function denApiEndpointForWebOrigin(path: string, webOrigin: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const baseUrl = currentDenApiBaseUrlForWebOrigin(webOrigin);
  if (!baseUrl) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

const PUBLIC_DEN_API_PATH_PREFIXES = ["/v1/orgs/sso/resolve"];

function isPublicDenApiPath(path: string): boolean {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return PUBLIC_DEN_API_PATH_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));
}

export function denApiCredentialsForEndpoint(endpoint: string, webOrigin: string, path = endpoint): RequestCredentials {
  try {
    const endpointOrigin = new URL(endpoint).origin;
    const currentOrigin = new URL(webOrigin).origin;
    const apiBaseUrl = currentDenApiBaseUrlForWebOrigin(webOrigin);
    const apiOrigin = apiBaseUrl ? new URL(apiBaseUrl).origin : null;
    if (endpointOrigin === apiOrigin && isPublicDenApiPath(path)) {
      return "omit";
    }
    return endpointOrigin === currentOrigin || endpointOrigin === apiOrigin ? "include" : "omit";
  } catch {
    return "include";
  }
}

export function denApiCredentials(endpoint: string, path = endpoint): RequestCredentials {
  if (typeof window === "undefined") {
    return "include";
  }

  return denApiCredentialsForEndpoint(endpoint, window.location.origin, path);
}

// Browser sessions belong to the web host, which need not be a parent of the
// public API host. Keep cookie-authenticated JSON requests on that origin;
// canonical API URLs remain available through denApiEndpoint for other clients.
export function denBrowserEndpoint(path: string): string {
  if (typeof window !== "undefined") {
    if (path.startsWith("/api/auth/")) return path;
    if (path.startsWith("/v1/") && !isPublicDenApiPath(path)) return `/api/browser${path}`;
  }
  return denApiEndpoint(path);
}

export function denApiEndpoint(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (typeof window === "undefined") {
    return path;
  }

  return denApiEndpointForWebOrigin(path, window.location.origin);
}
