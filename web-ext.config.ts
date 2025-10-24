// web-ext.config.ts
import { defineWebExtConfig } from 'wxt';

export default defineWebExtConfig({
  // Persist Chrome profile per-project for consistent AI flags
  chromiumArgs: ['--user-data-dir=./.wxt/chrome-data'],

  // Optional: point to a specific Chrome build (e.g., Beta/Canary) if needed
  // binaries: { chrome: '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta' },
});