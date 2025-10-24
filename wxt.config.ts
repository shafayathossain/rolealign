import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  entrypointsDir: "entrypoints",
  manifest: {
    manifest_version: 3,
    name: "RoleAlign",
    version: "0.1.0",
    description: "AI-powered CV tailoring and job matching, all on-device.",
    action: { 
      default_popup: "popup/redirect.html",
      default_title: "RoleAlign - AI CV Tailoring"
    },

    // minimal permissions
    permissions: ["storage", "activeTab", "scripting", "tabs"],

    // host permissions only for sites you parse
    host_permissions: [
      "https://www.linkedin.com/*",
      "https://www.indeed.com/*",
      ...(process.env.NODE_ENV === "development" ? ["http://localhost/*"] : []),
    ],

    // content scripts are auto-detected from entrypoints/
    icons: {
      "16": "icon/16.png",
      "32": "icon/32.png",
      "48": "icon/48.png",
      "96": "icon/96.png",
      "128": "icon/128.png",
    },

    // strict CSP for extension pages with better React compatibility
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; style-src 'self' 'unsafe-inline';",
    },

    // allow chunks/assets for extension pages
    web_accessible_resources: [
      {
        resources: ["assets/*", "chunks/*", "pdf.worker.*"],
        matches: ["<all_urls>"],
      },
    ],
  },

  // WXT v0.20 expects this to be a function
  vite() {
    return {
      build: {
        // ✅ Vite 7+ option name
        modulePreload: { polyfill: false },
        sourcemap: true,
        target: "chrome120",
        // Let WXT handle chunking strategy
      },
      worker: {
        format: "es",
      },
      define: {
        "process.env.NODE_ENV": JSON.stringify(
          process.env.NODE_ENV || "development"
        ),
      },
      optimizeDeps: {
        include: ['react', 'react-dom'],
      },
    };
  },
});
