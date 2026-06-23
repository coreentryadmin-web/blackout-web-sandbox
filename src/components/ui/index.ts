/**
 * BlackOut UI primitive library.
 *
 * Shared, reusable building blocks for the in-app tools redesign. Glassmorphism,
 * emerald glow, no grey — consume these instead of hand-rolling per-tool chrome.
 *
 * NOTE: these are not yet adopted across the app; that's a later batch.
 */

export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

export { Card } from "./Card";
export type { CardProps, CardAccent } from "./Card";

export { Panel, PanelHeader } from "./Panel";
export type { PanelProps, PanelHeaderProps, PanelAccent } from "./Panel";

export { Stat } from "./Stat";
export type { StatProps, StatTone, DeltaTone } from "./Stat";

export { Badge } from "./Badge";
export type { BadgeProps, BadgeTone, BadgeSize } from "./Badge";

export { Table, THead, TBody, TR, TH, TD } from "./Table";
export type {
  TableProps,
  THeadProps,
  TBodyProps,
  TRProps,
  THProps,
  TDProps,
} from "./Table";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

export { Skeleton } from "./Skeleton";
export type { SkeletonProps } from "./Skeleton";

export { PageShell } from "./PageShell";
export type { PageShellProps } from "./PageShell";

export { PageHeader } from "./PageHeader";
export type { PageHeaderProps } from "./PageHeader";

export { Kicker } from "./Kicker";
export type { KickerProps } from "./Kicker";

export { Modal, Drawer } from "./Modal";
export type { ModalProps, ModalSide, ModalSize, DrawerProps } from "./Modal";
