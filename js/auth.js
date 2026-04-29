// Auth helpers — session, profile loading, sign in/out.

import { sb } from './supabase.js';

let currentSession = null;
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
  for (const fn of listeners) fn({ session: currentSession, profile: currentProfile });
}

async function loadProfile(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('id, role, full_name, client_id, created_at')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('Failed to load profile:', error);
    return null;
  }
  return data;
}

export async function initAuth() {
  // Restore existing session if present
  const { data: { session } } = await sb.auth.getSession();
  currentSession = session;
  if (session?.user) {
    currentProfile = await loadProfile(session.user.id);
  }

  // Subscribe to auth changes
  sb.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;
    currentProfile = session?.user ? await loadProfile(session.user.id) : null;
    notify();
  });

  notify();
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await sb.auth.signOut();
  currentSession = null;
  currentProfile = null;
  notify();
}

export function getInitials(name, email) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0]?.[0] ?? '').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return '??';
}
