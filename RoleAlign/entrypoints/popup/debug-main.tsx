// Debug popup entry point
import React from 'react';
import { createRoot } from 'react-dom/client';
import SimplePopup from './simple';

// Enhanced error logging
window.addEventListener('error', e => {
  console.error('🚨 [Debug] Window error:', e.error || e.message);
  console.error('🚨 [Debug] Stack:', e.error?.stack);
});

window.addEventListener('unhandledrejection', e => {
  console.error('🚨 [Debug] Unhandled rejection:', e.reason);
});

// Check Chrome APIs first
if (typeof chrome === 'undefined') {
  console.error('🚨 [Debug] Chrome APIs not available');
  document.body.innerHTML = `
    <div style="padding: 20px; text-align: center; font-family: sans-serif;">
      <h3>⚠️ Chrome Extension Context Missing</h3>
      <p>This popup requires Chrome extension APIs.</p>
      <p>Are you running this as a Chrome extension?</p>
    </div>
  `;
} else {
  console.log('✅ [Debug] Chrome APIs available');
  console.log('✅ [Debug] Extension ID:', chrome.runtime?.id);

  // Initialize React
  const container = document.getElementById('root');
  if (!container) {
    console.error('🚨 [Debug] No root element found');
    document.body.innerHTML = `
      <div style="padding: 20px; text-align: center; font-family: sans-serif;">
        <h3>⚠️ Root Element Missing</h3>
        <p>Could not find the root element to mount React app.</p>
      </div>
    `;
  } else {
    try {
      console.log('✅ [Debug] Root element found, creating React app');
      const root = createRoot(container);
      root.render(React.createElement(SimplePopup));
      console.log('✅ [Debug] React app mounted successfully');
    } catch (error) {
      console.error('🚨 [Debug] React mount failed:', error);
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; font-family: sans-serif;">
          <h3>⚠️ React Mount Failed</h3>
          <p>Could not mount the React application.</p>
          <pre style="text-align: left; background: #f5f5f5; padding: 8px; border-radius: 4px;">
${error instanceof Error ? error.message : String(error)}
          </pre>
        </div>
      `;
    }
  }
}