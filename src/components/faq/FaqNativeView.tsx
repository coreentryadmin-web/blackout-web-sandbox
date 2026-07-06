"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FAQ_CATEGORIES,
  FAQ_ITEMS,
  FAQ_SUPPORT_EMAIL,
  type FaqCatKey,
} from "@/lib/faq/content";
import { IosNativeChipRail } from "@/components/ios/IosNativeChipRail";

/** Native iOS FAQ — vertical category rail + accordion (no horizontal bento pan). */
export function FaqNativeView() {
  const [cat, setCat] = useState<FaqCatKey>("platform");
  const [openId, setOpenId] = useState<string | null>(FAQ_ITEMS[0]?.id ?? null);

  const items = FAQ_ITEMS.filter((f) => f.catKey === cat);

  const open = useCallback((id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`);
    }
  }, []);

  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (!h || !FAQ_ITEMS.some((f) => f.id === h)) return;
    const item = FAQ_ITEMS.find((f) => f.id === h)!;
    setCat(item.catKey);
    setOpenId(h);
  }, []);

  return (
    <div className="faq-native-view">
      <IosNativeChipRail
        ariaLabel="FAQ categories"
        value={cat}
        onChange={(id) => {
          const next = id as FaqCatKey;
          setCat(next);
          const first = FAQ_ITEMS.find((f) => f.catKey === next);
          if (first) setOpenId(first.id);
        }}
        chips={FAQ_CATEGORIES.map((c) => ({ id: c.key, label: c.label }))}
        className="faq-native-cat-rail"
      />

      <div className="faq-native-list" role="list">
        {items.map((f) => {
          const expanded = openId === f.id;
          return (
            <div key={f.id} className="faq-native-item" role="listitem">
              <button
                type="button"
                id={`faq-q-${f.id}`}
                className="faq-native-question"
                aria-expanded={expanded}
                aria-controls={`faq-a-${f.id}`}
                onClick={() => open(f.id)}
              >
                <span className="faq-native-question-text">{f.q}</span>
                <span className="faq-native-chevron" aria-hidden>
                  {expanded ? "−" : "+"}
                </span>
              </button>
              {expanded ? (
                <div
                  id={`faq-a-${f.id}`}
                  role="region"
                  aria-labelledby={`faq-q-${f.id}`}
                  className="faq-native-answer"
                >
                  {f.a}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="faq-native-support">
        <p className="faq-native-support-label">Need a human?</p>
        <p className="faq-native-support-copy">Reach the desk directly.</p>
        <a href={`mailto:${FAQ_SUPPORT_EMAIL}`} className="faq-native-support-btn">
          {FAQ_SUPPORT_EMAIL}
        </a>
      </div>
    </div>
  );
}
