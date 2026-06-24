"use client";

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { clsx } from "clsx";

/**
 * Accessible tabs — WAI-ARIA Authoring Practices "Tabs" pattern.
 *
 * Compound API (mirrors the Table primitive's compound style):
 *
 *   <Tabs defaultValue="ops">
 *     <TabList aria-label="Sections">
 *       <Tab value="ops">Operations</Tab>
 *       <Tab value="apis">API Command</Tab>
 *     </TabList>
 *     <TabPanels>
 *       <TabPanel value="ops"><OpsView /></TabPanel>
 *       <TabPanel value="apis"><ApiView /></TabPanel>
 *     </TabPanels>
 *   </Tabs>
 *
 * Controlled (`value` + `onValueChange`) or uncontrolled (`defaultValue`).
 *
 * Accessibility:
 *  - TabList is role="tablist" aria-orientation="horizontal".
 *  - Each Tab is role="tab" with aria-selected, aria-controls (panel id) and a stable id.
 *  - Each TabPanel is role="tabpanel" aria-labelledby (tab id) tabIndex={0}.
 *  - Roving tabindex: only the active tab is tabIndex={0}; the rest are tabIndex={-1}.
 *  - ArrowLeft / ArrowRight move selection (wrapping); Home / End jump to first / last.
 *    Moving with the keyboard both selects and focuses the target tab.
 *
 * Styling: design-system default (sky/bull accent underline, glass rail, no grey).
 * Every part accepts `className` so callers (e.g. the admin tab bar) can fully re-skin
 * while keeping the a11y wiring. Pass `unstyled` on TabList/Tab to drop the default
 * chrome entirely and theme purely via `className`.
 */

type TabsContextValue = {
  /** Currently selected tab value. */
  value: string;
  /** Select a tab (updates uncontrolled state and/or fires onValueChange). */
  select: (value: string) => void;
  /** Stable id namespace so tab/panel ids pair up (`${baseId}-tab-${value}` etc.). */
  baseId: string;
  /** Ordered list of registered tab values — drives Arrow/Home/End navigation. */
  register: (value: string) => void;
  unregister: (value: string) => void;
  orderRef: React.MutableRefObject<string[]>;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(part: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`<${part}> must be rendered inside <Tabs>.`);
  }
  return ctx;
}

const tabId = (baseId: string, value: string) => `${baseId}-tab-${value}`;
const panelId = (baseId: string, value: string) => `${baseId}-panel-${value}`;

export type TabsProps = {
  /** Controlled selected value. */
  value?: string;
  /** Initial selected value in uncontrolled mode. */
  defaultValue?: string;
  /** Fired whenever a tab is selected (both controlled + uncontrolled). */
  onValueChange?: (value: string) => void;
  className?: string;
  children?: React.ReactNode;
};

export function Tabs({
  value: controlledValue,
  defaultValue,
  onValueChange,
  className,
  children,
}: TabsProps) {
  const reactId = useId();
  const orderRef = useRef<string[]>([]);
  const [uncontrolled, setUncontrolled] = useState<string>(defaultValue ?? "");

  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : uncontrolled;

  const select = useCallback(
    (next: string) => {
      if (!isControlled) setUncontrolled(next);
      onValueChange?.(next);
    },
    [isControlled, onValueChange]
  );

  const register = useCallback((v: string) => {
    if (!orderRef.current.includes(v)) orderRef.current.push(v);
  }, []);

  const unregister = useCallback((v: string) => {
    orderRef.current = orderRef.current.filter((x) => x !== v);
  }, []);

  const ctx = useMemo<TabsContextValue>(
    () => ({ value, select, baseId: reactId, register, unregister, orderRef }),
    [value, select, reactId, register, unregister]
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export type TabListProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Drop the default rail chrome; theme entirely via className. */
  unstyled?: boolean;
};

export const TabList = forwardRef<HTMLDivElement, TabListProps>(function TabList(
  { unstyled = false, className, children, onKeyDown, ...rest },
  ref
) {
  const { value, select, orderRef } = useTabsContext("TabList");

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;

    const order = orderRef.current;
    if (order.length === 0) return;
    const current = order.indexOf(value);

    let nextIndex: number | null = null;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = current < 0 ? 0 : (current + 1) % order.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = current < 0 ? order.length - 1 : (current - 1 + order.length) % order.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = order.length - 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    const nextValue = order[nextIndex];
    select(nextValue);
    // Move DOM focus to the newly-selected tab (roving tabindex follows selection).
    const list = e.currentTarget;
    const nextTab = list.querySelector<HTMLElement>(`[role="tab"][data-value="${nextValue}"]`);
    nextTab?.focus();
  };

  return (
    <div
      ref={ref}
      role="tablist"
      aria-orientation="horizontal"
      className={clsx(
        !unstyled &&
          "flex items-center gap-1 rounded-xl border border-white/10 bg-[rgba(8,9,14,0.4)] p-1 backdrop-blur",
        className
      )}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {children}
    </div>
  );
});

export type TabProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "value" | "onSelect"
> & {
  /** The value this tab selects — must match a TabPanel value. */
  value: string;
  /** Drop the default pill/underline chrome; theme entirely via className. */
  unstyled?: boolean;
};

export const Tab = forwardRef<HTMLButtonElement, TabProps>(function Tab(
  { value, unstyled = false, className, children, onClick, disabled, ...rest },
  ref
) {
  const { value: selected, select, baseId, register, unregister } = useTabsContext("Tab");

  // Register this tab so Arrow/Home/End can traverse it; clean up on unmount.
  useEffect(() => {
    register(value);
    return () => unregister(value);
  }, [value, register, unregister]);

  const isActive = selected === value;

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={tabId(baseId, value)}
      data-value={value}
      aria-selected={isActive}
      aria-controls={panelId(baseId, value)}
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented && !disabled) select(value);
      }}
      className={clsx(
        !unstyled && [
          "relative inline-flex select-none items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold " +
            "outline-none transition-colors duration-150 " +
            "focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-void " +
            "disabled:pointer-events-none disabled:opacity-40",
          isActive
            ? "text-white"
            : "text-sky-300 hover:text-white hover:bg-white/[0.05]",
        ],
        className
      )}
      {...rest}
    >
      {children}
      {/* default active underline — sky→bull accent, no grey */}
      {!unstyled && (
        <span
          aria-hidden
          className={clsx(
            "pointer-events-none absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-opacity duration-150",
            "bg-gradient-to-r from-sky-400 to-bull shadow-[0_0_12px_rgba(0,230,118,0.5)]",
            isActive ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </button>
  );
});

export type TabPanelsProps = React.HTMLAttributes<HTMLDivElement>;

export const TabPanels = forwardRef<HTMLDivElement, TabPanelsProps>(function TabPanels(
  { className, children, ...rest },
  ref
) {
  return (
    <div ref={ref} className={clsx("mt-3", className)} {...rest}>
      {children}
    </div>
  );
});

export type TabPanelProps = React.HTMLAttributes<HTMLDivElement> & {
  /** The value that activates this panel — must match a Tab value. */
  value: string;
  /** Keep the panel mounted (but hidden) when inactive. Defaults to false (unmount). */
  keepMounted?: boolean;
};

export const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(function TabPanel(
  { value, keepMounted = false, className, children, ...rest },
  ref
) {
  const { value: selected, baseId } = useTabsContext("TabPanel");
  const isActive = selected === value;

  if (!isActive && !keepMounted) return null;

  return (
    <div
      ref={ref}
      role="tabpanel"
      id={panelId(baseId, value)}
      aria-labelledby={tabId(baseId, value)}
      tabIndex={0}
      hidden={!isActive}
      className={clsx("outline-none focus-visible:ring-2 focus-visible:ring-sky-400", className)}
      {...rest}
    >
      {children}
    </div>
  );
});
