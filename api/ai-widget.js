// ai-widget.js - Ekta Transport Management System AI Assistant

(function () {
    // 1. स्टाइल और HTML को ऑटोमैटिक पेज परInject करना
    const style = document.createElement('style');
    style.innerHTML = `
        #ekta-ai-fab {
            position: fixed;
            bottom: 25px;
            right: 25px;
            background: #2563eb;
            color: white;
            border: none;
            border-radius: 500px;
            width: 60px;
            height: 60px;
            font-size: 24px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s;
        }
        #ekta-ai-fab:hover { transform: scale(1.05); }
        #ekta-ai-window {
            position: fixed;
            bottom: 95px;
            right: 25px;
            width: 380px;
            height: 520px;
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.2);
            z-index: 9999;
            display: none;
            flex-direction: column;
            overflow: hidden;
            font-family: system-ui, -apple-system, sans-serif;
        }
        #ekta-ai-header {
            background: #1e40af;
            color: white;
            padding: 14px 16px;
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #ekta-ai-close {
            background: none;
            border: none;
            color: white;
            font-size: 18px;
            cursor: pointer;
        }
        #ekta-ai-messages {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
            background: #f8fafc;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .ekta-msg {
            max-width: 80%;
            padding: 10px 14px;
            border-radius: 8px;
            font-size: 14px;
            line-height: 1.4;
        }
        .ekta-msg.user {
            background: #2563eb;
            color: white;
            align-self: flex-end;
        }
        .ekta-msg.ai {
            background: #e2e8f0;
            color: #1e293b;
            align-self: flex-start;
        }
        #ekta-ai-input-area {
            padding: 12px;
            background: #ffffff;
            border-top: 1px solid #e2e8f0;
            display: flex;
            gap: 8px;
            align-items: center;
        }
        #ekta-ai-input {
            flex: 1;
            padding: 8px 12px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            outline: none;
            font-size: 14px;
        }
        .ekta-ai-btn {
            background: #2563eb;
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
        }
        .ekta-ai-btn:hover { background: #1d4ed8; }
        #ekta-mic-btn.recording {
            background: #dc2626 !important;
            animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    // HTML स्ट्रक्चर बनाना
    const widgetHTML = `
        <button id="ekta-ai-fab" title="Ekta Transport AI Assistant">🤖</button>
        <div id="ekta-ai-window">
            <div id="ekta-ai-header">
                <span>Ekta Transport AI</span>
                <button id="ekta-ai-close">&times;</button>
            </div>
            <div id="ekta-ai-messages">
                <div class="ekta-msg ai">नमस्ते गुरुजी! एकता ट्रांसपोर्ट सिस्टम में मैं आपकी क्या मदद करूँ? ट्रक, ड्राइवर या लेजर के बारे में पूछिए।</div>
            </div>
            <div id="ekta-ai-input-area">
                <input type="file" id="ekta-file-input" style="display:none" accept="image/*,.pdf" />
                <button class="ekta-ai-btn" id="ekta-upload-btn" title="डॉक्यूमेंट या फोटो अपलोड करें">📎</button>
                <input type="text" id="ekta-ai-input" placeholder="यहाँ टाइप करें या माइक दबाएं..." />
                <button class="ekta-ai-btn" id="ekta-mic-btn" title="बोलकर पूछें">🎙️</button>
                <button class="ekta-ai-btn" id="ekta-send-btn">भेजें</button>
            </div>
        </div>
    `;
    const container = document.createElement('div');
    container.innerHTML = widgetHTML;
    document.body.appendChild(container);

    // 2. लॉजिक और इवेंट्स (Logic & Handlers)
    const fab = document.getElementById('ekta-ai-fab');
    const win = document.getElementById('ekta-ai-window');
    const closeBtn = document.getElementById('ekta-ai-close');
    const sendBtn = document.getElementById('ekta-send-btn');
    const inputField = document.getElementById('ekta-ai-input');
    const messagesArea = document.getElementById('ekta-ai-messages');
    const micBtn = document.getElementById('ekta-mic-btn');
    const uploadBtn = document.getElementById('ekta-upload-btn');
    const fileInput = document.getElementById('ekta-file-input');

    let currentFilePayload = null;

    fab.onclick = () => {
        win.style.display = win.style.display === 'flex' ? 'none' : 'flex';
    };
    closeBtn.onclick = () => {
        win.style.display = 'none';
    };

    // फाइल अपलोड हैंडलिंग
    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(uploadEvent) {
                currentFilePayload = uploadEvent.target.result; // Base64 डेटा
                appendMessage(`📁 फाइल अटैच हो गई: ${file.name}`, 'user');
            };
            reader.readAsDataURL(file);
        }
    };

    // मैसेज भेजने का फंक्शन
    async function handleSend() {
        const text = inputField.value.trim();
        if (!text && !currentFilePayload) return;

        let displayTxt = text;
        if (currentFilePayload) displayTxt += " [साथ में फाइल संलग्न है]";
        
        appendMessage(displayTxt, 'user');
        inputField.value = '';

        // लोडिंग मैसेज दिखाना
        const loadingId = appendMessage('AI सोच रहा है...', 'ai');

        try {
            // आपके Vercel प्रॉक्सी को कॉल करना
            const response = await fetch('/api/ai-proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    prompt: text,
                    fileData: currentFilePayload,
                    currentPage: window.location.pathname // यह बताएगा यूजर किस पेज पर है (যেমন /fleet.html)
                })
            });

            const data = await response.json();
            document.getElementById(loadingId).innerText = data.reply || data.error || "कोई जवाब नहीं मिला।";
        } catch (err) {
            document.getElementById(loadingId).innerText = "कनेक्शन एरर! कृपया सर्वर जांचें।";
        }

        currentFilePayload = null;
        fileInput.value = '';
    }

    sendBtn.onclick = handleSend;
    inputField.onkeypress = (e) => { if (e.key === 'Enter') handleSend(); };

    // 3. माइक (Speech Recognition) - लंबे समय तक खुला रहने वाला सेटअप
    let recognition;
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.lang = 'hi-IN'; // हिंदी सपोर्ट के लिए
        recognition.continuous = true; // माइक जल्दी बंद न हो, लगातार चले
        recognition.interimResults = true;

        recognition.onstart = () => {
            micBtn.classList.add('recording');
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            if (finalTranscript) {
                inputField.value += (inputField.value ? ' ' : '') + finalTranscript;
            }
        };

        recognition.onerror = () => {
            micBtn.classList.remove('recording');
        };

        recognition.onend = () => {
            micBtn.classList.remove('recording');
        };

        let isRecording = false;
        micBtn.onclick = () => {
            if (isRecording) {
                recognition.stop();
                isRecording = false;
            } else {
                try {
                    recognition.start();
                    isRecording = true;
                } catch(e) { console.log(e); }
            }
        };
    } else {
        micBtn.style.display = 'none'; // अगर ब्राउज़र सपोर्ट न करे तो माइक छिपा दें
    }

    function appendMessage(text, sender) {
        const msgDiv = document.createElement('div');
        const msgId = 'msg-' + Date.now();
        msgDiv.id = msgId;
        msgDiv.className = `ekta-msg ${sender}`;
        msgDiv.innerText = text;
        messagesArea.appendChild(msgDiv);
        messagesArea.scrollTop = messagesArea.scrollHeight;
        return msgId;
    }
})();