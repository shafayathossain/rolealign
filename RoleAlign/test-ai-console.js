// Run this in the browser console to test Chrome AI APIs
// Copy and paste this entire script into the DevTools console

console.log('🧪 Testing Chrome AI APIs...');

async function testChromeAI() {
    try {
        // Check if AI object exists
        const ai = globalThis.ai || window.ai;
        console.log('AI object:', ai);
        
        if (!ai) {
            console.error('❌ AI object not found - Chrome AI APIs not available');
            return false;
        }
        
        console.log('✅ AI object found');
        
        // Test Language Model (Prompt API)
        if (ai.languageModel) {
            console.log('✅ Language Model API available');
            try {
                const capabilities = await ai.languageModel.canCreate();
                console.log('📊 Language Model capabilities:', capabilities);
                
                if (capabilities.available === 'readily') {
                    console.log('🚀 Creating language model session...');
                    const session = await ai.languageModel.create();
                    console.log('✅ Language model session created!');
                    
                    const response = await session.prompt('Say "Hello from Chrome AI!"');
                    console.log('🤖 AI Response:', response);
                } else if (capabilities.available === 'after-download') {
                    console.log('⏳ Language model available after download');
                } else {
                    console.log('❌ Language model not available');
                }
            } catch (e) {
                console.error('❌ Language Model test failed:', e);
            }
        } else {
            console.error('❌ Language Model API not available');
        }
        
        // Test Summarizer API
        if (ai.summarizer) {
            console.log('✅ Summarizer API available');
            try {
                const capabilities = await ai.summarizer.canCreate();
                console.log('📊 Summarizer capabilities:', capabilities);
            } catch (e) {
                console.error('❌ Summarizer test failed:', e);
            }
        } else {
            console.error('❌ Summarizer API not available');
        }
        
        // Test Translator API
        if (ai.translator) {
            console.log('✅ Translator API available');
            try {
                const capabilities = await ai.translator.canCreate({ source: 'en', target: 'es' });
                console.log('📊 Translator capabilities:', capabilities);
            } catch (e) {
                console.error('❌ Translator test failed:', e);
            }
        } else {
            console.error('❌ Translator API not available');
        }
        
        return true;
    } catch (error) {
        console.error('❌ Overall test failed:', error);
        return false;
    }
}

// Run the test
testChromeAI().then(success => {
    if (success) {
        console.log('🎉 Chrome AI API test completed!');
    } else {
        console.log('💔 Chrome AI APIs are not working properly');
        console.log('💡 This might mean:');
        console.log('   1. Chrome flags are not properly enabled');
        console.log('   2. Chrome version doesn\'t support AI APIs');
        console.log('   3. Device doesn\'t support on-device AI');
    }
});