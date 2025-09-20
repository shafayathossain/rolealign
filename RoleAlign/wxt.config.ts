import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: {
    // lock CSP early; keep popup safe
    build: { target: "es2022" },
  },
  manifest: {
    manifest_version: 3,
    name: "RoleAlign",
    version: "0.1.0",
    description: "AI-powered CV tailoring and job matching, all on-device.",
    action: { default_popup: "popup.html" },
    // keep permissions minimal
    permissions: ["storage", "activeTab"],
    // host permissions only for sites you actually parse
    host_permissions: [
      "https://www.linkedin.com/*",
      "https://www.indeed.com/*",
    ],
    // isolate content scripts; run when DOM is ready
    content_scripts: [
      {
        matches: ["https://www.linkedin.com/*/jobs/*", "https://www.linkedin.com/jobs/*"],
        js: ["content/linkedin.content.js"],
        run_at: "document_idle",
        world: "ISOLATED",
      },
      {
        matches: ["https://www.indeed.com/*"],
        js: ["content/indeed.content.js"],
        run_at: "document_idle",
        world: "ISOLATED",
      },
    ],
    icons: {
      "16": "icon/16.png",
      "32": "icon/32.png",
      "48": "icon/48.png",
      "96": "icon/96.png",
      "128": "icon/128.png",
    },
    // lock down CSP (adjust if you add external fonts etc.)
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; style-src 'self' 'unsafe-inline';",
    },
  },
});
