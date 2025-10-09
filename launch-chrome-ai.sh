#!/bin/bash

# Launch Chrome with AI flags enabled for development
# Tested on macOS - adjust Chrome path for other platforms

CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Get the absolute path of the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
EXTENSION_DIR="$SCRIPT_DIR/RoleAlign/.output/chrome-mv3"

# Create a temporary profile directory to avoid conflicts
PROFILE_DIR="/tmp/chrome-ai-dev-profile"
rm -rf "$PROFILE_DIR"
mkdir -p "$PROFILE_DIR"

echo "Launching Chrome with AI flags enabled..."
echo "Profile: $PROFILE_DIR"
echo "Extension directory: $EXTENSION_DIR"
echo ""

# Build the extension first
echo "Building extension..."
cd "$SCRIPT_DIR/RoleAlign" && pnpm build
BUILD_RESULT=$?

if [ $BUILD_RESULT -ne 0 ]; then
    echo "Build failed. Exiting."
    exit 1
fi

# Verify extension directory exists
if [ ! -d "$EXTENSION_DIR" ]; then
    echo "Extension directory not found: $EXTENSION_DIR"
    echo "Please ensure the build completed successfully."
    exit 1
fi

echo "Extension built successfully at: $EXTENSION_DIR"
echo "Launching Chrome..."

# Launch Chrome with all necessary flags
"$CHROME_PATH" \
  --enable-features=OptimizationGuideOnDeviceModel,Translate,TranslateOmnibox,AIPromptAPI,AISummarizationAPI,AIWriterAPI,AIRewriterAPI \
  --force-enable-optimization-guide-on-device-model=Gemini%20Nano \
  --enable-blink-features=AIPromptAPI,AISummarizationAPI,AIWriterAPI,AIRewriterAPI \
  --optimization-guide-on-device-model-execution-override=EXECUTE_IMMEDIATELY \
  --disable-component-update \
  --user-data-dir="$PROFILE_DIR" \
  --load-extension="$EXTENSION_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "https://www.linkedin.com/jobs/"

echo "Chrome closed. Cleaning up..."
rm -rf "$PROFILE_DIR"