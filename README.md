<div align="center">

# ✈️ ORBIS

### On-Time Ramp Buffer Intelligence System

**A decision-support platform that predicts aircraft turnaround buffer times using deterministic Monte-Carlo simulation — turning ramp uncertainty into a number a supervisor can act on.**

<br/>

<!-- ── live repo badges (auto-update from GitHub) ── -->

[![Last Commit](https://img.shields.io/github/last-commit/LeGeND212L/Airport-ORBIS-Prototype?style=for-the-badge&color=2563EB&logo=git&logoColor=white)](https://github.com/LeGeND212L/Airport-ORBIS-Prototype/commits/main)
[![Repo Size](https://img.shields.io/github/repo-size/LeGeND212L/Airport-ORBIS-Prototype?style=for-the-badge&color=1E3A8A)](https://github.com/LeGeND212L/Airport-ORBIS-Prototype)
[![Top Language](https://img.shields.io/github/languages/top/LeGeND212L/Airport-ORBIS-Prototype?style=for-the-badge&color=16A34A)](https://github.com/LeGeND212L/Airport-ORBIS-Prototype)
[![Stars](https://img.shields.io/github/stars/LeGeND212L/Airport-ORBIS-Prototype?style=for-the-badge&color=D97706&logo=github)](https://github.com/LeGeND212L/Airport-ORBIS-Prototype/stargazers)

<sub>🟢 badges above update live from GitHub · diagrams below render live on GitHub</sub>

<!-- ── static tech badges ── -->

![JavaScript](https://img.shields.io/badge/JavaScript-ES2020-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-semantic-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-hand--built-1572B6?style=flat-square&logo=css3&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)
![Charts](https://img.shields.io/badge/charts-hand--built%20SVG-8B5CF6?style=flat-square)
![Status](https://img.shields.io/badge/status-active%20prototype-2563EB?style=flat-square)

<br/>

[**Simulation Engine**](#-the-simulation-engine) · [**Modules**](#-modules-at-a-glance) · [**Architecture**](#-architecture) · [**Alert Model**](#-alert-escalation-model) · [**Demo Access**](#-demo-access)

</div>

---

## 📖 Overview

On the apron, a delayed pushback cascades into missed slots, crew-hour breaches and knock-on delays across the network. Supervisors decide **how much buffer** to add to a turnaround under heat, equipment shortages and passenger load — usually by gut feel.

**ORBIS replaces the guess with a defensible number.** For every flight it runs a **1,000-iteration Monte-Carlo simulation** over five operational risk variables and returns a recommended buffer, a full confidence band (P10 / P50 / P90), a risk classification (`GREEN` / `AMBER` / `RED`), the **dominant driver**, and a Target Off-Block Time (TOBT) — each one **reproducible to the exact digit**, because a disputed prediction must be _investigable_, not re-rolled.

> Built as a single, dependency-free front-end: **3 files, ~5,300 lines, zero libraries.** Every chart, gauge and distribution is hand-drawn SVG/canvas.

---

## 📑 Table of Contents

- [Key Features](#-key-features)
- [Modules at a Glance](#-modules-at-a-glance)
- [The Simulation Engine](#-the-simulation-engine)
- [Architecture](#-architecture)
- [Data & Learning Loop](#-data--learning-loop)
- [Alert Escalation Model](#-alert-escalation-model)
- [Tech Stack](#-tech-stack)
- [Demo Access](#-demo-access)
- [Project Structure](#-project-structure)
- [Storage Model](#-storage-model)
- [Engineering Highlights](#-engineering-highlights)
- [Roadmap](#-roadmap)
- [Author](#-author)

---

## ✨ Key Features

- 🔐 **Full auth stack** — login, request-access sign-up, corporate-email gate, password-strength enforcement, **5-digit MFA**, and 15-minute sliding session management.
- 🛡️ **Role-based access control** — six roles, per-user module permissions enforced **in the data layer**, not just hidden in the UI.
- 🧮 **Deterministic simulation engine** — seeded PRNG (mulberry32) + Box–Muller Gaussian sampling; _never_ touches the DOM, _never_ calls `Math.random()`.
- 📊 **Eight operational modules** — from a glare-readable ramp Flight Board to a super-admin calibration console.
- 🔔 **Live alert engine** — SMS → escalation → critical cascade with acknowledgement countdowns.
- 🌦️ **Degraded mode** — when the weather/DCS feed drops, flights fall back to cached inputs, get flagged, and _still_ produce a prediction.
- 📈 **Closed learning loop** — logged outcomes feed accuracy analytics and an MAE-minimising recalibration proposal.
- 🧾 **Append-only audit & versioning** — every consequential action is logged; weight versions are never overwritten.
- 🎨 **Production-grade polish** — count-up numbers, staggered entrances, skeleton shimmer, custom modals/toasts, full `prefers-reduced-motion` support.

---

## 🧭 Modules at a Glance

| #   | Module                   | Key           | What it does                                                                                                                              |
| --- | ------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| S2  | **Flight Board**         | `flightboard` | Risk-sorted turnaround cards (RED→AMBER→GREEN), glare-safe, live acknowledgement countdowns                                               |
| S3  | **Turnaround Detail**    | `turnaround`  | Buffer gauge, P10–P90 confidence band, 1,000-outcome histogram, driver breakdown, provenance & **reproducibility verifier**               |
| S4  | **GSE Entry**            | `gse`         | Shift-start ground-equipment availability with a live recalculation sequence across all pending flights                                   |
| S5  | **Off-Block Logging**    | `offblock`    | Captures actuals, computes signed prediction error, enforces delay-reason codes — closes the learning loop                                |
| S6  | **Manager Dashboard**    | `manager`     | KPI strip, escalation panel, risk donut, buffer timeline, integration health — with **airline-rep read-only scoping**                     |
| S7  | **Equipment Register**   | `equipment`   | GSE fleet management, maintenance logs, failure-probability, status-driven recalcs                                                        |
| S8  | **Weights & Thresholds** | `weights`     | Calibration console: live preview, **monotonicity self-check (T9)**, append-only version history + diff                                   |
| S9  | **Accuracy Analytics**   | `analytics`   | Predicted-vs-actual scatter, error distribution, per-supervisor accuracy (anonymised by default), recalibration proposal, CSV/JSON export |

---

## 🔬 The Simulation Engine

The engine is the heart of ORBIS — a **pure, isolated, arrays-in / numbers-out** module. That isolation is a requirement, not a preference: it is what makes every prediction auditable.

### 1 · Normalise five raw inputs to `[0,1]`

$$
v_1=\frac{T_{heat}-28}{55-28},\quad
v_2=1-\frac{gse_{avail}}{gse_{total}},\quad
v_3=p_{mtbf},\quad
v_4=\frac{load\%}{100},\quad
v_5=\frac{prm}{prm_{p95}}
$$

### 2 · Monte-Carlo — 1,000 deterministic iterations

A **mulberry32** PRNG is seeded from `hash(flightNumber + calculationTimestamp)`, then drives **Box–Muller** Gaussian draws. Same inputs → same seed → **bit-identical output on every reload.**

$$
s_{i,k}\sim \mathcal{N}(v_k,\ \sigma_k),\qquad
C_i=\sum_{k=1}^{5} s_{i,k}\cdot w_k
$$

$$
p_i=\frac{1}{1+e^{-10\,(C_i-0.5)}},\qquad
B_i = B_{base} + p_i \cdot B_{max}
$$

The engine returns **P10 / P50 / P90 / mean / std** over the 1,000 buffer samples, plus the seed and compute time.

### 3 · Attribution, classification & TOBT

$$
\text{share}_k=\frac{v_k w_k}{\sum_j v_j w_j},\qquad
\text{dominant}=\arg\max_k(\text{share}_k)
$$

| Condition                        | Risk         |
| -------------------------------- | ------------ |
| `P90 ≤ 30` **and** `spread < 6`  | 🟢 **GREEN** |
| `P90 ≤ 40` **and** `spread < 12` | 🟡 **AMBER** |
| otherwise                        | 🔴 **RED**   |

$$
\text{TOBT} = \text{EIBT} + \text{round}(P_{50})
$$

> **Guaranteed monotonic.** The built-in **T9 self-check** sweeps a sampled input grid and asserts the buffer _never decreases_ as any single variable rises — verified across **480 combinations with zero violations**. A hotter day can never produce a _shorter_ buffer.

---

## 🏗️ Architecture

```mermaid
flowchart TD
    subgraph Shell["🖥️ Permission-Driven App Shell"]
        NAV["Sidebar / bottom-tab nav<br/>(built from user.permissions)"]
        GUARD{"showModule()<br/>permission guard"}
    end

    subgraph Engine["🔬 Pure Simulation Engine (no DOM)"]
        PRNG["mulberry32 PRNG<br/>+ Box–Muller"]
        MC["1000x Monte-Carlo"]
        CALC["calculateFlightRisk()"]
    end

    subgraph Store["💾 localStorage"]
        F[("orbis_flights")]
        W[("orbis_weights<br/>append-only")]
        O[("orbis_outcomes")]
        A[("orbis_alerts")]
        G[("orbis_gse")]
    end

    NAV --> GUARD
    GUARD -->|allowed| M["8 Operational Modules"]
    GUARD -->|denied| DENY["Access-denied + redirect"]
    M --> CALC
    W --> CALC
    F --> CALC
    PRNG --> MC --> CALC
    CALC --> F
    M --> A
    M --> O
    M --> G
```

---

## 🔄 Data & Learning Loop

ORBIS is a closed loop: inputs drive predictions, predictions drive action, actuals are captured, and the captured error re-tunes the model.

```mermaid
flowchart LR
    IN["🌡️ Inputs<br/>heat · GSE · MTBF · load · PRM"] --> ENG["🔬 Engine"]
    ENG --> PRED["📊 Buffer + TOBT + Risk"]
    PRED --> BOARD["✈️ Flight Board<br/>(risk-sorted)"]
    BOARD --> ACT["✅ Acknowledge + Actions"]
    ACT --> OFF["⏱️ Off-Block Logging"]
    OFF --> OUT["📁 Outcomes<br/>(predicted vs actual)"]
    OUT --> ANL["📈 Accuracy Analytics"]
    ANL --> RECAL["⚖️ Recalibration<br/>(MAE-minimising)"]
    RECAL -->|new weight version| ENG
```

---

## 🚨 Alert Escalation Model

**In one sentence:** every `AMBER`/`RED` prediction starts a countdown; if nobody acknowledges it in time, ORBIS automatically pushes it up the chain — and a supervisor can **acknowledge at any moment to stop the clock**. RED alerts escalate about twice as fast as AMBER.

**The four stages** — an alert moves down this list only while it stays unacknowledged:

| Stage | RED fires at | AMBER fires at | What ORBIS does | Seen on |
| :---- | :----------: | :------------: | :-------------- | :------ |
| **1 · Issued** | 0 min | 0 min | Opens the alert, starts the live countdown | Flight Board |
| **2 · SMS sent** | 2 min | 5 min | Marks a reminder "SMS sent" | Flight Board |
| **3 · Escalated** | 5 min | 10 min | Raises it to the shift manager | Manager Dashboard |
| **4 · Critical** | unacked & < 30 min to arrival | unacked & < 30 min to arrival | Flags `UNACKNOWLEDGED_CRITICAL` in red | Manager Dashboard |
| **✅ Acknowledged** | any time | any time | Stops the clock, clears the outstanding count | everywhere |

Read the diagram **left → right**. The alert keeps moving right while it's ignored; the green paths show that **acknowledging at any stage sends it straight to “Cleared”**:

```mermaid
flowchart LR
    A["🔔 1. Issued<br/>countdown starts"] --> B["📩 2. SMS sent<br/>RED 2m · AMBER 5m"]
    B --> C["⛔ 3. Escalated<br/>RED 5m · AMBER 10m<br/>→ shift manager"]
    C --> D["🔴 4. Critical<br/>unacked · under 30m to arrival"]
    A -. acknowledge .-> OK(["✅ Cleared"])
    B -. acknowledge .-> OK
    C -. acknowledge .-> OK
    D -. acknowledge .-> OK
    linkStyle 3,4,5,6 stroke:#16A34A,stroke-width:1.5px,color:#16A34A
```

> ⏱️ **Demo note:** the timers are compressed so the whole cascade is visible in a short session — but the **stages and their order are exactly as shown**.

---

## 🛠️ Tech Stack

| Layer            | Choice                      | Notes                                                            |
| ---------------- | --------------------------- | ---------------------------------------------------------------- |
| **Language**     | Vanilla JavaScript (ES2020) | No frameworks, no build step                                     |
| **Styling**      | Hand-authored CSS           | Design tokens, dark-on-navy auth, `prefers-reduced-motion`       |
| **Charts**       | Hand-built SVG              | Gauges, donut, scatter, histograms, timelines — no chart library |
| **Persistence**  | `localStorage`              | Nine namespaced keys, append-only where it matters               |
| **Dependencies** | **None**                    | Only Google Fonts (Inter + IBM Plex Mono)                        |

---

## 🔑 Demo Access

> 💡 On first load ORBIS auto-seeds demo users, 10 flights, a full GSE fleet, weight versions and ~56 historical outcomes — so every screen is alive immediately.

**MFA code for all accounts:** `12345`

| Role                           | Username / Email            | Password     | Lands on                              |
| ------------------------------ | --------------------------- | ------------ | ------------------------------------- |
| 🛠️ System Administrator        | `admin`                     | `admin`      | Admin dashboard (user management)     |
| 🏢 Station Admin (all modules) | `sana.malik@menzies-ras.pk` | `Statn@2024` | Full operational suite                |
| 🧑‍✈️ Airline Representative      | `usman.tariq@piac.com.pk`   | `Airln@2024` | Manager Dashboard (read-only, scoped) |

---

## 🗂️ Project Structure

```
Airport-ORBIS-Prototype/
├── index.html      # All views: auth · MFA · admin · app shell (~420 lines)
├── style.css       # Design system + every module's styles (~970 lines)
├── script.js       # Engine, seed data, 8 modules, cross-cutting systems (~3,970 lines)
└── README.md       # You are here
```

`script.js` is sectioned for navigability:

```
(S) Simulation engine — pure, no DOM
(D) Storage keys · weight versions · seed data
(H) App shell · showModule · permission guards
(X) Shared render / chart helpers
(M) S2–S9 module renderers
(F) Alert engine · degraded mode · audit
```

---

## 💾 Storage Model

| Key                  | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `orbis_flights`      | Flight records + their stored calculation                      |
| `orbis_gse`          | Ground-support-equipment fleet units                           |
| `orbis_gse_shift`    | Per-shift availability submissions                             |
| `orbis_alerts`       | Generated alerts + escalation state                            |
| `orbis_outcomes`     | Prediction outcomes — **append-only learning dataset**         |
| `orbis_weights`      | Weight/threshold versions — **append-only, never overwritten** |
| `orbis_action_rules` | (risk × dominant-variable) → recommended actions               |
| `orbis_integration`  | Weather / DCS feed health flags                                |
| `orbis_activity`     | Audit & activity log                                           |

---

## 🧠 Engineering Highlights

- **Reproducibility as a feature** — the Turnaround screen has a _"Verify reproducibility"_ button that re-runs the engine from the stored inputs, seed and weight-version and confirms an **exact match**. Predictions are evidence, not vibes.
- **Monotonicity contract (T9)** — a shipped self-check proves the model behaves sensibly; a reduced-draw fast path keeps it sub-second.
- **Provenance-aware** — every input carries `{ source, timestamp, quality }` (`GOOD / STALE / MANUAL / CACHED`), so when a prediction is wrong you can tell whether the _algorithm_ or the _input_ was at fault.
- **Degraded ≠ broken** — a degraded prediction (clearly flagged) is more useful to a supervisor than a blank screen; degraded-quality outcomes are excluded from recalibration.
- **Real RBAC** — airline reps are filtered at the array level before rendering; removing a permission blocks direct module access and redirects.
- **Append-only calibration** — saving weights creates a new version and supersedes the old; every stored calculation keeps its `weightVersionId`, so historical results stay explainable forever.

---

## ✈️ Fleet & Ground Support

Seeded with a realistic wide- and narrow-body mix across **A320 · A321 · B737-800 · B777-200ER · B777-300ER · B787-9 · A330-300**, plus a **B747-400** retained for seasonal Hajj/Umrah peak operations. Backed by a comprehensive GSE fleet (pushback tugs, belt/cargo loaders, GPU, ASU, PCA, fuel, water & lavatory units) with live serviceability, MTBF and failure-probability tracking.

Every GSE unit is attributed to its operating **Ground Handling Agent** — modelled on Multan (MUX): **Gerry's dnata**, **PIA Ground Handling**, **Shaheen Airport Services (SAPS)** and **Royal Airport Services (RAS)**, with safety/fixed infrastructure held by the airport authority. The Equipment Register and GSE Entry screens group, filter and report readiness per agent.

---

## 🗺️ Roadmap

- [x] **Ground Handling Agent (GHA) model** — every GSE unit attributed to its operating agent, with per-agent readiness _(shipped)_
- [x] **Expanded GSE catalogue** — powered, non-powered and fixed-infrastructure categories _(shipped)_
- [ ] **Live weather tick** — periodic heat-index refresh that auto-recomputes affected flights and re-sorts the board in real time
- [ ] Per-stand GSE allocation and crew rostering
- [ ] Exportable turnaround PDF report per flight
- [ ] Optional backend + multi-station sync

---

## 👤 Author

**LeGeND212L**

[![GitHub](https://img.shields.io/badge/GitHub-LeGeND212L-181717?style=flat-square&logo=github)](https://github.com/LeGeND212L)

> Designed and built as a full-stack-quality front-end prototype — a demonstration of simulation modelling, data-driven UX, and disciplined vanilla-JS engineering.

---

<div align="center">

**⭐ If ORBIS impressed you, a star means a lot.**

<sub>ORBIS — On-Time Ramp Buffer Intelligence System · turning apron uncertainty into an actionable number.</sub>

</div>
