import "./styles/index.css";

import "lib/shims/bignumberLimit";

import { ReactNode } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { disableOutlinesForClick } from "lib/outline-on-click";

// Fix for React Router issue - provide a mock context to avoid "basename" error
if (typeof window !== "undefined") {
  // Fix for React Router navigation missing error
  const mockRouterContext = {
    basename: "",
    navigator: {},
    static: false, 
    location: {
      pathname: "/",
      search: "",
      hash: "",
      state: {},
      key: "default"
    }
  };

  // Add a polyfill for React Router's context
  // @ts-ignore
  window.__reactRouterContextPolyfill = true;
  
  // Inject mocks for React Router
  const originalCreateContext = React.createContext;
  // @ts-ignore
  React.createContext = function(defaultValue) {
    const context = originalCreateContext(defaultValue);
    
    // Replace React Router context with our mock when it's being created
    if (defaultValue && defaultValue.basename !== undefined) {
      console.debug("Patching router context");
      return {
        ...context,
        Provider: ({ children }: { children: React.ReactNode }) => {
          return originalCreateContext(mockRouterContext).Provider({
            value: mockRouterContext,
            children
          });
        }
      };
    }
    
    return context;
  };
}

if (
  process.env.NODE_ENV === "development" &&
  process.env.WIGWAM_DEV_ELEMENTS_SPACING === "true"
) {
  // eslint-disable-next-line
  require("spacingjs/dist/bundle");
}

export function mount(app: ReactNode) {
  disableOutlinesForClick();

  const root = createRoot(document.getElementById("root")!);
  root.render(<>{app}</>);
}
