"use client";



import { useEffect, useMemo, useRef, useState } from "react";

import { motion, AnimatePresence } from "framer-motion";

import { clsx } from "clsx";

import type { ApiCallEvent } from "@/lib/api-telemetry-types";
import { incidentDedupeKey, isFeedableIncident } from "@/lib/api-telemetry-types";



type FeedGroup = {

  key: string;

  event: ApiCallEvent;

  count: number;

};



type RetryRow = {

  correlation_id: string;

  endpoint: string;

  provider: string;

  attempt: number;

  max_attempts: number;

  next_retry_at: string | null;

  last_error: string | null;

  started_at?: string;

};



function fmtRel(iso: string): string {

  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);

  if (sec < 5) return "just now";

  if (sec < 60) return `${sec}s ago`;

  return `${Math.floor(sec / 60)}m ago`;

}



function statusLabel(event: ApiCallEvent): string {

  if (event.sla_breach) return "SLA";

  if (event.ok) return "OK";

  if (event.rate_limited) return "429";

  if (event.status) return String(event.status);

  return "ERR";

}



function severityClass(event: ApiCallEvent): string {

  if (event.sla_breach && event.ok) return "admin-cmd-incident-p3 admin-cmd-incident-sla";

  if (event.severity === "p1") return "admin-cmd-incident-p1";

  if (event.severity === "p2") return "admin-cmd-incident-p2";

  return "admin-cmd-incident-p3";

}



function pushGrouped(prev: FeedGroup[], event: ApiCallEvent): FeedGroup[] {

  const key = incidentDedupeKey(event);

  if (prev.length > 0 && prev[0].key === key) {

    return [{ key, event, count: prev[0].count + 1 }, ...prev.slice(1)];

  }

  return [{ key, event, count: 1 }, ...prev].slice(0, 40);

}



function groupErrors(events: ApiCallEvent[]): FeedGroup[] {

  return events.reduce<FeedGroup[]>((acc, event) => pushGrouped(acc, event), []);

}



export function AdminApiLiveFeed({

  initialErrors,

  activeRetries,

  selectedId,

  onSelect,

}: {

  initialErrors: ApiCallEvent[];

  activeRetries: RetryRow[];

  selectedId: string | null;

  onSelect: (id: string) => void;

}) {

  const [groups, setGroups] = useState<FeedGroup[]>(() => groupErrors(initialErrors));

  const [liveRetries, setLiveRetries] = useState(activeRetries);

  const [connected, setConnected] = useState(false);

  const seen = useRef(new Set(initialErrors.map((e) => e.id)));

  const lastSeqRef = useRef(0);



  useEffect(() => {

    setGroups(groupErrors(initialErrors));

    initialErrors.forEach((e) => seen.current.add(e.id));

    for (const e of initialErrors) {

      if (e.seq_id > lastSeqRef.current) lastSeqRef.current = e.seq_id;

    }

  }, [initialErrors]);



  useEffect(() => {

    setLiveRetries(activeRetries);

  }, [activeRetries]);



  useEffect(() => {

    let es: EventSource | null = null;

    let retryTimer: ReturnType<typeof setTimeout> | null = null;



    const connect = () => {

      es?.close();

      const streamUrl =
        lastSeqRef.current > 0
          ? `/api/admin/apis/stream?since_seq=${lastSeqRef.current}`
          : "/api/admin/apis/stream";

      es = new EventSource(streamUrl);

      es.onopen = () => setConnected(true);

      es.onerror = () => {

        setConnected(false);

        es?.close();

        retryTimer = setTimeout(connect, 3000);

      };



      es.onmessage = (msg) => {

        try {

          const data = JSON.parse(msg.data) as {

            type: string;

            event?: ApiCallEvent;

            active_retries?: RetryRow[];

            recent_errors?: ApiCallEvent[];

          };



          if (msg.lastEventId) {

            const seq = Number.parseInt(msg.lastEventId, 10);

            if (!Number.isNaN(seq)) lastSeqRef.current = Math.max(lastSeqRef.current, seq);

          }



          if (data.type === "snapshot" && Array.isArray(data.recent_errors)) {

            const fresh = data.recent_errors.filter((e) => !seen.current.has(e.id));

            fresh.forEach((e) => seen.current.add(e.id));

            if (fresh.length) setGroups((prev) => fresh.reduce((acc, e) => pushGrouped(acc, e), prev));

          }



          if (data.type === "event" && data.event) {

            const ev = data.event;

            if (ev.seq_id > lastSeqRef.current) lastSeqRef.current = ev.seq_id;

            if (isFeedableIncident(ev) && !seen.current.has(ev.id)) {

              seen.current.add(ev.id);

              setGroups((prev) => pushGrouped(prev, ev));

            }

          }



          if (data.active_retries) {
            setLiveRetries(data.active_retries);
          }

        } catch {

          /* ignore */

        }

      };

    };



    connect();



    return () => {

      if (retryTimer) clearTimeout(retryTimer);

      es?.close();

    };

  }, []);



  const urgentRetries = useMemo(

    () => liveRetries.filter((r) => r.attempt >= Math.max(2, r.max_attempts - 1)),

    [liveRetries]

  );



  return (

    <aside className="admin-cmd-feed">

      <div className="admin-cmd-feed-head">

        <div>

          <p className="admin-cmd-feed-kicker">Live incidents</p>

          <h3 className="admin-cmd-feed-title">Failures & SLA</h3>

        </div>

        <span className={clsx("admin-cmd-stream-pill", connected && "admin-cmd-stream-pill-live")}>

          <span className="admin-cmd-stream-dot" />

          {connected ? "SSE live" : "Reconnecting…"}

        </span>

      </div>



      {liveRetries.length > 0 && (

        <div className={clsx("admin-cmd-retry-banner", urgentRetries.length > 0 && "admin-cmd-retry-banner-urgent")}>

          <p className="admin-cmd-retry-title">Active retries</p>

          {liveRetries.map((r) => (

            <div

              key={r.correlation_id}

              className={clsx(

                "admin-cmd-retry-row",

                r.attempt >= Math.max(2, r.max_attempts - 1) && "admin-cmd-retry-row-urgent"

              )}

            >

              <span className="admin-cmd-retry-spin" aria-hidden />

              <span className="admin-cmd-retry-provider">{r.provider}</span>

              <code className="admin-api-mono">{r.endpoint}</code>

              <span className="admin-cmd-retry-meta">

                {r.attempt}/{r.max_attempts}

                {r.next_retry_at && ` · next ${fmtRel(r.next_retry_at)}`}

              </span>

            </div>

          ))}

        </div>

      )}



      <div className="admin-cmd-feed-list">

        <AnimatePresence initial={false}>

          {groups.length === 0 ? (

            <p className="admin-api-muted admin-cmd-feed-empty">No incidents in window — all clear.</p>

          ) : (

            groups.map((group) => (

              <motion.button

                key={`${group.key}-${group.event.id}`}

                type="button"

                layout

                initial={{ opacity: 0, x: -12, scale: 0.98 }}

                animate={{ opacity: 1, x: 0, scale: 1 }}

                exit={{ opacity: 0, height: 0 }}

                transition={{ type: "spring", stiffness: 420, damping: 32 }}

                className={clsx(

                  "admin-cmd-incident",

                  severityClass(group.event),

                  selectedId === group.event.id && "admin-cmd-incident-active"

                )}

                onClick={() => onSelect(group.event.id)}

              >

                <div className="admin-cmd-incident-top">

                  <span className={clsx("admin-cmd-status", group.event.severity === "p2" && "admin-cmd-status-warn")}>

                    {group.event.severity.toUpperCase()} · {statusLabel(group.event)}

                  </span>

                  <span className="admin-cmd-incident-provider">{group.event.provider}</span>

                  {group.count > 1 && (

                    <span className="admin-cmd-incident-count">×{group.count}</span>

                  )}

                  <span className="admin-cmd-incident-time">{fmtRel(group.event.at)}</span>

                </div>

                <code className="admin-cmd-incident-path">{group.event.endpoint}</code>

                <p className="admin-cmd-incident-error">{group.event.error ?? "Request failed"}</p>

                {group.event.retry_status !== "none" && (

                  <span className="admin-cmd-incident-retry">

                    Retry {group.event.retry_status} · attempt {group.event.attempt}/{group.event.max_attempts}

                  </span>

                )}

              </motion.button>

            ))

          )}

        </AnimatePresence>

      </div>

    </aside>

  );

}


