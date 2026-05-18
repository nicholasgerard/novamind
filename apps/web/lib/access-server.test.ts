import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccessState, requireAccess } from "./access-server";

const originalDevAccessEmail = process.env.NOVAMIND_DEV_ACCESS_EMAIL;

afterEach(() => {
  vi.unstubAllEnvs();
  if (originalDevAccessEmail === undefined) {
    delete process.env.NOVAMIND_DEV_ACCESS_EMAIL;
  } else {
    process.env.NOVAMIND_DEV_ACCESS_EMAIL = originalDevAccessEmail;
  }
});

describe("web access state", () => {
  it("uses the configured Access domain for the local fallback identity", async () => {
    delete process.env.NOVAMIND_DEV_ACCESS_EMAIL;
    vi.stubEnv("NOVAMIND_ALLOW_LOCAL_AUTH", "1");
    vi.stubEnv("NOVAMIND_ACCESS_EMAIL_DOMAIN", "Example.ORG");

    const state = await getAccessState(
      new Request("https://web.example/api/demo"),
    );

    expect(state).toMatchObject({
      authenticated: true,
      authorized: true,
      email: "local@example.org",
      identity: { email: "local@example.org" },
    });
  });

  it("keeps an explicit local-development identity when provided", async () => {
    vi.stubEnv("NOVAMIND_ALLOW_LOCAL_AUTH", "true");
    vi.stubEnv("NOVAMIND_DEV_ACCESS_EMAIL", "presenter@example.org");

    const state = await getAccessState(
      new Request("https://web.example/api/demo"),
    );

    expect(state.email).toBe("presenter@example.org");
    expect(state.identity?.email).toBe("presenter@example.org");
  });

  it("rejects cross-origin mutations before applying local auth", async () => {
    vi.stubEnv("NOVAMIND_ALLOW_LOCAL_AUTH", "1");

    const result = await requireAccess(
      new Request("https://web.example/api/demo", {
        headers: { origin: "https://other.example" },
        method: "POST",
      }),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    await expect((result as Response).json()).resolves.toMatchObject({
      error: "FORBIDDEN_ORIGIN",
    });
  });
});
