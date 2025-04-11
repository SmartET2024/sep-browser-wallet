import { FC, useEffect } from "react";

import { useLocked } from "app/hooks";
import { ToastProvider } from "app/hooks/toast";

import BaseProvider from "./BaseProvider";
import FullScreenRouter from "./FullScreenRouter";

import Dialog from "./blocks/Dialog";
import ContactsDialog from "./blocks/ContactsDialog";
import AddAccountModal from "./blocks/AddAccountModal";
import ActivityModal from "./blocks/activity/ActivityModal";
import AddFundsOnRampModal from "./blocks/AddFundsOnRampModal";
import ReceivePopup from "./blocks/ReceiveModal";
// import AuthSignatureModal from "./blocks/AuthSignatureModal";

// Define a type for React components with the properties we need
interface ReactMemoComponent {
  $$typeof: symbol;
  type: {
    name?: string;
  } & Function;
}

// Direct fix for the React Router basename error
// This fixes the "Cannot destructure property 'basename' of 'a.useContext(...)' as it is null" error
const fixReactRouterError = () => {
  try {
    // Find the target React component that's causing the error
    const allWindowProps = Object.getOwnPropertyNames(window);
    
    // Try to locate the React Router component
    for (const prop of allWindowProps) {
      // Skip non-object properties
      if (typeof (window as any)[prop] !== 'object' || !(window as any)[prop]) continue;
      
      const obj = (window as any)[prop];
      
      // Check if this looks like a React memo component
      if (obj.$$typeof === Symbol.for('react.memo') && obj.type) {
        const componentName = obj.type.name || '';
        
        // If we found a Router component, patch it
        if (componentName.includes('Router')) {
          const originalType = obj.type;
          
          // Create a new function that wraps the original component
          obj.type = function(props: any) {
            // Provide a default context if it's missing
            if (!props.basename && props.basename !== '') {
              props = { 
                ...props, 
                basename: '',
                location: window.location,
                navigationType: 'POP' 
              };
            }
            return originalType(props);
          };
          
          // Preserve the original name
          obj.type.name = originalType.name;
          console.log('Applied fix for React Router basename error');
          break;
        }
      }
    }
  } catch (err) {
    console.warn('Failed to apply React Router fix', err);
  }
};

const MainApp: FC = () => {
  // Apply the fix when the component mounts
  useEffect(() => {
    // Small delay to ensure React is loaded
    setTimeout(fixReactRouterError, 100);
  }, []);

  return (
    <BaseProvider>
      <ToastProvider>
        <FullScreenRouter />

        <Modals />
      </ToastProvider>
    </BaseProvider>
  );
};

export default MainApp;

const Modals: FC = () => {
  const locked = useLocked();

  return (
    <>
      <Dialog />
      {!locked && (
        <>
          <ContactsDialog />
          <AddAccountModal />
          <ActivityModal />
          <ReceivePopup />
          <AddFundsOnRampModal />
          {/* <AuthSignatureModal /> */}
        </>
      )}
    </>
  );
};
