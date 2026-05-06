/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Browser API origin (skips `/api/kubeez` for JSON/SSE). When unset, media uses same-origin
   * `/api/kubeez/cdn/*` (see vercel.json / nginx). When set (e.g. editor.kubeez.com prod), media is
   * fetched from `https://media.kubeez.com` — that origin must allow CORS + CORP for the editor.
   */
  readonly VITE_KUBEEZ_BROWSER_API_URL?: string;

  /**
   * Supabase project URL — must match kubeez.com so the `.kubeez.com` cookie
   * SSO works. When set together with the publishable key, KubeezCut talks to
   * the same auth + edge functions as the main app and the X-API-Key flow is
   * disabled.
   */
  readonly VITE_SUPABASE_URL?: string;

  /**
   * Supabase publishable (anon) key — must match kubeez.com. Either name is
   * accepted; the client checks both for compatibility with kubeez.com's env.
   */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
