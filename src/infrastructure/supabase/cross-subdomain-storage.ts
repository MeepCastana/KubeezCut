/**
 * Cross-subdomain auth storage for Supabase — KubeezCut edition.
 *
 * Mirrors the kubeez.com adapter so a session signed in on kubeez.com is
 * visible on editor.kubeez.com (and vice versa) via cookies scoped to
 * `.kubeez.com`. On any non-kubeez host (localhost, preview deploys) it
 * falls back to plain localStorage — no Domain cookie would survive
 * across origins anyway.
 *
 * Security: cookies use `Secure` + `SameSite=Lax` (the value that survives
 * top-level cross-subdomain navigation, which is exactly the SSO flow we
 * want). `HttpOnly` is intentionally omitted because supabase-js needs JS
 * read access — same exposure as the prior localStorage fallback. The
 * `Domain=.kubeez.com` scope limits the cookie to subdomains we control.
 */

const CHUNK_SIZE = 3072;
const COOKIE_BASE_ATTRS = 'Path=/; SameSite=Lax; Secure';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const COOKIE_DOMAIN = '.kubeez.com';

export interface SupabaseAuthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isKubeezHost(hostname: string | undefined): boolean {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  return host === 'kubeez.com' || host.endsWith('.kubeez.com');
}

function shouldUseCookies(): boolean {
  if (typeof window === 'undefined') return false;
  return isKubeezHost(window.location.hostname);
}

function escapeRegex(s: string): string {
  return s.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&');
}

function readRawCookie(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null;
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + escapeRegex(name) + '=([^;]*)'),
  );
  if (!match) return null;
  const raw = match[1] ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function writeRawCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Domain=${COOKIE_DOMAIN}`,
    COOKIE_BASE_ATTRS,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  document.cookie = parts.join('; ');
}

function deleteRawCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Domain=${COOKIE_DOMAIN}; ${COOKIE_BASE_ATTRS}; Max-Age=0`;
  document.cookie = `${name}=; Path=/; Max-Age=0`;
}

function listCookieNames(): string[] {
  if (typeof document === 'undefined' || !document.cookie) return [];
  return document.cookie
    .split(';')
    .map((c) => c.split('=')[0]?.trim() ?? '')
    .filter(Boolean);
}

function readChunkedCookie(name: string): string | null {
  const direct = readRawCookie(name);
  if (direct !== null) return direct;

  const chunks: string[] = [];
  for (let i = 0; i < 64; i++) {
    const part = readRawCookie(`${name}.${i}`);
    if (part === null) break;
    chunks.push(part);
  }
  return chunks.length > 0 ? chunks.join('') : null;
}

function clearChunkedCookie(name: string): void {
  deleteRawCookie(name);
  for (let i = 0; i < 64; i++) {
    const partName = `${name}.${i}`;
    if (readRawCookie(partName) === null) break;
    deleteRawCookie(partName);
  }
}

function writeChunkedCookie(name: string, value: string): void {
  clearChunkedCookie(name);
  if (value.length <= CHUNK_SIZE) {
    writeRawCookie(name, value);
    return;
  }
  let idx = 0;
  for (let pos = 0; pos < value.length; pos += CHUNK_SIZE, idx++) {
    writeRawCookie(`${name}.${idx}`, value.slice(pos, pos + CHUNK_SIZE));
  }
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* quota / privacy mode — ignore */
  }
}

function safeLocalStorageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function createCrossSubdomainStorage(): SupabaseAuthStorage {
  if (typeof window === 'undefined') {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }

  if (!shouldUseCookies()) {
    return {
      getItem: (key) => safeLocalStorageGet(key),
      setItem: (key, value) => safeLocalStorageSet(key, value),
      removeItem: (key) => safeLocalStorageRemove(key),
    };
  }

  return {
    getItem(key) {
      const cookieValue = readChunkedCookie(key);
      if (cookieValue !== null) return cookieValue;
      const legacy = safeLocalStorageGet(key);
      if (legacy !== null) {
        writeChunkedCookie(key, legacy);
        safeLocalStorageRemove(key);
        return legacy;
      }
      return null;
    },
    setItem(key, value) {
      writeChunkedCookie(key, value);
      safeLocalStorageRemove(key);
    },
    removeItem(key) {
      clearChunkedCookie(key);
      safeLocalStorageRemove(key);
    },
  };
}

/**
 * Best-effort wipe of every Supabase auth artefact this origin can see —
 * cookies (when on kubeez.com) and any lingering localStorage entries.
 * Used by signOut so a stale token can't keep AI panels unlocked after
 * the user clicks "Sign out of Kubeez".
 */
export function clearAllSupabaseAuthStorage(): void {
  if (typeof window === 'undefined') return;

  if (shouldUseCookies()) {
    for (const name of listCookieNames()) {
      if (name.startsWith('sb-')) deleteRawCookie(name);
    }
  }

  try {
    const keys = Object.keys(window.localStorage);
    for (const k of keys) {
      if (k.startsWith('sb-') || k.includes('supabase')) {
        safeLocalStorageRemove(k);
      }
    }
  } catch {
    /* ignore */
  }
}
