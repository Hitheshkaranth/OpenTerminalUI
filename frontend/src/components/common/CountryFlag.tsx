import { useState } from "react";

type CountryFlagProps = {
  countryCode?: string | null;
  flagEmoji?: string | null;
  size?: "sm" | "md" | "lg";
};

const SIZE_CLASS: Record<NonNullable<CountryFlagProps["size"]>, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

export function CountryFlag({ countryCode, flagEmoji, size = "md" }: CountryFlagProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const emoji = (flagEmoji || "").trim();
  if (emoji) {
    return <span className={`inline-flex items-center ${SIZE_CLASS[size]}`}>{emoji}</span>;
  }

  const code = (countryCode || "").trim().toLowerCase();
  if (!code) return null;
  if (imgFailed) {
    return <span className={`inline-flex items-center rounded border border-terminal-border px-1 text-[10px] text-terminal-muted`}>{code.toUpperCase()}</span>;
  }
  return (
    <img
      src={`https://flagcdn.com/w20/${code}.png`}
      alt={countryCode || code.toUpperCase()}
      className="inline-block h-3.5 w-5 rounded-sm border border-terminal-border object-cover"
      loading="lazy"
      onError={() => setImgFailed(true)}
    />
  );
}
