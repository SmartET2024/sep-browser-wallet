import { FC, useEffect, useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import classNames from "clsx";

import { addAccountModalAtom, profileStateAtom } from "app/atoms";

import BoardingPageLayout from "app/components/layouts/BoardingPageLayout";
import Button from "app/components/elements/Button";
import { ReactComponent as WigwamIcon } from "app/icons/Wigwam.svg";
import SECSimpleLogo from "../elements/sec-logo/SECSimpleLogo";

const Welcome: FC = () => {
  const { all } = useAtomValue(profileStateAtom);
  const addAccOpened = useAtomValue(addAccountModalAtom);
  const setAddAccOpened = useSetAtom(addAccountModalAtom);

  const isInitial = useMemo(() => all.length === 1, [all]);

  useEffect(() => {
    if (isInitial) {
      setAddAccOpened([true, "replace"]);
    }
  }, [isInitial, setAddAccOpened]);

  useEffect(() => {
    const t = setTimeout(() => {
      const scrollarea = document.documentElement;

      if (scrollarea) {
        scrollarea.scrollLeft =
          (scrollarea.offsetWidth - scrollarea.clientWidth) / 2;
      }
    }, 0);

    return () => clearTimeout(t);
  }, []);

  return (
    <BoardingPageLayout header={!isInitial} isWelcome>
      <div
        className={classNames(
          "flex flex-col items-center -mt-[3vh] relative z-10",
          addAccOpened
            ? "opacity-0"
            : "opacity-100 transition-opacity duration-500",
        )}
      >
        <div className="inline-flex items-center justify-center flex-1 sm:flex-0 gap-2 mb-4">
          <div className=" w-[38px] h-[38px] sm:w-[120px] sm:h-[120px]">
            <img height={120} width={120} src="/logo.png" alt="logo" />
          </div>
        </div>
        <h1
          className={classNames(
            "mb-16 text-5xl mmd:text-4xl font-bold text-brand-light",
          )}
        >
          Welcome to Smart Energy Chain
        </h1>

        <Button
          theme="primary-reverse"
          to={{ addAccOpened: true }}
          merge
          className="w-[14rem]"
        >
          {isInitial ? "Get started" : "Add wallet"}
        </Button>
      </div>
    </BoardingPageLayout>
  );
};

export default Welcome;
