# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Primary commands
- `pnpm dev` - Start development build with live reload  
- `pnpm dev:firefox` - Start development build for Firefox
- `pnpm build` - Create production build
- `pnpm build:firefox` - Create production build for Firefox
- `pnpm zip` - Package extension for Chrome Web Store
- `pnpm zip:firefox` - Package extension for Firefox Add-ons
- `pnpm compile` - Type check without emitting files

### Setup
- `pnpm install` - Install dependencies
- `pnpm postinstall` - Run WXT prepare (auto-runs after install)

## Architecture Overview

RoleAlign is a Chrome extension that provides **one-time CV upload → continuous, private, on-page match scoring → one-click tailored CV generation**. The extension analyzes a user's CV once, saves the structured result locally, then automatically scores any supported job page (LinkedIn/Indeed) with a badge showing match percentage, all entirely on-device using Chrome's built-in AI APIs.

### Core Extension Structure

**WXT Framework**: Uses WXT (Web Extension Toolkit) for modern extension development with:
- Manifest V3 configuration in `wxt.config.ts`
- TypeScript support throughout
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
- Unified wrappers for all Chrome AI APIs
- Singleton session management with download progress tracking
- Robust error handling and availability checks
- Type-safe JSON schema enforcement for structured outputs

### Messaging System

**Type-Safe Message Bus** (`src/messaging/`):
- Custom message bus over `chrome.runtime.messaging`
- Request/response pattern with timeouts and AbortSignal support
- Strongly typed contracts in `types.ts`
- Support for targeting specific tabs and streaming responses

**Message Flow**:
1. Popup sends requests to background worker
2. Background worker processes with AI APIs
3. Content scripts capture page HTML and send to background
4. All communication uses typed message contracts

### Job Analysis Pipeline

**Content Script Processing**:
- Detect job pages via URL patterns
- Extract job data using site-specific DOM selectors
- Fallback to JSON-LD structured data parsing
- Summarize job requirements using Summarizer API

**Scoring System** (`src/match/score.ts`):
- **Deterministic scoring**: F1-style skill overlap analysis
- **AI scoring**: Semantic matching via Prompt API  
- **Blended scoring**: Weighted combination of both methods
- Support for "must-have" requirement weighting

### Data Flow

1. **CV Input**: User pastes CV text → Prompt API extracts structured data → Stored locally
2. **Job Analysis**: Content script captures page → Background parses job data → Summarizer creates requirements
3. **Matching**: Background computes match score using CV + job data → Returns score with explanations
4. **Tailoring**: Prompt API generates customized CV based on job requirements

### Storage Strategy

**Local Storage** (`src/storage/kv.ts`):
- Chrome storage API with versioned keys and namespacing
- No external API dependencies - fully offline

**Key Storage Schema**:
- `cv.current`: Structured CV data with metadata (version, hash, updatedAt)
- `settings`: UI preferences, scoring method, privacy options
- `telemetry`: Optional local-only usage tracking

**CV Lifecycle**: CV is parsed once and cached with content hash detection for automatic re-parsing on updates

### Development Patterns

**Error Handling**:
- AI unavailability gracefully falls back to deterministic methods
- Timeout handling for all AI operations
- Context-aware content script invalidation

**Type Safety**:
- Full TypeScript coverage with strict mode
- Discriminated unions for message types
- JSON schema validation for AI responses

**Security**:
- Minimal permissions (storage, activeTab)
- Content Security Policy restrictions
- Isolated content script execution

## Important Implementation Notes

- Always check AI availability before attempting to use Chrome AI APIs
- Use the messaging bus for all cross-context communication
- Content scripts must handle context invalidation during navigation
- All AI operations should include timeout handling
- Fallback to deterministic scoring when AI is unavailable
- Use typed message contracts from `src/messaging/types.ts`

## User Experience Flow

**Initial Setup**:
1. User installs extension → opens popup → uploads CV (paste text or PDF)
2. Extension extracts structured data using `AI.Prompt.extractCv()` → stores locally
3. Future job page visits automatically reuse cached CV analysis

**Job Page Interaction**:
1. Content script detects job pages → extracts job data → sends to background
2. Background analyzes job requirements → computes match score
3. Content script displays badge with match percentage
4. User clicks badge → sees detailed matched/missing skills + rationale
5. User can generate tailored CV → download on-device generated result

**Settings Configuration**:
- Auto badge display (can be disabled for manual scoring via popup)
- Privacy setting to keep/discard raw CV text (default: discard for privacy)
- Scoring method: deterministic, AI, or blended (default: blend with 60% AI weight)