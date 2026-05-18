declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

export const DEFAULT_ACCESS_EMAIL_DOMAIN = "thebkapp.co";
export const ACCESS_EMAIL_DOMAIN = configuredAccessEmailDomain();
export const ACCESS_EMAIL_COOKIE = "novamind_access_email";
export const ACCESS_STATUS_COOKIE = "novamind_access_status";
export const ACCESS_UNAUTHORIZED_STATUS = "unauthorized";
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8;

export function isAllowedAccessEmail(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return email
    .trim()
    .toLowerCase()
    .endsWith(`@${configuredAccessEmailDomain()}`);
}

export function configuredAccessEmailDomain(): string {
  const env = typeof process !== "undefined" && process?.env ? process.env : {};
  return (
    env.NOVAMIND_ACCESS_EMAIL_DOMAIN ??
    env.NEXT_PUBLIC_NOVAMIND_ACCESS_EMAIL_DOMAIN ??
    DEFAULT_ACCESS_EMAIL_DOMAIN
  )
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}
