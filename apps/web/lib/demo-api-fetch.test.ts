import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDemoApi, responseNeedsAccess } from "./demo-api-fetch";

describe("demo API fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses manual redirects so Cloudflare Access redirects stay detectable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);

    await fetchDemoApi("/api/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stream",
      expect.objectContaining({
        cache: "no-store",
        credentials: "include",
        method: "POST",
        redirect: "manual",
      }),
    );
  });

  it("detects app and edge access failures", () => {
    expect(responseNeedsAccess(new Response(null, { status: 401 }))).toBe(true);
    expect(responseNeedsAccess(new Response(null, { status: 403 }))).toBe(true);
    expect(
      responseNeedsAccess(
        new Response(null, {
          headers: { "x-novamind-auth-required": "1" },
          status: 200,
        }),
      ),
    ).toBe(true);
    expect(
      responseNeedsAccess({
        headers: new Headers(),
        status: 0,
        type: "opaqueredirect",
        url: "",
      } as Response),
    ).toBe(true);
    expect(
      responseNeedsAccess({
        headers: new Headers(),
        status: 200,
        type: "default",
        url: "https://novamind.cloudflareaccess.com/cdn-cgi/access/login/example",
      } as Response),
    ).toBe(true);
    expect(responseNeedsAccess(new Response(null, { status: 200 }))).toBe(
      false,
    );
  });
});
