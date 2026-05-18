/**
 * Fetch wrapper for browser-initiated demo API calls. Cloudflare Access can
 * intercept expired sessions before the request reaches our Worker, returning a
 * redirect to the Access login flow. Manual redirects let the UI detect that
 * edge-auth state and reopen the login modal instead of treating the login page
 * as an agent stream.
 */
export function fetchDemoApi(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(input, {
    ...init,
    cache: init.cache ?? "no-store",
    credentials: init.credentials ?? "include",
    redirect: "manual",
  });
}

/** True when an API response should reopen the login modal on the client. */
export function responseNeedsAccess(response: Response): boolean {
  return (
    response.status === 401 ||
    response.status === 403 ||
    response.type === "opaqueredirect" ||
    response.headers.get("x-novamind-auth-required") === "1" ||
    isAccessRedirectUrl(response.url)
  );
}

function isAccessRedirectUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.hostname.endsWith(".cloudflareaccess.com") ||
      url.pathname.includes("/cdn-cgi/access/")
    );
  } catch {
    return false;
  }
}
