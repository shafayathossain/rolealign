# RoleAlign Extension Debug Guide

## Current Status
The extension is building and launching correctly, but the popup shows "Still not loading". Here's how to diagnose and fix the issue:

## Immediate Debugging Steps

### 1. Check Extension Status
1. Open Chrome with the extension loaded (using `pnpm dev:ai`)
2. Go to `chrome://extensions/`
3. Find "RoleAlign" extension
4. Note the Extension ID
5. Check if it shows any errors

### 2. Check Console Errors
1. Right-click on the RoleAlign extension icon in the toolbar
2. Select "Inspect popup" (this opens DevTools for the popup)
3. Look for JavaScript errors in the Console tab
4. Check Network tab for failed requests

### 3. Test Background Script
1. In `chrome://extensions/`, click "Service worker" next to RoleAlign
2. In the console that opens, run:
```javascript
// Test if background script is working
chrome.runtime.sendMessage({type: 'PING'}, (response) => {
  console.log('PING response:', response);
});
```

### 4. Test AI APIs
1. Navigate to: `chrome-extension://[YOUR-EXTENSION-ID]/debug-ai.html`
2. Or in any browser console, run:
```javascript
console.log('AI available:', !!globalThis.ai?.languageModel);
console.log('AI capabilities:', globalThis.ai);
```

## Common Issues and Fixes

### Issue 1: Chrome Extension APIs Not Available
**Symptoms:** "Chrome extension APIs not available" error
**Solutions:**
- Reload the extension in `chrome://extensions/`
- Make sure you're opening the popup, not a regular webpage
- Check if the extension has proper permissions

### Issue 2: Background Script Not Responding
**Symptoms:** PING requests timeout or fail
**Solutions:**
- Check Service Worker status in `chrome://extensions/`
- Look for errors in Service Worker console
- Try reloading the extension

### Issue 3: AI APIs Not Available
**Symptoms:** `globalThis.ai` is undefined
**Solutions:**
- Verify Chrome flags are enabled:
  - `chrome://flags/#prompt-api-for-gemini-nano` → Enabled
  - `chrome://flags/#summarization-api-for-gemini-nano` → Enabled
- Restart Chrome after enabling flags
- The `pnpm dev:ai` script should handle this automatically

### Issue 4: Content Security Policy Issues
**Symptoms:** CSP errors in console
**Solutions:**
- Check if CSP in manifest is too restrictive
- Ensure popup.html loads correctly

## Quick Fixes to Try

### Fix 1: Add Debug Logging to Popup
Add this to the popup console to see what's happening:
```javascript
// Check popup initialization state
console.log('Popup debug info:', {
  chrome: typeof chrome,
  runtime: typeof chrome?.runtime,
  sendMessage: typeof chrome?.runtime?.sendMessage,
  location: window.location.href
});
```

### Fix 2: Manual Extension Reload
1. Go to `chrome://extensions/`
2. Find RoleAlign
3. Click the refresh/reload button
4. Try opening popup again

### Fix 3: Check Tabs Permission
The extension needs `activeTab` permission. Verify in manifest:
```json
"permissions": ["storage", "activeTab", "scripting"]
```

## Advanced Debugging

### Check Extension Files
Navigate to: `chrome-extension://[EXTENSION-ID]/`
You should see:
- `popup.html`
- `background.js`
- `manifest.json`
- Asset files

### Test Individual Components
1. **Test Background Script:**
```javascript
chrome.runtime.sendMessage({
  v: 1,
  id: 'test',
  from: 'popup',
  to: 'background',
  type: 'PING',
  payload: {}
});
```

2. **Test Storage:**
```javascript
chrome.storage.local.get(null, (data) => {
  console.log('Stored data:', data);
});
```

3. **Test Active Tab:**
```javascript
chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
  console.log('Active tab:', tabs[0]);
});
```

## If Nothing Works

### Nuclear Option: Clean Rebuild
```bash
# Clean everything
rm -rf node_modules/.wxt
rm -rf .output
npm run build
```

### Check Development Environment
- Ensure Node.js version is compatible
- Check if WXT is up to date
- Verify Chrome version supports Manifest V3

## Success Indicators
When working correctly, you should see:
1. No console errors in popup DevTools
2. PING responds with `{pong: timestamp}`
3. AI APIs return truthy values
4. Extension loads without "Still not loading" message

## Contact Support
If issues persist:
1. Copy console errors from popup inspection
2. Note Chrome version and OS
3. Check if issue occurs in incognito mode
4. Test with fresh Chrome profile