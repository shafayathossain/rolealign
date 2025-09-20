import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: "Role Align",
    version: "0.0.1",
    description: "AI-powered CV tailoring and job matching, all on-device.",
    action: {
      default_popup: "popup.html",
    },
    permissions: ["storage", "activetab", "scripting"],
    host_permissions: ["https://www.linkedin.com/*", "https://www.indeed.com/*"],
    content_scripts: [
      {
        matches: ["https://www.linkedin.com/*", "https://www.indeed.com/*"],
        js: ["content/linkedin.content.js", "content/indeed.content.js"],
        run_at: "document_end"
      },
    ],
  },
});
