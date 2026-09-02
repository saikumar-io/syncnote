import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const RouterContext = createContext({
  location: { pathname: window.location.pathname, search: window.location.search },
  navigate: () => {},
  params: {}
});

export function Router({ children }) {
  const [location, setLocation] = useState({
    pathname: window.location.pathname || '/',
    search: window.location.search || ''
  });

  useEffect(() => {
    const handlePopState = () => {
      setLocation({
        pathname: window.location.pathname || '/',
        search: window.location.search || ''
      });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    if (replace) {
      window.history.replaceState(null, '', to);
    } else {
      window.history.pushState(null, '', to);
    }
    const [pathname, search] = to.split('?');
    setLocation({
      pathname: pathname || '/',
      search: search ? `?${search}` : ''
    });
  }, []);

  return (
    <RouterContext.Provider value={{ location, navigate, params: {} }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useLocation() {
  const context = useContext(RouterContext);
  return context.location;
}

export function useNavigate() {
  const context = useContext(RouterContext);
  return context.navigate;
}

export function useParams() {
  const context = useContext(RouterContext);
  return context.params || {};
}

export function Link({ to, children, className = '', style = {}, onClick, ...props }) {
  const navigate = useNavigate();

  const handleClick = (e) => {
    if (onClick) onClick(e);
    if (!e.defaultPrevented && e.button === 0 && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      if (typeof to === 'string' && !to.startsWith('file:') && !to.includes(':\\')) {
        navigate(to);
      }
    }
  };

  const safeHref = (typeof to === 'string' && (to.startsWith('file:') || to.includes(':\\'))) ? '#' : to;

  return (
    <a href={safeHref} onClick={handleClick} className={className} style={style} {...props}>
      {children}
    </a>
  );
}

/**
 * Route Matcher Helper
 */
export function matchRoute(pattern, pathname) {
  if (pattern === '/' && pathname === '/') return { match: true, params: {} };
  
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) return { match: false, params: {} };

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      const paramName = patternParts[i].substring(1);
      params[paramName] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return { match: false, params: {} };
    }
  }

  return { match: true, params };
}

export function Routes({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  let matchedChild = null;
  let redirectTarget = null;

  React.Children.forEach(children, (child) => {
    if (matchedChild || redirectTarget || !React.isValidElement(child)) return;
    const { path, redirect } = child.props;

    if (redirect && (location.pathname === path || (path === '/' && location.pathname === '/'))) {
      redirectTarget = redirect;
      return;
    }

    const { match, params } = matchRoute(path, location.pathname);
    if (match) {
      matchedChild = React.cloneElement(child, { params });
    }
  });

  useEffect(() => {
    if (redirectTarget) {
      navigate(redirectTarget, { replace: true });
    }
  }, [redirectTarget, navigate]);

  if (redirectTarget) return null;

  return matchedChild;
}

export function Route({ element, params }) {
  const context = useContext(RouterContext);
  return (
    <RouterContext.Provider value={{ ...context, params: params || {} }}>
      {element}
    </RouterContext.Provider>
  );
}
