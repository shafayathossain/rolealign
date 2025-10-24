// Popup redirect script - opens full interface in new tab
console.log('RoleAlign popup redirect starting...');

// Immediately open the full interface in a new tab
chrome.tabs.create({
    url: chrome.runtime.getURL('interface.html'),
    active: true
}).then(() => {
    console.log('RoleAlign interface opened in new tab');
    // Close this popup
    window.close();
}).catch(error => {
    console.error('Failed to open interface:', error);
    document.body.innerHTML = `
        <div style="padding: 20px; text-align: center;">
            <h3>❌ Error</h3>
            <p>Could not open interface</p>
            <button onclick="window.close()" style="padding: 8px 16px; background: white; color: #667eea; border: none; border-radius: 4px; cursor: pointer;">Close</button>
        </div>
    `;
});