// scripts/ensure-chrome-flags.mjs
import fs from 'node:fs';
import path from 'node:path';

const userDataDir = path.resolve('.wxt/chrome-data');
// "Local State" lives directly under the user data dir (not inside "Default")
const localStatePath = path.join(userDataDir, 'Local State');

// Ensure parent dir exists
fs.mkdirSync(userDataDir, { recursive: true });

// Load or initialize the Local State JSON
let state = {};
if (fs.existsSync(localStatePath)) {
  try { 
    state = JSON.parse(fs.readFileSync(localStatePath, 'utf8')); 
  } catch (e) {
    console.warn('⚠️  Could not parse existing Local State, creating new one');
  }
}

state.browser ??= {};
const arr = new Set(state.browser.enabled_labs_experiments ?? []);

// Desired flags (Enabled = "@1")
const requiredFlags = [
  'prompt-api-for-gemini-nano@1',
  'summarization-api-for-gemini-nano@1',
  'translation-api@1',
];

let flagsAdded = 0;
requiredFlags.forEach((flag) => {
  if (!arr.has(flag)) {
    arr.add(flag);
    flagsAdded++;
  }
});

state.browser.enabled_labs_experiments = Array.from(arr);
state.browser.first_run_finished = true;

// Write back prettified JSON
fs.writeFileSync(localStatePath, JSON.stringify(state, null, 2), 'utf8');

if (flagsAdded > 0) {
  console.log(`✅ Added ${flagsAdded} Chrome AI flags to Local State.`);
} else {
  console.log('✅ All Chrome AI flags already enabled in Local State.');
}

console.log('🧪 Chrome AI APIs will be available at:');
console.log('   - Prompt API: globalThis.ai.languageModel');
console.log('   - Summarizer API: globalThis.ai.summarizer');
console.log('   - Translator API: globalThis.ai.translator');
console.log('📍 Profile location:', userDataDir);