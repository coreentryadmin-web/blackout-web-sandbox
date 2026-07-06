"use client";

type Props = {
  label: string;
  action?: { label: string; onClick: () => void };
};

/** Mono section label — consistent hierarchy across native tool pages. */
export function IosSectionHeader({ label, action }: Props) {
  return (
    <div className="ios-section-header">
      <p className="ios-section-header-label">{label}</p>
      {action ? (
        <button type="button" className="ios-section-header-action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
