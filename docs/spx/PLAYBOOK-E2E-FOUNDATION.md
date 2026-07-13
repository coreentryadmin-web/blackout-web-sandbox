# SPX Slayer — Playbook End-to-End Foundation

**Status:** Target architecture designed; **hybrid on staging** (14 shadow matchers; full fidelity on PB-01–04, 08).  
**Staging policy:** playbook live gate **always on** when `isStagingDeploy()` — not env-toggleable.  
**Narrative deep dive:** `docs/spx/PLAYBOOK-ARCHITECTURE-DEEP-DIVE.md`  
**Rule-level spec:** `docs/spx/PLAYBOOK-FULL-SPEC-v2.md`  
**This file:** flowcharts + build vs gap map for agents and RTH validation.

---

## 1. Honest answer: is it fully designed end-to-end?

| Layer | Designed? | Built? | Notes |
|-------|-----------|--------|-------|
| Named playbooks PB-01…14 | Yes | Yes (shadow matchers all 14; full fidelity 01–04, 08) | Registry + matcher |
| Regime Router | Yes | Yes (MVP) | `playbook-regime-router.ts` |
| Matcher (preconditions / trigger) | Yes | Yes (bar-fidelity MVP) | OR / VWAP streaks / EMA9 |
| Safety gates (halt, stale, session…) | Yes (as-built) | Yes | Still global AND |
| **Play state machine** IDLE→ARMED→… | Yes | **No** | Still legacy SCANNING/WATCH/BUY |
| **Playbook-only confluence checklist** | Yes | **No** | Still global factor soup |
| BUY = playbook trigger | Yes | **Flagged** | `PLAYBOOK_LIVE_GATE=1` (default off) |
| `playbook_id` on outcomes | Yes | Yes (column) | Needs RTH volume to prove |
| Watch key = playbook instance | Yes | **No** | Still `0dte:{dir}:{date}` |
| Largo narrates playbook | Partial | Partial | Intel edges in; not full PB state |
| Kill lotto / power as parallel BUY | Open decision | No | Still parallel paths |

**Verdict:** The *target* end-to-end flow is designed. The *running* system is still **hybrid**: legacy confluence BUY + shadow/ARM playbook overlay. Full playbook-first E2E = state machine + checklist + live gate on by default.

---

## 2. Target E2E (foundation) — one tick

```mermaid
flowchart TD
  subgraph IN["Inputs every ~3s play poll"]
    D[Desk payload<br/>spot / walls / flow / regime]
    T[Technicals<br/>OR / VWAP streaks / EMA9]
    X[Cross-tool<br/>NH / HELIX / halt / VIX]
  end

  subgraph SAFETY["Layer A — Safety gates GLOBAL AND"]
    G1{Halt / stale / session<br/>cooldown / VIX / macro?}
  end

  subgraph REGIME["Layer B — Regime Router"]
    R[Classify bucket<br/>trend_bull / weak / opening_drive / …]
    E[Eligible playbook set<br/>subset of registry]
  end

  subgraph MATCH["Layer C — Matcher"]
    M[Score preconditions<br/>per eligible PB]
    P[Pick PRIMARY<br/>registry-order tie-break]
  end

  subgraph STATE["Layer D — Playbook state machine TARGET"]
    S0[IDLE]
    S1[ARMED / WATCH]
    S2[TRIGGERED]
    S3[OPEN]
    S4[MANAGING]
    S5[CLOSED + playbook_id]
  end

  subgraph UI["Trade Alerts UI"]
    W[Watch box = primary ARMED]
    O[Open box = OPEN/MANAGING]
    C[Confluence = checklist<br/>for primary PB only]
  end

  D --> G1
  T --> M
  X --> G1
  D --> R
  G1 -->|fail| BLOCK[No new BUY<br/>may still WATCH]
  G1 -->|pass| R
  R --> E --> M --> P
    P -->|preconditions met| S1
    P -->|trigger fired| S2
    S2 -->|gates pass| S3 --> S4 --> S5
    S1 --> W
    S3 --> O
    P --> C
```

**Primary selection:** explicit `PRIMARY_PRIORITY` in `playbook-shadow-matcher.ts` (FULL-SPEC §5) — not registry array order.

**Decision rule (target):**

```text
BUY  ⇔  primary_playbook.trigger_fired
      AND  safety_gates.pass
      AND  (optional) playbook checklist OK

NOT:  confluence_score >= threshold alone
```

---

## 3. As-built today (hybrid) — what actually runs

```mermaid
flowchart TD
  D[Desk + Technicals] --> CONF[computeSpxConfluence<br/>global factor soup]
  D --> SHADOW[matchPlaybooksShadow<br/>+ regime filter]
  CONF --> GATES[evaluatePlayGates]
  SHADOW --> PANEL[playbook_shadow panel<br/>ARM UI / terminal]
  SHADOW -.->|if PLAYBOOK_LIVE_GATE=1| GATES
  GATES --> ENG[evaluateSpxPlay<br/>SCANNING / WATCH / BUY]
  ENG -->|BUY| OPEN[openPlay + playbook_id?]
  ENG --> LOG[logPlaybookShadowMatch<br/>always fire-and-forget]
  PANEL --> UI[Trade Alerts Watch chip<br/>Playbook terminal]
```

**Key gap:** state machine and playbook checklist are **not** driving the engine yet. Shadow tells you what *would* be primary; legacy score still owns BUY unless the live flag is on.

---

## 4. Layered decision model (AND / OR)

```mermaid
flowchart LR
  subgraph AND_STACK["All must pass for BUY"]
    A[Safety gates]
    B[Primary PB trigger]
    C[Direction agrees<br/>call/put from PB]
  end

  subgraph OR_SOFT["Soft / tie-break only"]
    S[Legacy confluence score]
    L[Largo narrative]
    N[Night Hawk prior]
  end

  AND_STACK --> BUY[BUY]
  OR_SOFT -.->|inform / rank| BUY
```

- **Calls vs puts:** not separate playbooks. Direction is an **output** of the matched playbook (PB-01 reclaim→long, reject→short, etc.).
- **Confluence:** target = checklist for *active* PB only (AND of that PB’s remaining conditions). Today = weighted soup (OR-ish additive).

---

## 5. Playbook state machine (target)

```mermaid
stateDiagram-v2
  [*] --> IDLE
  IDLE --> ARMED: preconditions_match<br/>and regime_eligible
  ARMED --> IDLE: invalidation / regime flip
  ARMED --> TRIGGERED: trigger_fired
  TRIGGERED --> OPEN: safety gates pass
  TRIGGERED --> ARMED: gate block / wait
  TRIGGERED --> IDLE: invalidation
  OPEN --> MANAGING: trail / trim rules
  MANAGING --> CLOSED: STOP / TARGET / THESIS / SESSION
  OPEN --> CLOSED: hard exit
  CLOSED --> [*]
```

**UI mapping**

| State | Box |
|-------|-----|
| ARMED | Watch |
| OPEN / MANAGING | Open |
| CLOSED | Track record / telemetry |

---

## 6. Friday RTH validation path (today)

```mermaid
flowchart TD
  M[Merge PR #758 → staging] --> DEP[ECS deploy staging]
  DEP --> F0[Flag OFF<br/>PLAYBOOK_LIVE_GATE unset]
  F0 --> OBS[RTH observe 09:30–close]
  OBS --> A[Playbook terminal shows<br/>PB-01/02/03 + regime]
  OBS --> B[Shadow log rows<br/>playbook_pb_*_match]
  OBS --> C[Compare shadow primary<br/>vs legacy BUY/WATCH]
  C --> DEC{Shadow agrees<br/>with good trades?}
  DEC -->|yes next session| LIVE[Consider LIVE_GATE=1<br/>staging only]
  DEC -->|noisy| FIX[Tighten matcher / regime<br/>before live gate]
```

**Do not** turn on `PLAYBOOK_LIVE_GATE` on prod Friday. Staging shadow-first is the foundation test.

---

## 7. Build order (foundation → complete E2E)

```mermaid
flowchart LR
  P1[Phase 1 Shadow matcher] --> P2[Phase 2 ARM UI]
  P2 --> P2b[Matcher fidelity + regime]
  P2b --> P3[Phase 3 LIVE_GATE flag]
  P3 --> P4[playbook_id telemetry]
  P4 --> P5[State machine module]
  P5 --> P6[PB checklist replaces soup]
  P6 --> P7[Watch key = PB instance]
  P7 --> P8[PB-04…12 evidence-gated]
```

| Phase | Done? |
|-------|-------|
| 1 Shadow | Yes |
| 2 ARM UI | Yes |
| 2b Fidelity + regime | Yes (#758) |
| 3 Live gate flag | Yes (off by default) |
| 4 playbook_id column | Yes |
| 5 State machine | **Next foundation gap** |
| 6 Checklist confluence | Open |
| 7 Watch key | Open |
| 8 PB evidence per-PB promotion | Open (shadow accumulating) |

---

## 8. Single-playbook example (PB-01 VWAP Reclaim)

```mermaid
flowchart TD
  R{Regime eligible?<br/>trend_bull / recovery / opening_drive}
  R -->|no| X[Skip PB-01]
  R -->|yes| W{Session 09:45–14:00?}
  W -->|no| X2[No trigger]
  W -->|yes| PRE{Below VWAP ≥15m<br/>or above_vwap=false<br/>+ EMA9 curl ≠ false}
  PRE -->|no| ARM_WAIT[Not ARMED]
  PRE -->|yes| ARM[ARMED]
  ARM --> TRG{≥2× 3m closes above VWAP<br/>OR vwap_reclaim<br/>+ flow not bearish}
  TRG -->|no| ARM
  TRG -->|yes| FIRE[TRIGGERED long]
  FIRE --> G{Safety gates}
  G -->|pass + LIVE_GATE| BUY[BUY + playbook_id=PB-01]
  G -->|fail| HOLD[Hold ARMED / WATCH]
```

---

## Related code

- Registry: `src/features/spx/lib/playbook-registry.ts`
- Regime: `src/features/spx/lib/playbook-regime-router.ts`
- Matcher: `src/features/spx/lib/playbook-shadow-matcher.ts`
- Panel / ARM: `src/features/spx/lib/playbook-shadow-panel.ts`
- Live flag: `playbookLiveGateEnabled()` in `spx-play-config.ts`
- Gate hook: `evaluatePlayGates` + `evaluateFlatPlay` in engine
