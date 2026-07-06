"use client";

import { clsx } from "clsx";

export type IosNativeChip = {
  id: string;
  label: string;
};

type Props = {
  chips: IosNativeChip[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  className?: string;
};

/** Horizontal chip rail — one pattern for watchlists, FAQ categories, filters. */
export function IosNativeChipRail({
  chips,
  value,
  onChange,
  ariaLabel = "Filter",
  className,
}: Props) {
  return (
    <nav className={clsx("ios-native-chip-rail", className)} aria-label={ariaLabel}>
      <div className="ios-native-chip-scroll" role="list">
        {chips.map((chip) => {
          const active = value === chip.id;
          return (
            <button
              key={chip.id || "__all"}
              type="button"
              role="listitem"
              className={clsx("ios-native-chip", active && "ios-native-chip-active")}
              aria-pressed={active}
              onClick={() => onChange(chip.id)}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
