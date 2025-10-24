// React PDF External Loader
// This script can be included in cv-builder.html to load React PDF from CDN

(function() {
  'use strict';
  
  const log = {
    info: (msg, data) => console.log(`[REACT-PDF-LOADER] ${msg}`, data || ''),
    error: (msg, data) => console.error(`[REACT-PDF-LOADER] ${msg}`, data || ''),
    debug: (msg, data) => console.debug(`[REACT-PDF-LOADER] ${msg}`, data || '')
  };

  // Check if we should load React PDF
  const shouldLoadReactPDF = new URLSearchParams(window.location.search).get('pdf') === 'true';
  
  if (!shouldLoadReactPDF) {
    log.debug("React PDF loading skipped (pdf=true not in URL)");
    return;
  }

  // Load React and React PDF from CDN
  function loadScript(src, onLoad, onError) {
    const script = document.createElement('script');
    script.src = src;
    script.onload = onLoad;
    script.onerror = onError;
    document.head.appendChild(script);
  }

  function loadReactPDF() {
    log.info("Loading React PDF from CDN...");
    
    // Load React first
    loadScript(
      'https://unpkg.com/react@18/umd/react.production.min.js',
      () => {
        log.debug("React loaded successfully");
        
        // Load React DOM
        loadScript(
          'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
          () => {
            log.debug("React DOM loaded successfully");
            
            // Load React PDF
            loadScript(
              'https://unpkg.com/@react-pdf/renderer@3.1.12/lib/react-pdf.browser.js',
              () => {
                log.info("React PDF loaded successfully");
                
                // Create CV Document component
                createCVDocumentComponent();
                
                // Notify that React PDF is ready
                window.dispatchEvent(new CustomEvent('react-pdf-ready'));
              },
              (error) => {
                log.error("Failed to load React PDF", error);
              }
            );
          },
          (error) => {
            log.error("Failed to load React DOM", error);
          }
        );
      },
      (error) => {
        log.error("Failed to load React", error);
      }
    );
  }

  function createCVDocumentComponent() {
    if (!window.React || !window.ReactPDF) {
      log.error("React or ReactPDF not available");
      return;
    }

    const { Document, Page, Text, View, StyleSheet } = window.ReactPDF;
    const React = window.React;

    // Create styles
    const styles = StyleSheet.create({
      page: {
        padding: 30,
        fontSize: 11,
        fontFamily: 'Helvetica',
        lineHeight: 1.5,
      },
      header: {
        marginBottom: 20,
        textAlign: 'center',
        borderBottom: '2 solid #2563eb',
        paddingBottom: 10,
      },
      name: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#1e40af',
        marginBottom: 5,
      },
      section: {
        marginBottom: 15,
      },
      sectionTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#1e40af',
        borderBottom: '1 solid #e5e7eb',
        paddingBottom: 3,
        marginBottom: 8,
      },
    });

    // Create CV Document component
    window.CVDocument = function({ cv }) {
      return React.createElement(Document, null,
        React.createElement(Page, { size: "A4", style: styles.page },
          // Header
          React.createElement(View, { style: styles.header },
            React.createElement(Text, { style: styles.name }, cv.personalInfo.name),
            React.createElement(Text, null, cv.personalInfo.email)
          ),
          
          // Summary
          cv.summary && React.createElement(View, { style: styles.section },
            React.createElement(Text, { style: styles.sectionTitle }, "Professional Summary"),
            React.createElement(Text, null, cv.summary)
          ),
          
          // Experience
          cv.experience && cv.experience.length > 0 && React.createElement(View, { style: styles.section },
            React.createElement(Text, { style: styles.sectionTitle }, "Professional Experience"),
            ...cv.experience.map((exp, index) =>
              React.createElement(View, { key: index, style: { marginBottom: 10 } },
                React.createElement(Text, { style: { fontWeight: 'bold' } }, exp.position),
                React.createElement(Text, { style: { color: '#2563eb' } }, exp.company),
                React.createElement(Text, { style: { fontSize: 9, color: '#6b7280' } }, 
                  `${exp.startDate} - ${exp.endDate}`)
              )
            )
          ),
          
          // Skills
          cv.skills && cv.skills.length > 0 && React.createElement(View, { style: styles.section },
            React.createElement(Text, { style: styles.sectionTitle }, "Technical Skills"),
            React.createElement(Text, null, cv.skills.join(', '))
          )
        )
      );
    };

    log.info("CV Document component created");
  }

  // Start loading if in browser environment
  if (typeof window !== 'undefined') {
    loadReactPDF();
  }
})();