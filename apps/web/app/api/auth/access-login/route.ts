import {
  accessCookieHeader,
  accessStatusCookieHeader,
  clearAccessCookieHeader,
  clearAccessStatusCookieHeader,
  getAccessState,
} from "@/lib/access-server";

export async function GET(req: Request): Promise<Response> {
  const access = await getAccessState(req).catch(() => null);
  const target = safeReturnTo(new URL(req.url).searchParams.get("returnTo"));
  const headers = new Headers({
    location: new URL(target, req.url).toString(),
  });

  if (access?.identity) {
    headers.append("set-cookie", accessCookieHeader(access.identity.email));
    headers.append("set-cookie", clearAccessStatusCookieHeader());
  } else {
    headers.append("set-cookie", clearAccessCookieHeader());
    headers.append(
      "set-cookie",
      access?.authenticated
        ? accessStatusCookieHeader()
        : clearAccessStatusCookieHeader(),
    );
  }

  return new Response(null, {
    status: 302,
    headers,
  });
}

export async function DELETE(): Promise<Response> {
  const headers = new Headers();
  headers.append("set-cookie", clearAccessCookieHeader());
  headers.append("set-cookie", clearAccessStatusCookieHeader());

  return new Response(null, {
    status: 204,
    headers,
  });
}

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes(":") || value.includes("\\")) return "/";
  if (hasNonPrintableAscii(value)) return "/";
  return value;
}

function hasNonPrintableAscii(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
