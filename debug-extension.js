// Debug script to check extension status
console.log('=== RoleAlign Extension Debug ===');

// Check if Chrome APIs are available
console.log('Chrome object:', typeof chrome !== 'undefined' ? 'Available' : 'Missing');
console.log('Chrome runtime:', typeof chrome?.runtime !== 'undefined' ? 'Available' : 'Missing');
console.log('Chrome tabs:', typeof chrome?.tabs !== 'undefined' ? 'Available' : 'Missing');

// Check extension ID and status
if (typeof chrome !== 'undefined' && chrome.runtime) {
  console.log('Extension ID:', chrome.runtime.id);
  console.log('Extension URL:', chrome.runtime.getURL(''));
  
  // Check if background script is responsive
  chrome.runtime.sendMessage({type: 'PING'}, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Background script error:', chrome.runtime.lastError.message);
    } else {
      console.log('Background script response:', response);
    }
  });
}

// Check for common extension issues
console.log('Document readyState:', document.readyState);
console.log('Window location:', window.location.href);

// Check for service worker (Manifest V3)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    console.log('Service Worker registrations:', registrations.length);
    registrations.forEach((reg, index) => {
      console.log(`SW ${index}:`, reg.scope, reg.active?.state);
    });
  });
}