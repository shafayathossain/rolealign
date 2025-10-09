import React from "react";

export default function SimpleTest() {
  return (
    <div style={{ 
      padding: 16, 
      textAlign: "center", 
      width: 340, 
      minHeight: 200,
      backgroundColor: "#f9f9f9",
      border: "1px solid #ddd",
      borderRadius: 8,
      fontFamily: "Arial, sans-serif"
    }}>
      <h1 style={{ 
        fontSize: 18, 
        margin: "0 0 12px 0", 
        color: "#333" 
      }}>
        🎯 Simple Test
      </h1>
      <p style={{ 
        fontSize: 14, 
        margin: "0 0 16px 0", 
        color: "#666" 
      }}>
        If you see this, React is working fine!
      </p>
      <div style={{ 
        marginBottom: 16, 
        fontSize: 12, 
        color: "#555",
        textAlign: "left",
        backgroundColor: "white",
        padding: 12,
        borderRadius: 4,
        border: "1px solid #eee"
      }}>
        <div><strong>Chrome available:</strong> {typeof chrome !== 'undefined' ? 'Yes' : 'No'}</div>
        <div><strong>Extension ID:</strong> {chrome?.runtime?.id || 'Unknown'}</div>
        <div><strong>Location:</strong> {window.location.href}</div>
      </div>
      <button 
        onClick={() => {
          console.log("🎯 Simple test button clicked");
          console.log("🎯 Chrome runtime:", chrome?.runtime?.id);
          alert("✅ Button works! Check console for logs.");
        }}
        style={{
          width: "100%",
          padding: "12px 16px",
          backgroundColor: "#4CAF50",
          color: "white",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 14,
          fontWeight: "bold"
        }}
      >
        🎯 Test Click (Check Console)
      </button>
    </div>
  );
}