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

export function denApiOriginForWebOrigin(webOrigin: string): string | null {
  const configuredOrigin = process.env.DEN_API_BASE?.trim();
  if (configuredOrigin) {
    try {
      return new URL(configuredOrigin).origin;
    } catch {}
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

export function denApiEndpoint(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (typeof window === "undefined") {
    return path;
  }

  return denApiEndpointForWebOrigin(path, window.location.origin);
}
