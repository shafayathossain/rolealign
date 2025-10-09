// Simple popup version for debugging React issues
import React from 'react';

const SimplePopup: React.FC = () => {
  const [status, setStatus] = React.useState<string>('Initializing...');
  const [logs, setLogs] = React.useState<string[]>([]);

  const addLog = (message: string) => {
    console.log(`[SimplePopup] ${message}`);
    setLogs(prev => [...prev.slice(-5), `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  React.useEffect(() => {
    const initialize = async () => {
      try {
        addLog('Starting initialization');
        
        // Test Chrome APIs
        if (typeof chrome === 'undefined') {
          throw new Error('Chrome APIs not available');
        }
        addLog('Chrome APIs available');

        // Test basic messaging
        if (!chrome.runtime?.sendMessage) {
          throw new Error('chrome.runtime.sendMessage not available');
        }
        addLog('Messaging API available');

        setStatus('✅ Ready');
        addLog('Initialization complete');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setStatus(`❌ Error: ${errorMsg}`);
        addLog(`Error: ${errorMsg}`);
      }
    };

    initialize();
  }, []);

  const testPing = async () => {
    try {
      addLog('Testing background communication...');
      chrome.runtime.sendMessage({ type: 'PING', payload: {} }, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          addLog(`Background error: ${error.message}`);
        } else {
          addLog('Background ping successful');
        }
      });
    } catch (error) {
      addLog(`Ping failed: ${error}`);
    }
  };

  const loadMainPopup = () => {
    window.location.href = 'popup.html';
  };

  return (
    <div style={{ 
      width: 360, 
      padding: 16, 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: 14
    }}>
      <div style={{ 
        background: '#f0f8ff', 
        padding: 12, 
        borderRadius: 8, 
        marginBottom: 16,
        border: '1px solid #cce7ff'
      }}>
        <h2 style={{ margin: '0 0 8px 0', fontSize: 16 }}>🔧 RoleAlign Debug</h2>
        <div><strong>Status:</strong> {status}</div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Actions</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button 
            onClick={testPing}
            style={{
              padding: '6px 12px',
              background: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            Test Background
          </button>
          <button 
            onClick={loadMainPopup}
            style={{
              padding: '6px 12px',
              background: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            Load Main Popup
          </button>
          <button 
            onClick={() => window.location.reload()}
            style={{
              padding: '6px 12px',
              background: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            Reload
          </button>
        </div>
      </div>

      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Debug Log</h3>
        <div style={{
          background: '#f8f9fa',
          padding: 8,
          borderRadius: 4,
          border: '1px solid #dee2e6',
          minHeight: 100,
          fontSize: 11,
          fontFamily: 'monospace'
        }}>
          {logs.length === 0 ? 'No logs yet...' : logs.map((log, i) => (
            <div key={i} style={{ marginBottom: 2 }}>{log}</div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
        <div>Extension ID: {chrome?.runtime?.id || 'Unknown'}</div>
        <div>Chrome APIs: {typeof chrome !== 'undefined' ? '✅' : '❌'}</div>
        <div>React: {React ? '✅' : '❌'}</div>
      </div>
    </div>
  );
};

export default SimplePopup;