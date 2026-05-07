/**
 * Loads the user's row from the kubeez `profiles` table — the source of
 * truth for `username` and `avatar_url`. Supabase `user_metadata` only
 * carries what was set at signup (often empty for email/password) so we
 * always go to the table.
 *
 * Two caches keep the chip from flashing fallback values:
 *   1. **localStorage** — keyed by user id. On mount we hydrate from
 *      cache *synchronously* so the chip shows the right name + avatar
 *      on first paint. Background refresh happens on every mount so the
 *      cache is never staler than one editor open.
 *   2. **In-memory fallbacks** — derived from the auth user (username
 *      from email-local-part, avatar from OAuth metadata). Used only on
 *      the very first sign-in when no cache exists yet.
 */

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/infrastructure/supabase/client';
import { createLogger } from '@/shared/logging/logger';
import { useKubeezSession } from './use-kubeez-session';

const logger = createLogger('KubeezProfile');

/** localStorage key prefix — user id appended so multiple accounts on the same browser don't collide. */
const PROFILE_CACHE_KEY_PREFIX = 'kubeezcut:kubeez-profile:';

export interface KubeezProfile {
  /** Display name — `profiles.username` first, then anything we can derive. Always non-empty. */
  username: string;
  /** Resolved (full) avatar URL, or null when there isn't one. */
  avatarUrl: string | null;
  /** Email pulled from the auth user (always available when signed in). */
  email: string | null;
  /** True after the live profiles-table fetch has resolved (vs. just hydrated from cache/fallbacks). */
  loaded: boolean;
}

interface ProfileRow {
  username: string | null;
  avatar_url: string | null;
}

interface CachedProfile {
  username: string;
  avatarUrl: string | null;
  email: string | null;
}

function pickString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * kubeez stores avatars two ways:
 *   - Full HTTP(S) URLs from OAuth providers (Google: `https://lh3.googleusercontent.com/...`).
 *   - Relative Supabase Storage paths (`profile-pictures/<id>.jpg`) that need to be
 *     expanded to `${supabaseUrl}/storage/v1/object/public/<path>` before they're loadable.
 *
 * Mirrors `kubeez-website/src/components/profile/utils/imageUtils.ts:getProfilePictureUrl`.
 */
function resolveAvatarUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) return raw;
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
  if (!supabaseUrl) return null;
  return `${supabaseUrl}/storage/v1/object/public/${raw.replace(/^\/+/, '')}`;
}

function deriveFallbacks(user: User): { username: string; avatarUrl: string | null } {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const usernameMeta =
    pickString(meta.username) ??
    pickString(meta.full_name) ??
    pickString(meta.name) ??
    pickString(meta.preferred_username);
  const avatarUrl = resolveAvatarUrl(
    pickString(meta.avatar_url) ?? pickString(meta.picture)
  );
  const email = user.email ?? null;
  const username = usernameMeta ?? (email ? email.split('@')[0]! : 'Account');
  return { username, avatarUrl };
}

function cacheKeyFor(userId: string): string {
  return `${PROFILE_CACHE_KEY_PREFIX}${userId}`;
}

function readCachedProfile(userId: string): CachedProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(cacheKeyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedProfile>;
    if (typeof parsed.username !== 'string' || parsed.username.length === 0) return null;
    return {
      username: parsed.username,
      avatarUrl: typeof parsed.avatarUrl === 'string' ? parsed.avatarUrl : null,
      email: typeof parsed.email === 'string' ? parsed.email : null,
    };
  } catch {
    return null;
  }
}

function writeCachedProfile(userId: string, profile: CachedProfile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(cacheKeyFor(userId), JSON.stringify(profile));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function clearKubeezProfileCache(userId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (userId) {
      window.localStorage.removeItem(cacheKeyFor(userId));
      return;
    }
    // Nuke all profile cache entries (used on sign-out when we don't know which user is logging out).
    const keys = Object.keys(window.localStorage);
    for (const k of keys) {
      if (k.startsWith(PROFILE_CACHE_KEY_PREFIX)) {
        window.localStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
}

export function useKubeezProfile(): KubeezProfile {
  const { user } = useKubeezSession();
  // Initialise synchronously from cache (or fallbacks) so the chip never
  // paints a wrong username during the network round-trip.
  const [profile, setProfile] = useState<KubeezProfile | null>(() => {
    if (!user) return null;
    const cached = readCachedProfile(user.id);
    if (cached) {
      return {
        username: cached.username,
        avatarUrl: cached.avatarUrl,
        email: cached.email ?? user.email ?? null,
        loaded: false,
      };
    }
    const fallbacks = deriveFallbacks(user);
    return {
      username: fallbacks.username,
      avatarUrl: fallbacks.avatarUrl,
      email: user.email ?? null,
      loaded: false,
    };
  });

  useEffect(() => {
    if (!user || !supabase) {
      setProfile(null);
      return;
    }

    // If the user changed since the initial state, re-hydrate from the
    // right cache entry now (initial state ran for the previous user).
    setProfile((current) => {
      if (current && current.email === (user.email ?? null)) return current;
      const cached = readCachedProfile(user.id);
      if (cached) {
        return {
          username: cached.username,
          avatarUrl: cached.avatarUrl,
          email: cached.email ?? user.email ?? null,
          loaded: false,
        };
      }
      const fallbacks = deriveFallbacks(user);
      return {
        username: fallbacks.username,
        avatarUrl: fallbacks.avatarUrl,
        email: user.email ?? null,
        loaded: false,
      };
    });

    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase!
          .from('profiles')
          .select('username, avatar_url')
          .eq('id', user.id)
          .maybeSingle<ProfileRow>();
        if (cancelled) return;
        if (error) {
          logger.warn('Profile fetch failed (using cache/fallbacks)', { message: error.message });
          setProfile((prev) => (prev ? { ...prev, loaded: true } : prev));
          return;
        }
        const fallbacks = deriveFallbacks(user);
        const row = data ?? null;
        const username = pickString(row?.username) ?? fallbacks.username;
        const avatarUrl = resolveAvatarUrl(pickString(row?.avatar_url)) ?? fallbacks.avatarUrl;
        const next: KubeezProfile = {
          username,
          avatarUrl,
          email: user.email ?? null,
          loaded: true,
        };
        setProfile(next);
        writeCachedProfile(user.id, {
          username: next.username,
          avatarUrl: next.avatarUrl,
          email: next.email,
        });
      } catch (e) {
        if (!cancelled) {
          logger.warn('Profile fetch threw (using cache/fallbacks)', { error: String(e) });
          setProfile((prev) => (prev ? { ...prev, loaded: true } : prev));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    profile ?? {
      username: 'Account',
      avatarUrl: null,
      email: null,
      loaded: false,
    }
  );
}
