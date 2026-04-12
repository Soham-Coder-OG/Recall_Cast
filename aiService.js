const fs = require('fs');
require('dotenv').config(); 

const CLOUD_AI_URL = "https://openrouter.ai/api/v1/chat/completions"; 
const API_KEY = process.env.OPENROUTER_API_KEY; 

function getBase64Image(path) {
  const image = fs.readFileSync(path);
  return Buffer.from(image).toString('base64');
}

// ==========================================
// 1. V2.0 BATCH IMAGE ANALYSIS (Deep Extraction)
// ==========================================
async function analyzeScene(imagePaths, watchlistContext =[]) {
  const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
  const watchlistStr = watchlistContext.length > 0 ? JSON.stringify(watchlistContext) : "No items on watchlist.";

  const prompt = `
    You are a proactive AI security bodyguard analyzing chronological frames from a wearable camera.
    CURRENT EXACT TIME OF CAPTURE: ${currentTime}.
    ★★★ WATCHLIST ★★★
    ${watchlistStr}

    Return a strict JSON object with EXACTLY these keys:
    - "text_found": Any readable text.
    - "objects": Array of key objects.
    - "environment": Is it an indoor office, outdoor street, bedroom, etc.?
    - "people_count": Approximate number of people in the frame.
    - "action": What is the user physically doing? (e.g., "Walking", "Typing on laptop").
    - "unique_identifiers": Look closely at items (especially phones/wallets/bags). Note any unique anchors like scratches, exact case colors, stickers, or logos.
    - "summary": A short summary of the scene.
    - "alert": If user is walking away from a Watchlist item, write a short, urgent warning. If safe, write exactly null.

    Do not use markdown. Return raw JSON only.
  `;

  const contentArray =[{ type: "text", text: prompt }];
  for (const path of imagePaths) contentArray.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${getBase64Image(path)}` } });

  try {
    console.log(`☁️ [V2.0] Analyzing Scene & Extracting Rich Data...`);
    const response = await fetch(CLOUD_AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: "google/gemma-3-27b-it", messages:[{ role: "user", content: contentArray }], temperature: 0.1 })
    });
    const data = await response.json();
    if (!response.ok || data.error) return null; 
    let responseText = data.choices[0].message.content.replace(/```json/gi, '').replace(/```/gi, '').trim();
    return JSON.parse(responseText);
  } catch (error) { 
    console.error("Batch Analysis Error:", error);
    return null; 
  }
}

// ==========================================
// 2. V2.0 WATCHLIST ANALYZER (Unique Anchors)
// ==========================================
async function analyzeValuable(imagePath) {
  const prompt = `
    Analyze this valuable item for a Watchlist. To prevent confusing it with other identical items (e.g., confusing the user's iPhone with someone else's iPhone), we need strict identification.
    Return a strict JSON object with exactly these keys:
    - "itemName": A short name (e.g., "Blue Case iPhone").
    - "description": General description.
    - "unique_anchors": A highly detailed list of unique identifiers (e.g., specific scratches, screen wallpaper, stickers, exact color shade, case texture).

    Do not use markdown. Raw JSON only.
  `;
  try {
    console.log(`🛡️ [V2.0] Scanning Watchlist Item for Unique Anchors...`);
    const response = await fetch(CLOUD_AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: "google/gemma-3-27b-it", messages:[{ role: "user", content:[ { type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${getBase64Image(imagePath)}` } }]}], temperature: 0.1 })
    });
    const data = await response.json();
    if (!response.ok || data.error) return null; 
    let responseText = data.choices[0].message.content.replace(/```json/gi, '').replace(/```/gi, '').trim();
    return JSON.parse(responseText);
  } catch (error) { 
    console.error("Watchlist Scan Error:", error);
    return null; 
  }
}

// ==========================================
// 3. V2.0 CHAT ASSISTANT (Guardrails & Maps Links)
// ==========================================
async function askAssistant(question, memoryContext, watchlistContext) {
  const prompt = `
    You are RecallCast, a highly specialized personal AI memory assistant.
    
    ★★★ V2.0 STRICT GUARDRAILS (CRITICAL) ★★★
    1. If the user asks general knowledge questions (e.g., "Who developed Meta?", "What is 2+2?", "History of Rome"), you MUST refuse and reply: "I am a personal memory assistant designed only to answer questions about your memory logs."
    2. GOOGLE MAPS INJECTION: If the user asks where an item is, and you see GPS coordinates in the memory log, you MUST append a clickable Google Maps link in your response exactly like this: "https://www.google.com/maps?q=LATITUDE,LONGITUDE" (replace LATITUDE and LONGITUDE with the exact numbers from the memory log).

    Here are the user's WATCHLIST items (Use 'anchors' to avoid confusing their items with other similar objects):
    ${JSON.stringify(watchlistContext)}

    Here is the recent memory log:
    ${JSON.stringify(memoryContext)}

    Answer the user's question accurately based ONLY on the memory log. Keep it conversational but concise.
  `;

  try {
    const response = await fetch(CLOUD_AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: "google/gemma-3-27b-it", messages:[{ role: "system", content: prompt }, { role: "user", content: question }], temperature: 0.2, max_tokens: 200 })
    });
    const data = await response.json();
    if (!response.ok || data.error) return "Sorry, my cloud connection was briefly interrupted.";
    return data.choices[0].message.content.trim();
  } catch (error) { 
    console.error("Chat Error:", error);
    return "Sorry, I am having trouble accessing your memory banks right now."; 
  }
}

// ==========================================
// 4. V2.0 CRON JOB SUMMARIZER (Semantic Compression)
// ==========================================
async function compressMemories(rawMemories) {
    const prompt = `
      You are a data optimization AI. I am giving you an array of raw memory logs from a user's day.
      Your job is to perform "Semantic Compression". 
      Combine repetitive tasks into a single summary sentence (e.g. "User was working at their office desk on a laptop from 10:00 AM to 1:00 PM.").
      Keep locations and important objects mentioned, but drastically reduce the word count.
      Return ONLY the compressed text paragraph. Do not return JSON.
      
      Raw Logs: ${JSON.stringify(rawMemories)}
    `;
    try {
        console.log(`🗜️ [V2.0] Semantically compressing ${rawMemories.length} logs...`);
        const response = await fetch(CLOUD_AI_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
          body: JSON.stringify({ model: "google/gemma-3-27b-it", messages:[{ role: "user", content: prompt }], temperature: 0.3 })
        });
        const data = await response.json();
        if (!response.ok || data.error) return null; 
        return data.choices[0].message.content.trim();
      } catch (error) { 
        console.error("Compression Error:", error);
        return null; 
      }
}

module.exports = { analyzeScene, askAssistant, analyzeValuable, compressMemories };