export default function SECTextLogo() {
  return (
    <div className="flex items-center justify-center flex-1 sm:flex-0 gap-2">
      <div className=" w-[38px] h-[38px] sm:w-[60px] sm:h-[60px]">
        <img height={60} width={60} src="/logo.png" alt="logo" />
      </div>
      <div className="hidden sm:block h-8 w-px bg-gray-600 mx-4"></div>
      <h6 className={`text-white font-semibold type-4 text-xl`}>
        SMART ENERGY PAY
      </h6>
    </div>
  );
}
