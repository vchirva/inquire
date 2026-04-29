// Hash-based router. Uses #/path for navigation.
// Routes are defined with optional role guards.

import { isAuthenticated, isAdmin, isClient, onAuthChange } from './auth.js';

const routes = [];

export function defineRoute({ pattern, render, requireAuth, requireRole }) {
  routes.push({ pattern, render, requireAuth, requireRole });
}

export function navigate(path) {
  if (location.hash !== `#${path}`) {
    location.hash = path;
  } else {
    handleRoute();
  }
}

function findRoute(path) {
  for (const r of routes) {
    if (typeof r.pattern === 'string') {
      if (r.pattern === path) return { route: r, params: {} };
    } else if (r.pattern instanceof RegExp) {
      const m = path.match(r.pattern);
      if (m) return { route: r, params: m.groups ?? {} };
    }
  }
  return null;
}

async function handleRoute() {
  const path = location.hash.slice(1) || '/';
  const root = document.getElementById('app');

  // Authenticated users should never linger on public pages — bounce them home.
  if (isAuthenticated() && (path === '/' || path === '/login' || path.startsWith('/register/'))) {
    return navigate(isAdmin() ? '/admin' : '/cabinet');
  }

  // Public route: client registration via invite token (only for anonymous visitors)
  if (path.startsWith('/register/')) {
    const match = findRoute(path);
    if (match) {
      root.innerHTML = '';
      await match.route.render(root, match.params);
      return;
    }
  }

  // Default redirects for anonymous users
  if (!isAuthenticated()) {
    if (path !== '/login') return navigate('/login');
  }

  const match = findRoute(path);
  if (!match) {
    root.innerHTML = `
      <div class="container">
        <div class="empty">
          <div class="empty-title">404</div>
          <div class="empty-text">Page not found.</div>
          <button class="btn btn-outline" onclick="location.hash='#/'">Go home</button>
        </div>
      </div>`;
    return;
  }

  // Role guards
  if (match.route.requireAuth && !isAuthenticated()) return navigate('/login');
  if (match.route.requireRole === 'admin' && !isAdmin()) return navigate('/cabinet');
  if (match.route.requireRole === 'client' && !isClient()) return navigate('/admin');

  root.innerHTML = '';
  await match.route.render(root, match.params);
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  onAuthChange(() => handleRoute());
  handleRoute();
}
