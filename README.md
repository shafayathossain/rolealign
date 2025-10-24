# RoleAlign — AI-powered CV ↔ Job Match Extension

**CRITICAL: This extension requires Chrome's built-in AI APIs and operates in a strict AI-only mode with no fallbacks.**

One-time CV upload → continuous, private, on-page match scoring → one-click tailored CV generation.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- pnpm (recommended) or npm
- **Chrome browser with AI flags enabled** (REQUIRED - no alternatives)

### Installation & Development

```bash
# 1. Install dependencies
pnpm install

# 2. Build extension (DO NOT use pnpm dev during development)
pnpm build

# 3. For development with AI APIs enabled
pnpm dev:ai

# This automatically launches Chrome with AI flags enabled
```

### Production Build

```bash
# Build for Chrome Web Store
pnpm build
pnpm zip

# Build for Firefox (limited functionality)
pnpm build:firefox
pnpm zip:firefox
```

### Enable Chrome AI APIs (CRITICAL REQUIREMENT)

⚠️ **RoleAlign is 100% dependent on Chrome's built-in AI APIs. The extension will NOT work without these enabled.**

**Option 1: Automated (Recommended for Development)**
```bash
pnpm dev:ai  # Automatically launches Chrome with AI flags enabled
```

**Option 2: Manual Setup**
1. **Open Chrome flags:**
   - `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
   - `chrome://flags/#summarization-api-for-gemini-nano` → **Enabled**
   - `chrome://flags/#translation-api` → **Enabled**

2. **Restart Chrome completely**

3. **Verify AI availability:**
   ```javascript
   // In Chrome DevTools console
   console.log('AI available:', !!globalThis.ai?.languageModel);
   console.log('Prompt API status:', await globalThis.ai?.languageModel?.capabilities());
   ```

**Important:** When using command-line flags, the flags may still show as "Default" in chrome://flags, but they are active.

### Development Commands

| Command | Description |
|---------|-------------|
| `pnpm dev:ai` | **Recommended:** Build extension and launch Chrome with AI APIs enabled |
| `pnpm build` | Create production build |
| `pnpm compile` | Type check without emitting |
| `pnpm zip` | Package for Chrome Web Store |
| `pnpm dev:firefox` | Start development for Firefox (limited AI functionality) |

⚠️ **Important:** Never use `pnpm dev` alone during development. Always use `pnpm dev:ai` to ensure AI APIs are available.

### File Structure:

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

## 🧪 Testing the Extension

1. **Load extension in Chrome:**
   - Extension auto-loads during `pnpm dev`
   - Or manually: Chrome → Extensions → Load unpacked → `.output/chrome-mv3-dev`

2. **Test CV upload:**
   - Click extension icon → Upload CV text/file
   - Watch browser console for logs

3. **Test job matching:**
   - Visit LinkedIn or Indeed job page
   - Look for match badge (if auto-badge enabled)
   - Check console logs for job analysis

## 📋 Development Notes

- **TypeScript**: Full type safety with strict mode
- **Hot Reload**: Changes auto-reload the extension
- **Logging**: Comprehensive logging for debugging
- **Chrome MV3**: Uses latest Manifest V3 architecture

---

# RoleAlign — AI-powered CV ↔ Job Match (On-Device)

**One-time CV upload → continuous, private, on-page match scoring → one-click tailored CV generation.**
RoleAlign analyzes a user’s CV once, saves the structured result locally, and then automatically scores any supported job page the user visits (LinkedIn/Indeed). A badge shows the match %, and a button lets the user generate and download a tailored CV—**all on-device**.

---

## ✨ Core Features

* **Upload once, use everywhere**

  * User submits CV once (text/PDF → text).
  * Extension uses **Chrome AI** to parse & **save analyzed CV** (structured JSON) locally.
  * Future visits to job pages instantly re-use the saved analysis—no re-upload.
* **AI-powered job analysis**

  * When the user lands on a supported job page, RoleAlign uses **Chrome AI** to parse the posting and **pops a badge** (top-right) with a **match %**.
  * Click the badge to open details (matched/missing skills, AI-generated rationale).
* **One-click tailored CV generation**

  * From the details panel, the user can **Generate Tailored CV**.
  * **Requires Chrome AI** - no fallback methods available.
  * Output is generated locally using AI and offered as a **download** (Markdown format).
* **Strict AI-only architecture**

  * **100% dependent on Chrome built-in AI** (Prompt/Summarizer APIs).
  * **NO fallback mechanisms** - if AI is unavailable, features will not work.
  * All skill extraction, job analysis, and CV generation powered by AI.
* **Zero server dependency**

  * Storage via `chrome.storage.local` (namespaced & versioned).
  * No external APIs required - completely on-device processing.

---

## 🧭 User Flow (What the user experiences)

1. **Install extension** → open popup → **Upload CV** (paste text or drop PDF).
2. Extension uses **Chrome AI** to extract structured data (name, skills, experience, etc.) and **stores it locally**.
3. User browses LinkedIn/Indeed job pages:

   * A **match badge** appears with **Match: 0–100%** (powered by AI analysis).
   * Clicking it opens a panel showing **AI-analyzed matched/missing skills** and reasoning.
4. User clicks **Generate Tailored CV** → extension uses **Chrome AI** to produce a job-specific CV on-device → **Download**.

> ⚠️ **All steps require Chrome AI to be available.** The CV is parsed **once** using AI and cached. If the user updates their CV, the extension detects a content hash change, re-parses with AI, and updates the cache automatically.

---

## 🧱 How it's implemented (at a glance)

* **CV Lifecycle**

  * `popup/App.tsx` → user input → `AI.Prompt.extractCv()` **(Chrome AI required)**
  * Persisted to `kv.set('cv.current', { data, meta: { version, hash, updatedAt } })`
  * Background keeps **only the AI-structured result**; raw text can be discarded (configurable).
* **Job Page Lifecycle**

  * Content script (site adapter) extracts normalized job text + metadata.
  * Sends `ANALYZE_JOB` → background uses **Chrome AI** to analyze requirements → returns structured job data.
  * Background computes score: **AI-powered semantic matching** with enhanced skill extraction.
  * Content script **mounts a badge** with the AI-computed score; clicking opens AI-generated details.
* **Tailored CV Generation**

  * Content → `GENERATE_TAILORED_CV` → background uses **Chrome AI Prompt API** to rewrite user CV for the job → returns text → content offers **download**.

> **Critical:** All AI operations have strict timeouts and **no fallback mechanisms**. If Chrome AI is unavailable, these features will fail gracefully with clear error messages.

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

* **Auto badge:** if off, content script doesn't show the badge automatically; user can open the popup and click "Score this page."
* **Keep raw CV:** for privacy, default is **false** (discard raw text, keep only AI-structured result).
* **Scoring method:** Currently **AI-only** - no deterministic fallbacks available.
* **AI Dependencies:** All features require Chrome AI APIs to be enabled and available.

---

## 🔐 Privacy Notes

* The AI-analyzed CV JSON and tailored CV are stored **locally**; nothing leaves the device.
* **Chrome built-in AI models** run entirely on-device - no cloud communication.
* If on-device AI models aren't available, features **fail completely** (no cloud fallbacks).
* Host permissions limited to supported job sites; content scripts are **shadow-DOM isolated**.
* All skill extraction and job analysis happens locally using Chrome AI APIs.

---

## 🧪 QA Checklist (for this flow)

* [ ] **AI Availability Check:** Verify Chrome AI APIs are enabled before testing any functionality.
* [ ] Upload CV once → refresh browser → AI-analyzed CV remains available (storage OK).
* [ ] Navigate several LinkedIn/Indeed job pages → AI-powered badge shows without re-upload.
* [ ] Toggle **Auto badge** off → badge no longer appears automatically; AI scoring via popup still works.
* [ ] Generate tailored CV for at least two different jobs → AI outputs differ appropriately.
* [ ] **AI Failure Test:** Disable built-in AI → all features should fail gracefully with clear error messages.
* [ ] Update CV contents → hash changes → CV gets re-analyzed with AI and results refresh.
* [ ] **Skill Extraction Quality:** Verify AI extracts only legitimate technical skills, not random words.

## 🚨 Critical Development Restrictions

**These restrictions must be followed in all future development:**

1. **NO fallback mechanisms** - If Chrome AI is unavailable, features must fail gracefully
2. **NO hardcoded skill arrays** - All skill extraction must be AI-driven and dynamic
3. **NO regex-based skill matching** - Only AI-powered skill analysis is permitted
4. **DO NOT use `pnpm dev`** - Always use `pnpm dev:ai` or `pnpm build` for testing
5. **AI-first architecture** - Every text analysis operation must use Chrome AI APIs
6. **Fail-fast approach** - If AI isn't available, don't attempt alternative methods

