"use client";

import { LogIn, LogOut, ShieldCheck } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ACCESS_EMAIL_COOKIE,
  ACCESS_STATUS_COOKIE,
  ACCESS_UNAUTHORIZED_STATUS,
  isAllowedAccessEmail,
} from "@novamind/shared/access";
import { Button } from "@/components/ui/button";
import { Modal, ModalSection, ModalTitle } from "@/components/ui/modal";
import { fetchDemoApi, responseNeedsAccess } from "@/lib/demo-api-fetch";
import { isEditableTarget } from "@/lib/dom-targets";
import { localAuthEnabled } from "@/lib/runtime-mode";
import { reportClientStreamWarning } from "@/lib/sse-client";

export { responseNeedsAccess } from "@/lib/demo-api-fetch";

type AccessDeniedReason = "unauthorized" | null;

interface AccessDisplayState {
  deniedReason: AccessDeniedReason;
  email: string | null;
}

interface AccessGateValue {
  email: string | null;
  isAuthenticated: boolean;
  requireAccess: () => boolean;
  showLogin: (options?: { resetAccessHint?: boolean }) => void;
}

const AccessGateContext = createContext<AccessGateValue | null>(null);
const RUNTIME_STARTUP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Client-side access coordinator for demo actions. Server routes still enforce
 * Cloudflare Access; this provider only controls the modal state, keyboard
 * shortcut, and non-sensitive signed-in display hints.
 */
export function AccessGateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState<AccessDisplayState>({
    deniedReason: null,
    email: null,
  });
  const startupStarted = useRef(false);
  const { deniedReason, email } = access;

  const refreshAccess = useCallback(() => {
    setAccess(readAccessState());
  }, []);

  useEffect(() => {
    refreshAccess();
  }, [refreshAccess]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (event.key.toLowerCase() !== "l") return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      refreshAccess();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [refreshAccess]);

  useEffect(() => {
    const authenticated = localAuthEnabled() || isAllowedAccessEmail(email);
    if (!authenticated) {
      startupStarted.current = false;
      return;
    }
    if (startupStarted.current) return;
    startupStarted.current = true;
    const controllers = new Set<AbortController>();

    function pingRuntimeStartup(includeProbe: boolean) {
      const controller = new AbortController();
      controllers.add(controller);
      const path = includeProbe
        ? "/api/agent/startup"
        : "/api/agent/startup?probe=0";
      void fetchDemoApi(path, {
        method: "POST",
        signal: controller.signal,
      })
        .then((res) => {
          if (!responseNeedsAccess(res)) return;
          clearClientAccessCookies();
          setAccess({ deniedReason: null, email: null });
          setOpen(true);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (localAuthEnabled()) {
            reportClientStreamWarning(
              "agent-runtime-startup",
              "runtime startup failed",
              err,
            );
          }
        })
        .finally(() => controllers.delete(controller));
    }

    pingRuntimeStartup(true);
    const interval = window.setInterval(
      () => pingRuntimeStartup(false),
      RUNTIME_STARTUP_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(interval);
      for (const controller of controllers) controller.abort();
    };
  }, [email]);

  const value = useMemo<AccessGateValue>(() => {
    const requireAccess = () => {
      const currentAccess = readAccessState();
      setAccess(currentAccess);
      if (localAuthEnabled()) return true;
      if (isAllowedAccessEmail(currentAccess.email)) return true;
      setOpen(true);
      return false;
    };

    return {
      email,
      isAuthenticated: localAuthEnabled() || isAllowedAccessEmail(email),
      requireAccess,
      showLogin: (options) => {
        if (options?.resetAccessHint) {
          clearClientAccessCookies();
          setAccess({ deniedReason: null, email: null });
        } else {
          refreshAccess();
        }
        setOpen(true);
      },
    };
  }, [email, refreshAccess]);

  return (
    <AccessGateContext.Provider value={value}>
      {children}
      <AccessLoginModal
        deniedReason={deniedReason}
        open={open}
        email={email}
        onClose={() => setOpen(false)}
        onLoggedOut={() => {
          refreshAccess();
          setOpen(false);
        }}
      />
    </AccessGateContext.Provider>
  );
}

export function useAccessGate(): AccessGateValue {
  const value = useContext(AccessGateContext);
  if (!value) {
    throw new Error("useAccessGate must be used inside AccessGateProvider");
  }
  return value;
}

/**
 * Cloudflare Access keeps its own session cookie. The local UI cookie is just
 * a display hint, so logout clears it here and then redirects to Access logout
 * when the app is not running on localhost.
 */
function AccessLoginModal({
  deniedReason,
  open,
  email,
  onClose,
  onLoggedOut,
}: {
  deniedReason: AccessDeniedReason;
  open: boolean;
  email: string | null;
  onClose: () => void;
  onLoggedOut: () => void;
}) {
  const [loggingOut, setLoggingOut] = useState(false);
  const authenticated = isAllowedAccessEmail(email);
  const message = authenticated
    ? `Signed in as ${email}.`
    : deniedReason === "unauthorized"
      ? "You're not authorized to do that."
      : "Only authorized users are allowed to run demos. Please log in.";

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/access-login", { method: "DELETE" });
    } finally {
      clearClientAccessCookies();
    }
    const logoutUrl = cloudflareAccessLogoutUrl();
    if (logoutUrl) {
      window.location.assign(logoutUrl);
      return;
    }
    onLoggedOut();
    setLoggingOut(false);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <ModalTitle
          icon={ShieldCheck}
          title="Demo access"
          description="Required for live agent actions"
        />
      }
      className="max-w-lg"
    >
      <div className="space-y-5">
        <ModalSection>
          <p className="text-sm leading-relaxed text-foreground">{message}</p>
        </ModalSection>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
          {authenticated && (
            <Button
              type="button"
              variant="outline"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              <LogOut />
              {loggingOut ? "Logging out" : "Log out"}
            </Button>
          )}
          {!authenticated && (
            <Button type="button" onClick={() => goToAccessLogin()}>
              <LogIn />
              {deniedReason === "unauthorized" ? "Try another email" : "Log in"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function cloudflareAccessLogoutUrl(): string | null {
  if (isLocalHostname(window.location.hostname)) return null;
  return "/cdn-cgi/access/logout";
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function clearClientAccessCookies() {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${ACCESS_EMAIL_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
  document.cookie = `${ACCESS_STATUS_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
}

function goToAccessLogin() {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(
    `/api/auth/access-login?returnTo=${encodeURIComponent(returnTo)}`,
  );
}

function readAccessState(): AccessDisplayState {
  const email = readAccessEmailCookie();
  const status = readCookie(ACCESS_STATUS_COOKIE);
  return {
    deniedReason:
      !email && status === ACCESS_UNAUTHORIZED_STATUS ? "unauthorized" : null,
    email,
  };
}

function readAccessEmailCookie(): string | null {
  const value = readCookie(ACCESS_EMAIL_COOKIE);
  if (!value) return null;
  try {
    const email = decodeURIComponent(value);
    return isAllowedAccessEmail(email) ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const cookie = document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix));
  if (!cookie) return null;
  return cookie.slice(prefix.length);
}
