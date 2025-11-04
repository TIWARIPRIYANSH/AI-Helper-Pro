document.addEventListener('DOMContentLoaded', function() {
    const findContentBtn = document.getElementById('findContentBtn');
    const resultDiv = document.getElementById('result');
    const statusDiv = document.getElementById('status');
    const screenshotBtn = document.getElementById('screenshotBtn');
    const screenshotImg = document.getElementById('screenshotImg');
    const retryBtn = document.getElementById('retryBtn');

    // Function to display messages in the popup's status area
    function displayStatus(message, isError = false) {
        statusDiv.textContent = message;
        statusDiv.style.color = isError ? 'red' : 'green';
        statusDiv.style.display = 'block';
    }

    // Function to display the AI response in the popup's result area
    function displayResult(response) {
        statusDiv.style.display = 'none'; // Hide status
        resultDiv.style.display = 'block';
        if (response.error) {
            resultDiv.innerHTML = `<p style="color: red;"><strong>Error:</strong> ${response.error}</p>`;
        } else {
            resultDiv.innerHTML = `
                <p><strong>Answer:</strong> ${response.answer}</p>
                <hr>
                <p><em>${response.explanation}</em></p>
            `;
        }
    }

    // Function to disable/enable buttons while processing
    function setProcessingState(isProcessing) {
        findContentBtn.disabled = isProcessing;
        screenshotBtn.disabled = isProcessing;
        retryBtn.style.display = isProcessing ? 'none' : 'block';
        if (isProcessing) {
            resultDiv.style.display = 'none';
        }
    }

    findContentBtn.addEventListener('click', async function() {
        setProcessingState(true);
        displayStatus("Finding content...");

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            displayStatus("No active tab found.", true);
            setProcessingState(false);
            return;
        }

        // Send message to background.js to handle the entire AI process
        // background.js will get the content from content.js and make the AI call
        const aiResponse = await chrome.runtime.sendMessage({ action: "getAiAnswer", payload: { type: 'popup_trigger' } });
        
        displayResult(aiResponse);
        setProcessingState(false);
    });

    screenshotBtn.addEventListener('click', async function() {
        setProcessingState(true);
        displayStatus("Taking screenshot...");

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            displayStatus("No active tab found.", true);
            setProcessingState(false);
            return;
        }

        try {
            const screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
            screenshotImg.src = screenshotDataUrl;
            screenshotImg.style.display = 'block';

            displayStatus("Screenshot taken, analyzing with AI...");
            const aiResponse = await chrome.runtime.sendMessage({ action: "getAiAnswer", payload: { type: 'screenshot', data: screenshotDataUrl } });
            
            displayResult(aiResponse);

        } catch (error) {
            displayStatus(`Error taking or analyzing screenshot: ${error.message}`, true);
        } finally {
            setProcessingState(false);
        }
    });

    retryBtn.addEventListener('click', function() {
        // Clear previous results and allow re-running
        resultDiv.innerHTML = '';
        resultDiv.style.display = 'none';
        screenshotImg.src = '';
        screenshotImg.style.display = 'none';
        statusDiv.textContent = '';
        statusDiv.style.display = 'none';
        setProcessingState(false);
    });
});