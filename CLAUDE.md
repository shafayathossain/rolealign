# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Primary commands
- `pnpm dev` - Start development build with live reload  
- `pnpm dev:ai` - **Recommended**: Build extension and launch Chrome with AI APIs enabled
- `pnpm dev:firefox` - Start development build for Firefox
- `pnpm build` - Create production build
- `pnpm build:firefox` - Create production build for Firefox
- `pnpm zip` - Package extension for Chrome Web Store
- `pnpm zip:firefox` - Package extension for Firefox Add-ons
- `pnpm compile` - Type check without emitting files

### Setup
- `pnpm install` - Install dependencies
- `pnpm postinstall` - Run WXT prepare (auto-runs after install)

### Chrome AI Prerequisites
RoleAlign requires Chrome's built-in AI APIs. There are two ways to enable them:

**Option 1: Automated (Recommended for Development)**
```bash
pnpm dev:ai  # Automatically launches Chrome with AI flags enabled
```

**Option 2: Manual Setup**
- `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
- `chrome://flags/#summarization-api-for-gemini-nano` → **Enabled**  
- `chrome://flags/#translation-api` → **Enabled**
- Restart Chrome completely after enabling

**Important Note**: When using command-line flags (Option 1), the flags may still show as "Default" in chrome://flags, but they are active. Test AI availability with:
```javascript
console.log('AI available:', !!globalThis.ai?.languageModel);
```

## Architecture Overview

RoleAlign is a Chrome extension that provides **one-time CV upload → continuous, private, on-page match scoring → one-click tailored CV generation**. The extension analyzes a user's CV once, saves the structured result locally, then automatically scores any supported job page (LinkedIn/Indeed) with a badge showing match percentage, all entirely on-device using Chrome's built-in AI APIs.

### Core Extension Structure

**WXT Framework**: Uses WXT (Web Extension Toolkit) for modern extension development with:
- Manifest V3 configuration in `wxt.config.ts`
- TypeScript support throughout with strict mode
- React for popup UI
- Isolated content scripts for LinkedIn and Indeed

**Entry Points**:
- `entrypoints/background/index.ts` - Service worker handling AI processing and message routing
- `entrypoints/popup/` - React-based popup UI for user interaction
- `entrypoints/linkedin.content.ts` - Content script for LinkedIn job pages
- `entrypoints/indeed.content.ts` - Content script for Indeed job pages

### AI Integration Architecture

**Chrome Built-in AI APIs**: The extension exclusively uses Chrome's on-device AI:
- **Prompt API** (Gemini Nano) - CV extraction and tailored CV generation
- **Summarizer API** - Job requirement summarization  
- **Translator API** - Future multilingual support

**AI Abstraction Layer** (`src/ai/chrome-ai.ts`):
- Unified wrappers for all Chrome AI APIs with consistent error handling
- Singleton session management with download progress tracking
- Robust availability checks and graceful degradation
- Type-safe JSON schema enforcement for structured outputs
- Timeout handling for all AI operations (default: 30s)

### Messaging System

**Type-Safe Message Bus** (`src/messaging/`):
- Custom message bus over `chrome.runtime.messaging`
- Request/response pattern with timeouts (default: 15s) and AbortSignal support
- Strongly typed contracts in `types.ts` with discriminated unions
- Support for targeting specific tabs and streaming responses
- Automatic error mapping and context preservation

**Message Flow**:
1. Popup sends requests to background worker via typed contracts
2. Background worker processes with AI APIs and site adapters
3. Content scripts capture page HTML and send to background
4. All communication uses versioned protocol (`PROTOCOL_VERSION = 1`)

### Job Analysis Pipeline

**Site Adapters** (`src/sites/`):
- LinkedIn adapter: DOM parsing with fallback to JSON-LD
- Indeed adapter: Similar structured parsing approach
- Common interface in `types.ts` for `JobNormalized` output
- Graceful fallback mechanisms for parsing failures

**Content Script Processing**:
- Detect job pages via URL patterns in manifest
- Extract job data using site-specific adapters
- Handle context invalidation during navigation
- Send structured job data to background for analysis

**Scoring System** (`src/match/score.ts`):
- **Deterministic scoring**: F1-style skill overlap analysis with stopword filtering
- **AI scoring**: Semantic matching via Prompt API with timeout handling
- **Blended scoring**: Weighted combination (default: 60% AI, 40% deterministic)
- Support for "must-have" requirement weighting with configurable hints

### Data Flow

1. **CV Input**: User pastes CV text → Prompt API extracts structured data → Stored locally with hash
2. **Job Analysis**: Content script captures page → Site adapter parses → Background processes
3. **Matching**: Background computes score using CV + job data → Returns score with explanations
4. **Tailoring**: Prompt API generates customized CV based on job requirements

### Storage Strategy

**Local Storage** (`src/storage/kv.ts`):
- Chrome storage API with versioned keys and namespacing
- No external API dependencies - fully offline
- Automatic cache invalidation based on content hash

**Key Storage Schema**:
- `cv.current`: Structured CV data with metadata (version, hash, updatedAt)
- `settings`: UI preferences, scoring method, privacy options
- `telemetry`: Optional local-only usage tracking

**CV Lifecycle**: CV is parsed once and cached with content hash detection for automatic re-parsing on updates

### Development Patterns

**Error Handling**:
- AI unavailability gracefully falls back to deterministic methods
- Comprehensive timeout handling for all AI operations
- Context-aware content script invalidation with proper cleanup
- Global error listeners in background service worker

**Type Safety**:
- Full TypeScript coverage with strict mode enabled
- Discriminated unions for message types and responses
- JSON schema validation for AI responses
- Proper error mapping with typed error codes

**Security**:
- Minimal permissions (storage, activeTab, scripting)
- Content Security Policy restrictions
- Isolated content script execution (world: "ISOLATED")
- Host permissions limited to supported job sites

## Important Implementation Notes

- **AI Availability**: Always check `AI.Availability.prompt()` before using Chrome AI APIs
- **Messaging**: Use the typed message bus from `src/messaging/bus.ts` for all cross-context communication
- **Content Scripts**: Must handle context invalidation during navigation and cleanup properly
- **Timeouts**: All AI operations should include timeout handling (use default 30s for AI, 15s for messaging)
- **Fallbacks**: Ensure deterministic scoring works when AI is unavailable
- **Message Contracts**: Use typed message contracts from `src/messaging/types.ts`
- **Site Adapters**: Follow the `JobNormalized` interface when adding new job sites
- **Storage**: Use the versioned key-value store from `src/storage/kv.ts`

## User Experience Flow

**Initial Setup**:
1. User installs extension → opens popup → uploads CV (paste text or PDF)
2. Extension extracts structured data using `AI.Prompt.extractCv()` → stores locally
3. Future job page visits automatically reuse cached CV analysis

**Job Page Interaction**:
1. Content script detects job pages → extracts job data using site adapters → sends to background
2. Background analyzes job requirements → computes match score using blended scoring
3. Content script displays badge with match percentage
4. User clicks badge → sees detailed matched/missing skills + rationale
5. User can generate tailored CV → download on-device generated result

**Settings Configuration**:
- Auto badge display (can be disabled for manual scoring via popup)
- Privacy setting to keep/discard raw CV text (default: discard for privacy)
- Scoring method: deterministic, AI, or blended (default: blend with 60% AI weight)