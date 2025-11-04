// background.js

const API_KEY = " "; // Your API key

const CORRECT_MODEL_NAME = "gemini-2.5-flash"; 
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${CORRECT_MODEL_NAME}:generateContent?key=${API_KEY}`;


async function imageUrlToBase64(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function getAiResponse(payload) {
    console.log(`[${new Date().toLocaleTimeString()}] MAKING API CALL. Type: ${payload.type}. Model: ${CORRECT_MODEL_NAME}`);
    let prompt;
    let parts = []; // Initialize parts array here

    try {
        if (payload.type === 'text') {
            prompt = `Analyze the following text and provide a direct answer and a step-by-step explanation. Respond ONLY with a valid JSON object in the format: {"answer": "The correct option", "explanation": "Your explanation"}\n\n${payload.data}`;
            parts.push({ text: prompt });
        } else if (payload.type === 'screenshot') {
            prompt = "From this screenshot, find the primary question and provide its correct answer and a step-by-step explanation. Respond ONLY with a valid JSON object in the format: {\"answer\": \"The correct option\", \"explanation\": \"Your explanation\"}";
            parts.push({ text: prompt });
            parts.push({ inline_data: { mime_type: "image/png", data: payload.data.split(',')[1] } });
        } else if (payload.type === 'image') {
            prompt = `Using the following image, and the context passage if provided, answer the question. Respond ONLY with a valid JSON object in the format: {"answer": "The correct option", "explanation": "Your explanation"}\n\nContext: ${payload.context || 'None'}`;
            parts.push({ text: prompt });
            const imageData = await imageUrlToBase64(payload.data);
            parts.push({ inline_data: { mime_type: "image/png", data: imageData } });
        } else {
            console.error("Unknown payload type:", payload.type);
            return { error: "Unknown content type detected." };
        }
        
        const requestBody = { contents: [{ parts: parts }] };
        
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorText = await response.text(); // Get more details for error
          throw new Error(`API request failed with status ${response.status} - ${response.statusText}. Details: ${errorText}`);
        }
        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
            console.error("API response had no text content:", data);
            throw new Error("Could not parse text from AI response (empty content).");
        }
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn("AI did not provide structured JSON. Returning raw text.");
            return { answer: rawText, explanation: "(AI did not provide a structured response)" };
        }
        return JSON.parse(jsonMatch[0]);
    } catch (error) {        
        console.error("API call error in getAiResponse:", error);
        return { error: error.message };
    }
}

// --- Listener for messages from popup.js ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getAiAnswer") {
    // For popup, we get the content first
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (!tabs[0]) {
            sendResponse({ error: "No active tab found." });
            return;
        }

        let content;
        try {
            content = await chrome.tabs.sendMessage(tabs[0].id, { action: "findContent" });
            console.log("[background.js] Content found for popup:", content.type);
        } catch (e) {
            console.warn("[background.js] Content script connection failed for popup. Error:", e);
            sendResponse({ error: "Could not communicate with content script." });
            return;
        }

        let requestPayload = {};
        if (content && content.type === 'text') {
            requestPayload = { type: 'text', data: content.data };
        } else if (content && content.type === 'image') {
            requestPayload = { type: 'image', data: content.data, context: content.context };
        } else { 
            sendResponse({ error: "No relevant content found on page for manual processing." });
            return; 
        }

        const aiResponse = await getAiResponse(requestPayload);
        sendResponse(aiResponse);
    });
    return true; 
  }
});


// --- Listener for the keyboard shortcut (floating window on page) ---
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "find_answer_shortcut") {
    console.log("[background.js] Shortcut pressed! Initiating floating window flow.");

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
        console.error("[background.js] No active tab found for shortcut.");
        return;
    }

    // 1. Show initial "Detecting content..." message on the PAGE
    try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showTemporaryStatusMessage, args: ["Detecting content..."] });
        console.log("[background.js] showTemporaryStatusMessage injected: Detecting content...");
    } catch (e) {
        console.error("[background.js] Failed to inject showTemporaryStatusMessage:", e);
    }
    
    let content;
    try {
      content = await chrome.tabs.sendMessage(tab.id, { action: "findContent" });
      console.log("[background.js] Content found:", content.type);
    } catch (e) {
      console.warn("[background.js] Content script connection failed, trying screenshot fallback. Error:", e);
      content = { type: 'nothing_found' };
    }
    
    let requestPayload = {};
    if (content && content.type === 'text') {
      try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showTemporaryStatusMessage, args: ["Found text, asking AI..."] });
          console.log("[background.js] showTemporaryStatusMessage injected: Found text...");
      } catch (e) { console.error("[background.js] Failed to update status for text:", e); }
      requestPayload = { type: 'text', data: content.data };
    } else if (content && content.type === 'image') {
      try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showTemporaryStatusMessage, args: ["Found image, asking AI..."] });
          console.log("[background.js] showTemporaryStatusMessage injected: Found image...");
      } catch (e) { console.error("[background.js] Failed to update status for image:", e); }
      requestPayload = { type: 'image', data: content.data, context: content.context };
    } else { // Fallback to screenshot for the shortcut
      try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showTemporaryStatusMessage, args: ["Nothing found, taking screenshot..."] });
          console.log("[background.js] showTemporaryStatusMessage injected: Taking screenshot...");
      } catch (e) { console.error("[background.js] Failed to update status for screenshot:", e); }
      
      const screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
      requestPayload = { type: 'screenshot', data: screenshotDataUrl };
    }

    const aiResponse = await getAiResponse(requestPayload);
    console.log("[background.js] AI Response received.");

    // 2. Display the final answer in a floating window on the PAGE
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: displayFinalAnswer,
            args: [aiResponse] 
        });
        console.log("[background.js] displayFinalAnswer injected.");
    } catch (e) {
        console.error("[background.js] Failed to inject displayFinalAnswer:", e);
        // Fallback to console if injection fails
        chrome.scripting.executeScript({ 
            target: { tabId: tab.id }, 
            func: showTemporaryStatusMessage, 
            args: [`Error displaying answer: ${e.message}. See console.`] 
        });
    }
  }
});

// --- INJECTED UI FUNCTIONS ---
// These functions are defined here but injected into the content script's context.
// They must be entirely self-contained.

function showTemporaryStatusMessage(message) {
  let statusDiv = document.getElementById('ai-helper-status');
  if (!statusDiv) {
    statusDiv = document.createElement('div');
    statusDiv.id = 'ai-helper-status';
    statusDiv.style.position = 'fixed';
    statusDiv.style.top = '20px';
    statusDiv.style.right = '20px';
    statusDiv.style.backgroundColor = '#333';
    statusDiv.style.color = 'white';
    statusDiv.style.padding = '10px 15px';
    statusDiv.style.borderRadius = '5px';
    statusDiv.style.zIndex = '9999999';
    statusDiv.style.fontFamily = 'sans-serif';
    statusDiv.style.maxWidth = '300px'; 
    statusDiv.style.wordBreak = 'break-word'; 
    document.body.appendChild(statusDiv);
  }
  statusDiv.textContent = message;
}

function displayFinalAnswer(response) {
  // Try to remove any existing status message
  const existingStatusDiv = document.getElementById('ai-helper-status');
  if (existingStatusDiv) {
    existingStatusDiv.remove();
  }

  let answerDiv = document.getElementById('ai-helper-answer');
  if (!answerDiv) {
    answerDiv = document.createElement('div');
    answerDiv.id = 'ai-helper-answer';
    answerDiv.style.position = 'fixed';
    answerDiv.style.bottom = '20px';
    answerDiv.style.left = '50%';
    answerDiv.style.transform = 'translateX(-50%)';
    answerDiv.style.width = 'fit-content';
    answerDiv.style.maxWidth = '80%';
    answerDiv.style.backgroundColor = '#333';
    answerDiv.style.color = 'white';
    answerDiv.style.padding = '15px 20px';
    answerDiv.style.borderRadius = '8px';
    answerDiv.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
    answerDiv.style.zIndex = '9999999';
    answerDiv.style.fontFamily = 'sans-serif';
    answerDiv.style.textAlign = 'left';
    answerDiv.style.wordBreak = 'break-word'; 
    document.body.appendChild(answerDiv);
  }

  if (response.error) {
    answerDiv.style.backgroundColor = '#D93025'; 
    answerDiv.innerHTML = `<strong>Error:</strong> ${response.error}`;
  } else {
    answerDiv.style.backgroundColor = '#1A73E8'; 
    answerDiv.innerHTML = `<strong>Answer:</strong> ${response.answer}<br><hr style="border-top: 1px solid #ccc; border-bottom: none; margin: 10px 0;"><em>${response.explanation}</em>`;
  }

  setTimeout(() => {
    if (answerDiv) answerDiv.remove();
  }, 20000); 
}