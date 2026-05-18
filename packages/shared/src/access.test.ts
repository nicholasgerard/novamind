import { afterEach, describe, expect, it } from "vitest";
import { configuredAccessEmailDomain, isAllowedAccessEmail } from "./access";

declare const process: { env: Record<string, string | undefined> };

const ORIGINAL_DOMAIN = process.env.NOVAMIND_ACCESS_EMAIL_DOMAIN;
const ORIGINAL_PUBLIC_DOMAIN =
  process.env.NEXT_PUBLIC_NOVAMIND_ACCESS_EMAIL_DOMAIN;

afterEach(() => {
  restoreEnv("NOVAMIND_ACCESS_EMAIL_DOMAIN", ORIGINAL_DOMAIN);
  restoreEnv(
    "NEXT_PUBLIC_NOVAMIND_ACCESS_EMAIL_DOMAIN",
    ORIGINAL_PUBLIC_DOMAIN,
  );
});

describe("access email domain helpers", () => {
  it("normalizes configured domains", () => {
    process.env.NOVAMIND_ACCESS_EMAIL_DOMAIN = " @Example.COM ";
    delete process.env.NEXT_PUBLIC_NOVAMIND_ACCESS_EMAIL_DOMAIN;

    expect(configuredAccessEmailDomain()).toBe("example.com");
  });

  it("allows only exact domain mailbox matches", () => {
    process.env.NOVAMIND_ACCESS_EMAIL_DOMAIN = "example.com";

    expect(isAllowedAccessEmail("USER@example.com")).toBe(true);
    expect(isAllowedAccessEmail("user@sub.example.com")).toBe(false);
    expect(isAllowedAccessEmail("user@example.com.evil")).toBe(false);
    expect(isAllowedAccessEmail(null)).toBe(false);
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
