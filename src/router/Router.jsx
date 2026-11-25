import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  getRouterBase,
  normalizePath,
  withBase,
  isStaticDemoMode
} from './routerUtils.js';

export { getRouterBase, normalizePath, withBase, isStaticDemoMode };

const RouterContext = createContext({
  currentPath: '/',
  navigate: () => {},
  base: ''
});

/**
 * Lightweight, zero-dependency History API router provider.
 * Intercepts popstate, supports base-prefixed navigation, and handles GitHub Pages subpaths.
 */
export function Router({ children }) {
  const [currentPath, setCurrentPath] = useState(() =>
    typeof window !== 'undefined' ? normalizePath(window.location.pathname) : '/'
  );

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(normalizePath(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (to, { replace = false } = {}) => {
    if (typeof window === 'undefined') return;

    const fullUrl = withBase(to);
    const normalized = normalizePath(to);

    if (replace) {
      window.history.replaceState(null, '', fullUrl);
    } else {
      window.history.pushState(null, '', fullUrl);
    }

    setCurrentPath(normalized);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <RouterContext.Provider value={{ currentPath, navigate, base: getRouterBase() }}>
      {children}
    </RouterContext.Provider>
  );
}

/**
 * Hook to access current navigation path, navigate function, and base path.
 */
export function useRouter() {
  return useContext(RouterContext);
}

/**
 * Accessible navigational anchor tag that intercepts internal clicks and maintains base repository prefix.
 */
export function Link({ href, className = '', children, onClick, ...props }) {
  const { navigate } = useRouter();

  const isHash = typeof href === 'string' && href.startsWith('#');
  const isExternal =
    typeof href === 'string' &&
    (href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('mailto:') ||
      props.target === '_blank');

  const fullHref = isHash || isExternal ? href : withBase(href);

  const handleClick = (e) => {
    if (onClick) onClick(e);

    // Allow default browser behavior for modifier keys or external/hash links
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.altKey ||
      e.ctrlKey ||
      e.shiftKey ||
      isExternal
    ) {
      return;
    }

    if (isHash) {
      return;
    }

    e.preventDefault();
    navigate(href);
  };

  return (
    <a href={fullHref} className={className} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}

/**
 * Route matcher component.
 */
export function Route({ path, element }) {
  const { currentPath } = useRouter();
  if (currentPath === normalizePath(path)) {
    return element;
  }
  return null;
}
