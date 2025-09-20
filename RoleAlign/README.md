# WXT + React

This template should help get you started developing with React in WXT.

File-tree:

RoleAlign/
├─ entrypoints/
│  ├─ background/
│  │  └─ index.ts
│  ├─ content/
│  │  ├─ linkedin.content.ts
│  │  └─ indeed.content.ts
│  └─ popup/
│     ├─ index.html
│     ├─ main.tsx
│     └─ App.tsx
├─ src/
│  ├─ ai/
│  │  └─ chrome-ai.ts           # All on-device AI wrappers (Prompt/Summarizer/…)
│  ├─ match/
│  │  └─ score.ts               # Match score utils
│  ├─ messaging/
│  │  ├─ bus.ts                 # thin wrapper around chrome.runtime messaging
│  │  └─ types.ts               # typed messages
│  ├─ sites/
│  │  ├─ types.ts               # Site adapter interface
│  │  ├─ linkedin.ts            # LinkedIn adapter (DOM → text)
│  │  └─ indeed.ts              # Indeed adapter
│  ├─ storage/
│  │  └─ kv.ts                  # versioned keys + helpers
│  └─ util/
│     ├─ dom.ts                 # safe DOM helpers (inject badge/toast, qs)
│     └─ logger.ts              # small logger with prefixes
├─ types/
│  └─ chrome-ai.d.ts            # ambient types for AI APIs (minimal)
├─ public/
│  └─ icon/...                  # your icons
├─ wxt.config.ts
├─ tsconfig.json
└─ .gitignore



# RoleAlign — AI-powered CV ↔ Job Match (On-Device)

**One-time CV upload → continuous, private, on-page match scoring → one-click tailored CV generation.**
RoleAlign analyzes a user’s CV once, saves the structured result locally, and then automatically scores any supported job page the user visits (LinkedIn/Indeed). A badge shows the match %, and a button lets the user generate and download a tailored CV—**all on-device**.

---

## ✨ Core Features

* **Upload once, use everywhere**

  * User submits CV once (text/PDF → text).
  * Extension parses & **saves analyzed CV** (structured JSON) locally.
  * Future visits to job pages instantly re-use the saved analysis—no re-upload.
* **Auto score on job pages**

  * When the user lands on a supported job page, RoleAlign parses the posting and **pops a badge** (top-right) with a **match %**.
  * Click the badge to open details (matched/missing skills, rationale).
* **One-click tailored CV**

  * From the details panel, the user can **Generate Tailored CV**.
  * Output is generated locally and offered as a **download** (Markdown by default; can extend to PDF/DOCX).
* **On-device AI (privacy by default)**

  * Chrome built-in AI (Prompt/Summarizer/Translator).
  * If device lacks on-device models, we **degrade gracefully** to deterministic scoring; no data leaves the device.
* **Zero server dependency**

  * Storage via `chrome.storage.local` (namespaced & versioned).
  * No external APIs required.

---

## 🧭 User Flow (What the user experiences)

1. **Install extension** → open popup → **Upload CV** (paste text or drop PDF).
2. Extension extracts structured data (name, skills, experience, etc.) and **stores it locally**.
3. User browses LinkedIn/Indeed job pages:

   * A **match badge** appears with **Match: 0–100%**.
   * Clicking it opens a panel showing **matched/missing skills** and an explanation.
4. User clicks **Generate Tailored CV** → extension produces a job-specific CV on-device → **Download**.

> The CV is parsed **once** and cached. If the user updates their CV, the extension detects a content hash change, re-parses, and updates the cache automatically.

---

## 🧱 How it’s implemented (at a glance)

* **CV Lifecycle**

  * `popup/App.tsx` → user input → `AI.Prompt.extractCv()`
  * Persisted to `kv.set('cv.current', { data, meta: { version, hash, updatedAt } })`
  * Background keeps **only the structured result**; raw text can be discarded (configurable).
* **Job Page Lifecycle**

  * Content script (site adapter) extracts normalized job text + metadata.
  * Sends `ANALYZE_JOB` → background summarizes requirements (on-device) → returns markdown “requirements”.
  * Background computes score: `computeScore({ cvSkills, jobMarkdown, cvEvidence })` (deterministic + AI blend).
  * Content script **mounts a badge** with the score; clicking opens details.
* **Tailored CV Generation**

  * Content → `GENERATE_TAILORED_CV` → background uses on-device Prompt to rewrite user CV for the job → returns text → content offers **download**.

---

## 🗂️ Stored Keys (chrome.storage.local)

* `cv.current`

  ```ts
  {
    data: { basics, skills, experience, education, projects, ... },
    meta: { version: 1, hash: "sha256:...", updatedAt: 1737400000000 }
  }
  ```
* `settings`

  ```ts
  {
    ui: { autoBadge: true, showToasts: true },
    scoring: { method: "blend", blendAlpha: 0.6 },
    privacy: { keepRawCv: false }
  }
  ```
* `telemetry` (optional, local only)

  ```ts
  { lastScore: { url, score, ts }, ... }
  ```

---

## 🔄 State Machine (simplified)

```
[NoCV]
  └──(User uploads CV)──> [CVParsed]
[CVParsed]
  ├──(Navigate job page)──> [JobDetected]
  │     ├─ Parse job
  │     ├─ Summarize requirements
  │     ├─ Score (deterministic ± AI)
  │     └─ Show badge/panel
  └──(User updates CV)──> [CVParsed*] re-parse if hash changed
[JobDetected]
  ├──(Generate Tailored CV)──> [TailoredReady] → download
  └──(Navigate away)──> [CVParsed] (unmount)
```

---

## ⚙️ Settings that affect the flow

* **Auto badge:** if off, content script doesn’t show the badge automatically; user can open the popup and click “Score this page.”
* **Keep raw CV:** for privacy, default is **false** (discard raw text, keep only structured result).
* **Scoring method:** `deterministic` | `ai` | `blend` (default `blend`).

---

## 🔐 Privacy Notes

* The analyzed CV JSON and tailored CV are stored **locally**; nothing leaves the device.
* If on-device models aren’t available, AI features gracefully degrade (no fallback to cloud).
* Host permissions limited to supported job sites; content scripts are **shadow-DOM isolated**.

---

## 🧪 QA Checklist (for this flow)

* [ ] Upload CV once → refresh browser → CV remains available (storage OK).
* [ ] Navigate several LinkedIn/Indeed job pages → badge shows without re-upload.
* [ ] Toggle **Auto badge** off → badge no longer appears automatically; scoring via popup still works.
* [ ] Generate tailored CV for at least two different jobs → outputs differ appropriately.
* [ ] Disable built-in AI (simulate unavailability) → deterministic score still appears; tailored CV button can show a friendly “AI unavailable” note.
* [ ] Update CV contents → hash changes → CV gets re-parsed and results refresh.

