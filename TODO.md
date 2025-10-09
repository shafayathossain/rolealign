# RoleAlign - Development TODO

## Current Project State Analysis (2025-01-20)

### Major Issues Found:
1. **Site adapters completely unused** - Well-designed `src/sites/` modules are not integrated
2. **Broken message flow** - Content scripts bypass background for AI processing  
3. **AI integration scattered** - No centralized Chrome AI usage pattern
4. **Missing core functionality** - Badge display, proper CV matching workflow not implemented
5. **Goal mismatch** - Current implementation doesn't match README specifications

---

## High Priority Fixes (Blocking Core Functionality)

### ✅ Phase 1: Architecture Alignment 
- [x] Analyze project and identify disconnects
- [x] **Fix background ANALYZE_JOB handler** - Use site adapters instead of inline parsing
- [x] **Fix content scripts** - Send HTML to background, use proper message bus
- [x] **Integrate site adapters** - Make `src/sites/` modules actually used
- [x] **Fix message flow** - Content scripts now properly communicate with background

### 🔄 Phase 2: Core Workflow Implementation
- [ ] **CV Analysis Workflow** - Popup → AI extraction → Local storage
- [x] **Job Analysis Workflow** - Content script → Background → Site adapter → AI analysis  
- [x] **Match Scoring** - Use stored CV + analyzed job → Generate score
- [x] **Badge Display** - Show match percentage badge on job pages

### 🎯 Phase 3: User Experience
- [ ] **Auto-detection** - Automatically analyze job pages when visited
- [ ] **Tailored CV Generation** - Use AI to customize CV for specific jobs
- [ ] **Settings Management** - Auto badge, scoring method, privacy options
- [ ] **Error Handling** - Graceful AI unavailability fallbacks

---

## Specific Technical Fixes

### Background Worker (`entrypoints/background/index.ts`)
- [x] **ANALYZE_JOB handler**: Replace inline parsing with site adapter usage
- [ ] **Add missing handlers**: LOG_EVENT and other message types
- [x] **HTML capture**: Implement tab HTML capture for job analysis
- [x] **Site adapter integration**: Import and use LinkedIn/Indeed adapters

### Content Scripts (`entrypoints/linkedin.content.ts`, `entrypoints/indeed.content.ts`)  
- [x] **Remove AI calls**: Don't call `AI.Summarize.jobRequirements()` directly
- [x] **Send HTML to background**: Use proper message bus for job analysis
- [x] **Badge implementation**: Create and display match score badge
- [x] **URL pattern matching**: Ensure proper job page detection

### Site Adapters (`src/sites/`)
- [x] **Integration**: Actually use these well-designed modules
- [x] **Export structure**: Ensure proper imports/exports
- [ ] **Testing**: Validate parsing works on real LinkedIn/Indeed pages

### Popup (`entrypoints/popup/App.tsx`)
- [ ] **Fix ANALYZE_JOB call**: Send proper HTML payload to background
- [ ] **Tab HTML capture**: Get active tab HTML for analysis
- [ ] **Error states**: Handle AI unavailability gracefully

### AI Integration (`src/ai/chrome-ai.ts`)
- [ ] **Centralization**: Ensure all AI calls go through this module
- [ ] **Availability checks**: Proper fallback when Chrome AI unavailable
- [ ] **Schema validation**: Fix JSON parsing for structured outputs

---

## Expected User Flow (Target Implementation)

1. **Setup Phase**:
   - User installs extension → Opens popup → Pastes CV text
   - Background uses `AI.Prompt.extractCv()` → Stores structured CV locally
   - CV cached for future use (hash-based change detection)

2. **Job Analysis Phase**:
   - User visits LinkedIn/Indeed job page → Content script detects
   - Content script sends HTML to background via `ANALYZE_JOB`
   - Background uses site adapter → Parses job → Uses AI for requirements
   - Background computes match score using stored CV + job data
   - Content script displays badge with match percentage

3. **Interaction Phase**:
   - User clicks badge → Sees detailed match breakdown
   - User can generate tailored CV → Downloads customized version
   - All processing stays on-device (Chrome AI APIs)

---

## Progress Tracking

### Completed ✅
- [x] Project analysis and issue identification  
- [x] TODO.md creation with comprehensive task breakdown
- [x] Background ANALYZE_JOB handler completely rewritten to use site adapters
- [x] Content scripts rewritten to use proper message bus communication
- [x] Site adapters now properly integrated and used
- [x] Badge display functionality implemented for both LinkedIn and Indeed
- [x] Message flow fixed - HTML capture and job analysis through background
- [x] Removed all inline parsing and direct AI calls from content scripts

### In Progress 🔄
- [ ] CV analysis workflow in popup

### Blocked ❌
- None currently

### Next Session Goals 🎯
1. Fix background ANALYZE_JOB handler to use site adapters
2. Update content scripts to send HTML instead of doing AI processing
3. Implement badge display functionality
4. Test basic CV analysis → Job analysis → Match scoring flow

---

## Notes & Decisions

- **Site adapters are well-designed** - Keep existing structure, just integrate properly
- **Chrome AI integration looks good** - Just needs centralized usage pattern  
- **Message bus architecture is solid** - Fix payload structures and handlers
- **Storage strategy is appropriate** - Use existing KV module patterns

## Files Modified This Session
- `/TODO.md` (created)
- Analysis of existing codebase architecture