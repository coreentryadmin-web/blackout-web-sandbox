import { clsx } from "clsx";
import type { PlatformVariant } from "./PlatformShell";

type PlatformEmptyProps = {
  variant: PlatformVariant;
  title: string;
  description: string;
};

export function PlatformEmpty({ variant, title, description }: PlatformEmptyProps) {
  return (
    <div className={clsx("platform-empty", `platform-empty-${variant}`)}>
      <div className="absolute inset-0 opacity-20 pointer-events-none platform-thermal-grid" aria-hidden />
      <p className="font-anton text-4xl md:text-5xl tracking-wide text-white/90 mb-4 relative z-10">
        {title}
      </p>
      <p className="font-mono text-sm text-sky-100 max-w-md mx-auto leading-relaxed relative z-10">
        {description}
      </p>
    </div>
  );
}
