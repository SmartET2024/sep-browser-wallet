import React, { createContext, useContext, PropsWithChildren } from 'react';

// Create a context with a default value
const RouterContext = createContext({
  basename: '',
  navigationType: 'POP',
  location: {
    pathname: '/',
    search: '',
    hash: '',
    state: null
  }
});

// Provider component
export const RouterProvider: React.FC<PropsWithChildren> = ({ children }) => {
  // Simple router context value with default values
  const routerValue = {
    basename: '',
    navigationType: 'POP',
    location: {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      state: null
    }
  };

  return (
    <RouterContext.Provider value={routerValue}>
      {children}
    </RouterContext.Provider>
  );
};

// Hook to use the router context
export const useRouterContext = () => useContext(RouterContext);

export default RouterContext; 