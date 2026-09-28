export type AuthUser = {
  userId: string;
  email: string;
  role?: string | null;
};

export const readStoredUser = (): AuthUser | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const userId = parsed.user_id || parsed.oauth_id;
    const email = parsed.email;
    if (!userId || !email) return null;
    return { userId, email, role: parsed.role || null };
  } catch {
    return null;
  }
};

/**
 * The signed-in user's X-API-Token (their emailVerificationToken).
 *
 * The Vegvisr workers authenticate with `X-API-Token` resolved against
 * config.emailVerificationToken. The auth flow persists it in localStorage.'user'
 * (see persistUser in App.tsx), so every caller reads it from there.
 *
 * Returns null when signed out — callers decide whether that is fatal.
 */
export const getApiToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.emailVerificationToken || null;
  } catch {
    return null;
  }
};
