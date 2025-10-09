// Maximum robustness error handling and debugging
let errorCount = 0;
const MAX_ERRORS = 5;

function logError(prefix: string, error: any, data: any = null) {
  errorCount++;
  console.error(`🚨 [RoleAlign:${errorCount}] ${prefix}:`, error);
  if (data) console.error('🚨 [RoleAlign] Additional data:', data);
  
  if (errorCount >= MAX_ERRORS) {
    document.body.innerHTML = `
      <div style="padding: 20px; text-align: center; font-family: sans-serif;">
        <h3>🚨 Too Many Errors</h3>
        <p>The popup has encountered ${errorCount} errors and will stop trying.</p>
        <button onclick="window.location.reload()" style="padding: 8px 16px; margin: 4px;">Reload</button>
        <button onclick="chrome.runtime.reload()" style="padding: 8px 16px; margin: 4px;">Reload Extension</button>
      </div>
    `;
    return true;
  }
  return false;
}

window.addEventListener('error', e => {
  if (logError('Window Error', e.error || e.message, {
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    stack: e.error?.stack
  } as any)) return;
});

window.addEventListener('unhandledrejection', e => {
  if (logError('Unhandled Rejection', e.reason)) return;
});

// Create a fallback UI function
function createFallbackUI(title: string, message: string, showReload = true) {
  const html = `
    <div style="padding: 20px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; width: 320px;">
      <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px 0; color: #495057;">${title}</h3>
        <p style="margin: 0; color: #6c757d; font-size: 14px;">${message}</p>
      </div>
      ${showReload ? `
        <div style="display: flex; gap: 8px; justify-content: center;">
          <button onclick="window.location.reload()" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Reload Popup</button>
          <button onclick="chrome.runtime.reload()" style="padding: 8px 16px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;">Reload Extension</button>
        </div>
      ` : ''}
      <div style="margin-top: 16px; font-size: 12px; color: #999;">
        Extension ID: ${chrome?.runtime?.id || 'Unknown'}<br>
        Errors: ${errorCount}/${MAX_ERRORS}
      </div>
    </div>
  `;
  document.body.innerHTML = html;
}

// Step 1: Check Chrome APIs
console.log('🔄 [RoleAlign] Step 1: Checking Chrome APIs...');
if (typeof chrome === 'undefined') {
  logError('Chrome APIs Check', 'Chrome object not available');
  createFallbackUI('❌ Chrome APIs Missing', 'This popup requires Chrome extension APIs. Make sure you are running this as a Chrome extension.');
} else {
  console.log('✅ [RoleAlign] Chrome APIs available');
  console.log('✅ [RoleAlign] Extension ID:', chrome.runtime?.id);
  
  // Step 2: Check DOM readiness
  console.log('🔄 [RoleAlign] Step 2: Checking DOM...');
  
  function initializeWhenReady() {
    if (document.readyState === 'loading') {
      console.log('⏳ [RoleAlign] DOM still loading, waiting...');
      document.addEventListener('DOMContentLoaded', initializeWhenReady);
      return;
    }
    
    console.log('✅ [RoleAlign] DOM ready, checking root element...');
    
    const container = document.getElementById("root");
    if (!container) {
      logError('DOM Check', 'Root element not found');
      createFallbackUI('❌ Root Element Missing', 'Could not find the root element to mount the React app.');
      return;
    }
    
    console.log('✅ [RoleAlign] Root element found');
    
    // Step 3: Load React with maximum safety
    console.log('🔄 [RoleAlign] Step 3: Loading React modules...');
    
    loadReactSafely(container);
  }
  
  async function loadReactSafely(container: HTMLElement) {
    try {
      // Try to load React modules one by one
      console.log('🔄 [RoleAlign] Loading React...');
      const React = await import("react");
      console.log('✅ [RoleAlign] React loaded');
      
      console.log('🔄 [RoleAlign] Loading ReactDOM...');
      const ReactDOM = await import("react-dom/client");
      console.log('✅ [RoleAlign] ReactDOM loaded');
      
      const ReactModule = React.default || React;
      const { createRoot } = ReactDOM;
      
      if (!createRoot) {
        throw new Error('createRoot not found in ReactDOM');
      }
      
      console.log('🔄 [RoleAlign] Creating React root...');
      const root = createRoot(container);
      console.log('✅ [RoleAlign] React root created');
      
      // Step 4: Load and render App component
      console.log('🔄 [RoleAlign] Step 4: Loading App component...');
      
      try {
        // Load the full App component
        const { default: App } = await import("./App");
        console.log('✅ [RoleAlign] App component loaded');
        
        console.log('🔄 [RoleAlign] Rendering App...');
        root.render(
          ReactModule.createElement(ReactModule.StrictMode, null,
            ReactModule.createElement(App)
          )
        );
        console.log('🎉 [RoleAlign] App rendered successfully!');
        
      } catch (appError) {
        logError('App Loading', appError);
        
        // Render a simple fallback component instead
        console.log('🔄 [RoleAlign] Attempting fallback component...');
        const FallbackComponent = () => ReactModule.createElement('div', {
          style: { padding: '20px', textAlign: 'center', fontFamily: 'sans-serif' }
        }, [
          ReactModule.createElement('h3', { key: 'title' }, '⚠️ Main App Failed'),
          ReactModule.createElement('p', { key: 'msg' }, 'The main application failed to load, but React is working.'),
          ReactModule.createElement('button', {
            key: 'reload',
            onClick: () => window.location.reload(),
            style: { padding: '8px 16px', margin: '4px' }
          }, 'Reload'),
          ReactModule.createElement('pre', {
            key: 'error',
            style: { textAlign: 'left', fontSize: '10px', background: '#f5f5f5', padding: '8px' }
          }, appError instanceof Error ? appError.message : String(appError))
        ]);
        
        root.render(ReactModule.createElement(FallbackComponent));
        console.log('✅ [RoleAlign] Fallback component rendered');
      }
      
    } catch (reactError) {
      logError('React Loading', reactError);
      createFallbackUI('❌ React Load Failed', 'Could not load React dependencies. This might be a bundling issue.');
    }
  }
  
  // Start initialization
  initializeWhenReady();
}

// --- If you have SSR, use this instead ---
// import { hydrateRoot } from "react-dom/client";
// hydrateRoot(
//   container,
//   <React.StrictMode>
//     <App />
//   </React.StrictMode>
// );
