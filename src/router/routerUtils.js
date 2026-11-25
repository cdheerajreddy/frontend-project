/**
 * Dynamically resolves the base repository path for GitHub Pages or local environments.
 * Returns '/frontend-project' when deployed on GitHub Pages, or '' locally.
 */
export function getRouterBase() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) {
    const b = import.meta.env.BASE_URL.replace(/\/+$/, '');
    if (b) return b;
  }
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/frontend-project')) {
    return '/frontend-project';
  }
  return '';
}

/**
 * Normalizes a URL path by stripping the repository base prefix (e.g., /frontend-project).
 * This ensures route matching (e.g. '/' or '/demo') works identically on GitHub Pages and localhost.
 *
 * Examples:
 *   /frontend-project/      -> /
 *   /frontend-project       -> /
 *   /frontend-project/demo  -> /demo
 *   /demo                   -> /demo
 */
export function normalizePath(pathname) {
  if (!pathname || typeof pathname !== 'string') return '/';
  const base = getRouterBase();

  let p = pathname;
  if (base && p.startsWith(base)) {
    p = p.slice(base.length);
  }

  // Ensure leading slash
  if (!p.startsWith('/')) {
    p = '/' + p;
  }

  // Strip trailing slash unless root '/'
  if (p.length > 1 && p.endsWith('/')) {
    p = p.replace(/\/+$/, '');
  }

  return p || '/';
}

/**
 * Prepends the base path (e.g., /frontend-project) to internal links for GitHub Pages.
 *
 * Examples:
 *   /demo       -> /frontend-project/demo
 *   /           -> /frontend-project/
 *   #projects   -> #projects
 */
export function withBase(path) {
  if (!path || typeof path !== 'string') return path;
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('mailto:') ||
    path.startsWith('#')
  ) {
    return path;
  }

  const base = getRouterBase();
  if (!base) return path;

  // Already prefixed
  if (path.startsWith(base)) return path;

  const normalized = path.startsWith('/') ? path : '/' + path;
  if (normalized === '/') {
    return base + '/';
  }
  return base + normalized;
}

/**
 * Detects whether the current runtime is a static GitHub Pages deployment without a Node.js backend.
 */
export function isStaticDemoMode() {
  if (typeof window === 'undefined') return false;
  return (
    window.location.hostname.endsWith('github.io') ||
    window.location.pathname.startsWith('/frontend-project') ||
    Boolean(getRouterBase())
  );
}
