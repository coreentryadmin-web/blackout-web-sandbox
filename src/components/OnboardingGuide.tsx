"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { Modal } from "@/components/ui";
import {
  ONBOARDING_STEPS,
  OPTIONS_GLOSSARY,
  ONBOARDING_OPEN_EVENT,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_VERSION,
  isOnboardingComplete,
  completedStorageValue,
  clampStepIndex,
  isFirstStep,
  isLastStep,
} from "@/lib/onboarding-content";

type View = "tour" | "glossary";

/**
 * Global, dismissible first-run onboarding + options-education modal.
 * Mounted once in the root layout; renders nothing until opened.
 * Auto-opens once per onboarding version for signed-in users; reopenable
 * via the ONBOARDING_OPEN_EVENT window event (see OnboardingTrigger).
 */
export function OnboardingGuide() {
  const { isSignedIn, isLoaded } = useAuth();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("tour");
  const [step, setStep] = useState(0);

  const total = ONBOARDING_STEPS.length;
  const persist = useCallback(() => {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, completedStorageValue());
    } catch {
      /* storage may be unavailable (private mode) — non-fatal */
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    persist();
  }, [persist]);

  // Auto-open once per version for signed-in first-run users.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (!isOnboardingComplete(stored, ONBOARDING_VERSION)) {
      setView("tour");
      setStep(0);
      setOpen(true);
    }
  }, [isLoaded, isSignedIn]);

  // Manual (re)open from the Learn trigger.
  useEffect(() => {
    const onOpen = () => {
      setView("tour");
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(ONBOARDING_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ONBOARDING_OPEN_EVENT, onOpen);
  }, []);

  const current = ONBOARDING_STEPS[clampStepIndex(step, total)];
  const first = isFirstStep(step);
  const last = isLastStep(step, total);

  const tabs = (
    <div className="onboarding-tabs">
      <button
        type="button"
        className={clsx("onboarding-tab", view === "tour" && "onboarding-tab-active")}
        onClick={() => setView("tour")}
      >
        Quick Tour
      </button>
      <button
        type="button"
        className={clsx("onboarding-tab", view === "glossary" && "onboarding-tab-active")}
        onClick={() => setView("glossary")}
      >
        Options 101
      </button>
    </div>
  );

  return (
    <Modal open={open} onClose={close} title={tabs} className="onboarding-modal">
      {view === "tour" ? (
              <div className="onboarding-body">
                <p className="onboarding-kicker">{current.kicker}</p>
                <h2 id="onboarding-title" className="onboarding-title">
                  {current.title}
                </h2>
                <p className="onboarding-text">{current.body}</p>

                {current.href && current.cta && (
                  <Link href={current.href} className="onboarding-deeplink" onClick={close}>
                    {current.cta} →
                  </Link>
                )}

                <div className="onboarding-progress" aria-hidden>
                  {ONBOARDING_STEPS.map((s, i) => (
                    <span
                      key={s.id}
                      className={clsx("onboarding-dot", i === step && "onboarding-dot-active")}
                    />
                  ))}
                </div>

                <div className="onboarding-actions">
                  <button
                    type="button"
                    className="onboarding-btn-ghost"
                    onClick={() => (first ? close() : setStep((s) => s - 1))}
                  >
                    {first ? "Skip" : "Back"}
                  </button>
                  <button
                    type="button"
                    className="onboarding-btn-primary"
                    onClick={() => (last ? close() : setStep((s) => s + 1))}
                  >
                    {last ? "Get started" : "Next"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="onboarding-body">
                <p className="onboarding-kicker">Options basics</p>
                <h2 className="onboarding-title">Options 101</h2>
                <dl className="onboarding-glossary">
                  {OPTIONS_GLOSSARY.map((g) => (
                    <div key={g.term} className="onboarding-glossary-row">
                      <dt className="onboarding-glossary-term">{g.term}</dt>
                      <dd className="onboarding-glossary-def">{g.def}</dd>
                    </div>
                  ))}
                </dl>
                <p className="onboarding-disclaimer">
                  Educational only — not financial advice. You execute every trade on your own broker.
                </p>
                <div className="onboarding-actions">
                  <button type="button" className="onboarding-btn-ghost" onClick={() => setView("tour")}>
                    Back to tour
                  </button>
                  <button type="button" className="onboarding-btn-primary" onClick={close}>
                    Done
                  </button>
                </div>
              </div>
            )}
    </Modal>
  );
}
