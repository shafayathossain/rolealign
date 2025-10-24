#!/bin/bash

# Launch Chrome with AI APIs enabled for RoleAlign development
# This script ensures Chrome is launched with all required flags for Chrome AI APIs

# Kill any existing Chrome processes
echo "🔄 Closing existing Chrome instances..."
pkill -f "Google Chrome" || true
sleep 2

# Build the extension first
echo "🔨 Building extension..."
pnpm build

# Chrome executable path (adjust if needed)
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Extension path
EXTENSION_PATH="$(pwd)/.output/chrome-mv3"

# Required Chrome flags for AI APIs
CHROME_FLAGS=(
    "--enable-features=PromptAPIForGeminiNano,SummarizationAPIForGeminiNano,TranslationAPI"
    "--enable-experimental-web-platform-features"
    "--disable-web-security"
    "--disable-features=VizDisplayCompositor"
    "--user-data-dir=/tmp/chrome-dev-ai"
    "--load-extension=$EXTENSION_PATH"
    "--new-window"
    "--no-first-run"
    "--no-default-browser-check"
)

echo "🚀 Launching Chrome with AI APIs enabled..."
echo "📁 Extension path: $EXTENSION_PATH"
echo "🧪 Debug page will be available at: chrome-extension://[extension-id]/debug-ai.html"

# Launch Chrome with all flags
"$CHROME_PATH" "${CHROME_FLAGS[@]}" "http://localhost:3001/debug-ai.html" &

echo "✅ Chrome launched with AI APIs enabled!"
echo ""
echo "📋 Next steps:"
echo "1. Check chrome://flags to see if flags are active (they may show as 'Default' but still work)"
echo "2. Open chrome://extensions to find your extension ID"
echo "3. Navigate to chrome-extension://[your-extension-id]/debug-ai.html to test AI APIs"
echo "4. Or run this in the browser console:"
echo "   console.log('AI available:', !!globalThis.ai?.languageModel)"
echo ""
echo "🛑 To stop: Press Ctrl+C or close Chrome manually"