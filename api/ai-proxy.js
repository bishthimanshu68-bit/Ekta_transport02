export default async function handler(req, res) {
  // CORS Headers सेट करें
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { messages, prompt, fileData, currentPage } = req.body;
    if (!prompt && !fileData) {
      return res.status(400).json({ error: 'Prompt or file data is required in request body.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in Vercel Environment Variables.' });
    }

    // जेमिनी मॉडल का सही एंडपॉइंट
    // सही मॉडल एंडपॉइंट जहाँ -flash साफ-साफ जुड़ा हो
    // मॉडल का नाम बदलकर gemini-2.5-flash कर दें
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    // एकता ट्रांसपोर्ट के लिए सख्त सिस्टम निर्देश (System Instruction) ताकि वह ट्रांसपोर्ट के बाहर न जाए
    const systemInstruction = {
      role: "model",
      parts: [{
        text: "You are the AI Assistant for 'Ekta Transport Management System'. You help manage trucks, drivers, LR (Lorry Receipts), party ledgers, and document/permit OCR parsing (such as expiry dates, vehicle numbers like HR38AJ0579). Always respond in a helpful, professional tone matching the context of an Indian transport company. Never give generic out-of-context answers."
      }]
    };

    // चैट हिस्ट्री को जेमिनी के फॉर्मेट में ढालना
    let contents = [];
    if (messages && Array.isArray(messages)) {
      contents = messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));
    } else {
      contents = [{ role: 'user', parts: [{ text: prompt || "Analyze this document" }] }];
    }

    // अगर यूजर ने कोई फाइल/फोटो (Base64) भेजी है, तो उसे जेमिनी के पार्ट्स में जोड़ें
    if (fileData) {
      // Base64 स्ट्रिंग से डेटा औरmimeType अलग करना (data:image/jpeg;base64,/9j/...)
      const matches = fileData.match(/^data:(.+?);base64,(.+)$/);
      if (matches) {
        const mimeType = matches[1];
        const base64Data = matches[2];
        
        contents.push({
          role: 'user',
          parts: [
            { text: prompt || "इस डॉक्यूमेंट को पढ़कर सही ट्रक नंबर और एक्सपायरी डेट निकालो और सही रिकॉर्ड पर मैप करो।" },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data
              }
            }
          ]
        });
      }
    }

    const apiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: systemInstruction,
        contents: contents
      })
    });

    const data = await apiResponse.json();

    if (!apiResponse.ok) {
      return res.status(apiResponse.status).json(data);
    }

    // जेमिनी के रिस्पॉन्स से सही टेक्स्ट निकालकर भेजना
    const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "कोई जवाब नहीं मिला।";

    return res.status(200).json({ reply: aiReply });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}