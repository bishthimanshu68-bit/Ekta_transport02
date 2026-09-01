(function() {
    // 1. Create Floating AI Robot Button
    const floatBtn = document.createElement('div');
    floatBtn.innerHTML = '<i class="fa-solid fa-robot"></i>';
    floatBtn.style.cssText = `
        position: fixed;
        bottom: 25px;
        right: 25px;
        width: 60px;
        height: 60px;
        background: linear-gradient(135deg, #d97706, #b45309);
        color: white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 26px;
        cursor: pointer;
        box-shadow: 0 10px 25px rgba(0,0,0,0.3);
        z-index: 9999;
        transition: transform 0.3s ease;
    `;
    floatBtn.onmouseover = () => floatBtn.style.transform = 'scale(1.1)';
    floatBtn.onmouseout = () => floatBtn.style.transform = 'scale(1)';
    document.body.appendChild(floatBtn);

    // 2. Create Chat Window Box (Initially Hidden)
    const chatWindow = document.createElement('div');
    chatWindow.innerHTML = `
        <div id="aiWidgetHeader" style="background: #0f172a; color: white; padding: 15px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; border-top-left-radius: 12px; border-top-right-radius: 12px;">
            <span style="display: flex; align-items: center;"><i class="fa-solid fa-robot" style="color: #fbbf24; margin-right: 8px;"></i> Ekta AI Assistant</span>
            <button id="closeAiWidget" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div id="aiWidgetMessages" style="flex: 1; padding: 15px; overflow-y: auto; font-size: 13px; background: #f8fafc; display: flex; flex-direction: column; gap: 10px;">
            <div style="background: #e2e8f0; padding: 10px 12px; border-radius: 8px; max-width: 80%; align-self: flex-start; color: #334155;">
                नमस्ते गुरुजी! मैं आपका ट्रांसपोर्ट AI असिस्टेंट हूँ। बोलिए, आज फ्लीट, ड्राइवर या लेजर में क्या मदद करूँ?
            </div>
        </div>
        <div style="padding: 12px; background: white; border-top: 1px solid #e2e8f0; display: flex; align-items: center; gap: 8px; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;">
            <label style="cursor: pointer; color: #64748b; font-size: 16px;"><i class="fa-solid fa-paperclip"></i><input type="file" id="aiFileAttach" style="display: none;"></label>
            <input type="text" id="aiWidgetInput" placeholder="यहाँ AI से पूछें..." style="flex: 1; border: 1px solid #cbd5e1; padding: 8px 12px; border-radius: 6px; outline: none; font-size: 13px;">
            <button id="aiMicBtn" style="background: none; border: none; color: #64748b; font-size: 16px; cursor: pointer;"><i class="fa-solid fa-microphone"></i></button>
            <button id="aiSendBtn" style="background: #d97706; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold;"><i class="fa-solid fa-paper-plane"></i></button>
        </div>
    `;
    chatWindow.style.cssText = `
        position: fixed;
        bottom: 95px;
        right: 25px;
        width: 360px;
        height: 480px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 15px 35px rgba(0,0,0,0.2);
        z-index: 9999;
        display: none;
        flex-direction: column;
        border: 1px solid #cbd5e1;
    `;
    document.body.appendChild(chatWindow);

    // 3. Toggle Chat Window Open/Close Logic
    floatBtn.onclick = () => {
        chatWindow.style.display = chatWindow.style.display === 'flex' ? 'none' : 'flex';
    };
    document.getElementById('closeAiWidget').onclick = () => {
        chatWindow.style.display = 'none';
    };

    // 4. Send Message Logic (Connects to your backend/proxy)
    const sendBtn = document.getElementById('aiSendBtn');
    const inputField = document.getElementById('aiWidgetInput');
    const msgContainer = document.getElementById('aiWidgetMessages');

    async function handleUserMessage() {
        const text = inputField.value.trim();
        if(!text) return;

        // Append User Message
        msgContainer.innerHTML += `<div style="background: #d97706; color: white; padding: 10px 12px; border-radius: 8px; max-width: 80%; align-self: flex-end;">${text}</div>`;
        inputField.value = '';
        msgContainer.scrollTop = msgContainer.scrollHeight;

        // API Call to AI Proxy
        try {
            const response = await fetch('/api/ai-proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: text })
            });
            const data = await response.json();
            const reply = data.reply || data.result || "जवाब मिल गया है।";
            
            msgContainer.innerHTML += `<div style="background: #e2e8f0; padding: 10px 12px; border-radius: 8px; max-width: 80%; align-self: flex-start; color: #334155;">${reply}</div>`;
            msgContainer.scrollTop = msgContainer.scrollHeight;
        } catch (err) {
            msgContainer.innerHTML += `<div style="background: #fee2e2; color: #991b1b; padding: 10px 12px; border-radius: 8px; max-width: 80%; align-self: flex-start;">कनेक्शन एरर आ रहा है, गुरुजी। कृपया दोबारा चेक करें।</div>`;
        }
    }

    sendBtn.onclick = handleUserMessage;
    inputField.onkeypress = (e) => { if(e.key === 'Enter') handleUserMessage(); };
})();