import { FC, useState } from "react";
import { Link } from "react-router-dom";
import classNames from "clsx";

import BoardingPageLayout from "app/components/layouts/BoardingPageLayout";
import Button from "app/components/elements/Button";
import OnboardingPopup from "app/components/blocks/OnboardingPopup";
import { ReactComponent as WigwamIcon } from "app/icons/Wigwam.svg";

const onboardingEnabled = true;

const Welcome: FC = () => {
  const [isOnboarding, setIsOnboarding] = useState(false);

  return (
    <BoardingPageLayout>
      <div className="relative">
        <div className="w-full tablet:w-[25.5rem] bg-white bg-opacity-[0.03] animate-bootfadein rounded-lg border border-white border-opacity-10 backdrop-blur-[30px] py-7 px-7">
          <div className="flex flex-col items-start w-full">
            <div className="mb-12 w-full flex flex-col items-center">
              <WigwamIcon className={classNames("w-[5rem] h-auto mb-5")} />
              <div className="text-center text-2xl font-bold">
                Welcome to SEP Wallet
              </div>
              <div className="text-center text-md text-[#596869] mb-5">
                Your gateway to the Smart Energy Chain ecosystem
              </div>
            </div>

            <div className="flex flex-col w-full space-y-3 items-center">
              <Link
                to="/create-wallet"
                className="w-full"
                onClick={() => {
                  onboardingEnabled && setIsOnboarding(true);
                }}
              >
                <Button 
                  theme="primary" 
                  className="w-full"
                >
                  <span className="text-md font-normal mb-0.5">
                    Get started
                  </span>
                  <span className="text-xs font-thin">
                    Create or Add a Wallet
                  </span>
                </Button>
              </Link>

              <Link to="/load-vault" className="w-full">
                <Button 
                  theme="secondary"
                  className="w-full"
                >
                  Restore existing account from backup
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {isOnboarding && (
          <OnboardingPopup
            onClose={() => setIsOnboarding(false)}
            onContinue={() => {
              setIsOnboarding(false);
              window.location.href = window.location.origin + "/create-wallet";
            }}
          />
        )}
      </div>
    </BoardingPageLayout>
  );
};

export default Welcome;
