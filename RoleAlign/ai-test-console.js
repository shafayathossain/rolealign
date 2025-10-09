// Quick Chrome AI API Test - Paste this into browser console
// Tests whether Chrome AI APIs are actually available

console.log('🔬 Chrome AI API Quick Test');
console.log('==========================');

// Check Chrome version
const userAgent = navigator.userAgent;
const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
if (chromeMatch) {
    const version = parseInt(chromeMatch[1]);
    console.log(`Chrome Version: ${version}`);
    if (version < 137) {
        console.error('❌ Chrome version too old! Need 137+');
    } else {
        console.log('✅ Chrome version supports AI APIs');
    }
} else {
    console.error('❌ Not running on Chrome');
}

// Test AI object availability
console.log('\n🤖 Testing AI Object...');
const ai = globalThis.ai || window.ai;

if (!ai) {
    console.error('❌ NO AI OBJECT FOUND');
    console.log('💡 Possible fixes:');
    console.log('1. Go to chrome://flags/');
    console.log('2. Search for "Prompt API for Gemini Nano" and set to ENABLED');
    console.log('3. Search for "Summarization API for Gemini Nano" and set to ENABLED');
    console.log('4. Search for "Translation API" and set to ENABLED');
    console.log('5. Restart Chrome completely');
    console.log('6. Try Chrome Canary if on older Chrome');
} else {
    console.log('✅ AI object found!');
    console.log('AI object:', ai);
    console.log('Available APIs:', Object.getOwnPropertyNames(ai));
    
    // Test each API
    if (ai.languageModel) {
        console.log('✅ languageModel API available');
        ai.languageModel.canCreate().then(caps => {
            console.log('Language Model capabilities:', caps);
            if (caps.available === 'readily') {
                console.log('🚀 Language Model is ready to use!');
            } else {
                console.log('⚠️ Language Model status:', caps.available);
            }
        }).catch(e => console.error('Language Model error:', e));
    } else {
        console.error('❌ languageModel API missing');
    }
    
    if (ai.summarizer) {
        console.log('✅ summarizer API available');
    } else {
        console.error('❌ summarizer API missing');
    }
    
    if (ai.translator) {
        console.log('✅ translator API available');
    } else {
        console.error('❌ translator API missing');
    }
}

console.log('\n📍 Test Location:', window.location.href);
console.log('📍 Extension Context:', !!chrome?.runtime?.id);
console.log('==========================');
console.log('Copy this output and share for debugging');