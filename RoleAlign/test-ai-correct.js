// Correct Chrome AI API Test - Based on Official Documentation
// Paste this into browser console

console.log('🔬 Chrome AI API Test (Official Method)');
console.log('=====================================');

// Check Chrome version
const userAgent = navigator.userAgent;
const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
if (chromeMatch) {
    const version = parseInt(chromeMatch[1]);
    console.log(`Chrome Version: ${version}`);
    if (version < 127) {
        console.error('❌ Chrome version too old! Need 127+');
    } else {
        console.log('✅ Chrome version should support AI APIs');
    }
} else {
    console.error('❌ Not running on Chrome');
}

async function testAIAPIs() {
    console.log('\n🤖 Testing AI APIs with correct methods...');
    
    // Test LanguageModel (Prompt API)
    console.log('\n--- LanguageModel (Prompt API) ---');
    if ('LanguageModel' in self) {
        console.log('✅ LanguageModel API exists');
        try {
            const availability = await LanguageModel.availability();
            console.log('📊 LanguageModel availability:', availability);
            
            switch(availability) {
                case 'available':
                    console.log('🚀 LanguageModel is ready to use!');
                    // Try creating a session
                    try {
                        const session = await LanguageModel.create();
                        console.log('✅ LanguageModel session created successfully');
                        const response = await session.prompt('Say hello');
                        console.log('🤖 Response:', response);
                    } catch (e) {
                        console.error('❌ Failed to create session:', e);
                    }
                    break;
                case 'downloadable':
                    console.log('⏳ Model needs download (requires user activation)');
                    console.log('💡 Try clicking a button first, then call LanguageModel.create()');
                    break;
                case 'downloading':
                    console.log('📥 Model is currently downloading...');
                    break;
                case 'unavailable':
                    console.log('❌ LanguageModel not available on this device');
                    break;
                default:
                    console.log('❓ Unknown availability status:', availability);
            }
        } catch (e) {
            console.error('❌ Error checking LanguageModel availability:', e);
        }
    } else {
        console.log('❌ LanguageModel API not found');
        console.log('💡 Make sure chrome://flags/#prompt-api-for-gemini-nano is ENABLED');
    }
    
    // Test Summarizer API
    console.log('\n--- Summarizer API ---');
    if ('Summarizer' in self) {
        console.log('✅ Summarizer API exists');
        try {
            const availability = await Summarizer.availability();
            console.log('📊 Summarizer availability:', availability);
            
            switch(availability) {
                case 'available':
                    console.log('🚀 Summarizer is ready to use!');
                    break;
                case 'downloadable':
                    console.log('⏳ Model needs download (requires user activation)');
                    break;
                case 'downloading':
                    console.log('📥 Model is currently downloading...');
                    break;
                case 'unavailable':
                    console.log('❌ Summarizer not available on this device');
                    break;
                default:
                    console.log('❓ Unknown availability status:', availability);
            }
        } catch (e) {
            console.error('❌ Error checking Summarizer availability:', e);
        }
    } else {
        console.log('❌ Summarizer API not found');
        console.log('💡 Make sure chrome://flags/#summarization-api-for-gemini-nano is ENABLED');
    }
    
    // Test Translator API  
    console.log('\n--- Translator API ---');
    if ('Translator' in self) {
        console.log('✅ Translator API exists');
        try {
            const availability = await Translator.availability();
            console.log('📊 Translator availability:', availability);
        } catch (e) {
            console.error('❌ Error checking Translator availability:', e);
        }
    } else {
        console.log('❌ Translator API not found');
        console.log('💡 Make sure chrome://flags/#translation-api is ENABLED');
    }
}

// Run the test
testAIAPIs().then(() => {
    console.log('\n📍 Test completed!');
    console.log('📍 Location:', window.location.href);
    console.log('📍 Extension Context:', !!chrome?.runtime?.id);
    
    console.log('\n💡 Next steps if APIs not available:');
    console.log('1. Go to chrome://flags/');
    console.log('2. Enable: prompt-api-for-gemini-nano');
    console.log('3. Enable: summarization-api-for-gemini-nano'); 
    console.log('4. Enable: translation-api');
    console.log('5. Restart Chrome completely');
    console.log('6. Check hardware requirements (22GB free space, 4GB+ VRAM)');
    console.log('=====================================');
}).catch(e => {
    console.error('Test failed:', e);
});