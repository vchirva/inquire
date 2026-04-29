// Auth — raw fetch implementation that bypasses the Supabase JS auth subsystem.
// Maintains the same public API as before so other modules don't need changes.

import {
  sb, SUPABASE_URL, SUPABASE_ANON_KEY,
  getStoredToken, setStoredToken,
  authSignInWithPassword, authSignUp, authRefresh, authGetUser, authSignOut,
  setClientAuth
} from './supabase.js';

let currentSession = null;   // { access_token, refresh_token, expires_at, user }
let currentProfile = null;
const listeners = new Set();

export function getSession() { return currentSession; }
export function getProfile() { return currentProfile; }
export function isAuthenticated() { return !!currentSession; }
export function isAdmin() { return currentProfile?.role === 'admin'; }
export function isClient() { return currentProfile?.role === 'client'; }

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try { fn({ session: currentSession, profile: currentProfile }); }
    catch (e) { console.error('auth listener error:', e); }
  }
}

// ─── Profile loading ────────────────────────────────────────────────────────

async function loadProfile(userId, accessToken) {
  // Use raw fetch to avoid any quirks in the JS client. PostgREST returns an
  // array; we take the first row.
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=id,role,full_name,client_id,created_at&id=eq.${userId}`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json'
        }
      }
    );
    if (!res.ok) {
      console.warn('loadProfile failed:', res.status, await res.text());
      return null;
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] ?? null : null;
  } catch (e) {
    console.error('loadProfile threw:', e);
    return null;
  }
}

export async function refreshProfile() {
  if (!currentSession?.user || !currentSession?.access_token) return null;
  currentProfile = await loadProfile(currentSession.user.id, currentSession.access_token);
  notify();
  return currentProfile;
}

// ─── Token lifecycle ────────────────────────────────────────────────────────

function isTokenExpired(token, skewSec = 30) {
  if (!token?.expires_at) return true;
  return token.expires_at * 1000 < Date.now() + skewSec * 1000;
}

async function applyToken(token) {
  // token shape: { access_token, refresh_token, expires_in, expires_at, user }
  // Some endpoints don't include expires_at; compute from expires_in + now.
  if (token.expires_in && !token.expires_at) {
    token.expires_at = Math.floor(Date.now() / 1000) + token.expires_in;
  }
  currentSession = token;
  setStoredToken(token);
  setClientAuth(token.access_token);
  if (token.user?.id) {
    currentProfile = await loadProfile(token.user.id, token.access_token);
  }
}

function clearSession() {
  currentSession = null;
  currentProfile = null;
  setStoredToken(null);
  setClientAuth(null);
}

// ─── Boot init ──────────────────────────────────────────────────────────────

export async function initAuth() {
  const stored = getStoredToken();
  if (!stored) {
    notify();
    return;
  }

  // If access token still valid, restore session as-is.
  if (!isTokenExpired(stored)) {
    try {
      await applyToken(stored);
    } catch (e) {
      console.warn('Could not apply stored token, clearing:', e);
      clearSession();
    }
    notify();
    return;
  }

  // Access token expired but refresh token might still work.
  if (stored.refresh_token) {
    try {
      const refreshed = await authRefresh(stored.refresh_token);
      await applyToken(refreshed);
    } catch (e) {
      console.warn('Token refresh failed, clearing session:', e);
      clearSession();
    }
  } else {
    clearSession();
  }
  notify();
}

// ─── Public actions ─────────────────────────────────────────────────────────

export async function signIn(email, password) {
  const token = await authSignInWithPassword(email, password);
  await applyToken(token);
  notify();
  return token;
}

export async function signUp(email, password, metadata = {}) {
  // Returns either { access_token, refresh_token, ... } if email confirmation
  // is disabled (most likely setup), or { user, session: null } otherwise.
  const result = await authSignUp(email, password, metadata);
  if (result?.access_token) {
    await applyToken(result);
    notify();
    return { session: result, user: result.user };
  }
  // Email confirmation required — caller may need to sign in explicitly.
  return { session: null, user: result?.user ?? result };
}

export async function signOut() {
  const token = currentSession?.access_token;
  clearSession();
  notify();
  // Hard-reload to /login to drop any stale view state. Fire-and-forget revoke.
  if (token) authSignOut(token).catch(() => {});
  location.hash = '#/login';
}

// Send a password reset email. Supabase's GoTrue /recover endpoint sends a link
// that lets the user set a new password.
export async function resetPassword(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ email })
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text)?.msg || msg; } catch {}
    throw new Error(msg || `Reset failed (${res.status})`);
  }
  return true;
}

export function getInitials(name, email) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0]?.[0] ?? '').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return '??';
}
