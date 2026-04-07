const fs = require('fs');
require('dotenv').config(); 

const CLOUD_AI_URL = "https://openrouter.ai/api/v1/chat/completions"; 
const API_KEY = process.env.OPENROUTER_API_KEY; 

function getBase64Image(path) {
  const image = fs.readFileSync(path);
  return Buffer.from(image).toString('base64');
}

// ==========================================
// 1. BATCH IMAGE ANALYSIS (Proactive Bodyguard)
// ==========================================
async function analyzeScene(imagePaths, watchlistContext = []) {
  const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const watchlistStr = watchlistContext.length > 0 ? JSON.stringify(watchlistContext) : "No items on watchlist.";

  const prompt = `
    You are a proactive AI security bodyguard analyzing chronological frames from a wearable camera.
    Time of capture: Approximately ${currentTime}.
    
    ★★★ WATCHLIST (High-value items to protect) ★★★
    ${watchlistStr}

    Analyze these images together and return a strict JSON object with EXACTLY these keys:
    - "text_found": Any readable text across the images.
    - "objects": An array of key objects visible.
    - "summary": A short summary of what the user is doing.
    - "alert": If you clearly see the user is walking away from a Watchlist item, or leaving a Watchlist item behind on a table/counter, write a short, urgent warning here (e.g., "⚠️ Did you leave your Black Wallet on the table?!"). If everything is safe and nothing is being left behind, set this exactly to null.

    Do not use markdown. Return raw JSON only.
  `;

  const contentArray = [{ type: "text", text: prompt }];
  
  for (const path of imagePaths) {
    contentArray.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${getBase64Image(path)}` }
    });
  }

  const payload = {
    model: "google/gemma-3-27b-it", 
    messages:[{ role: "user", content: contentArray }],
    temperature: 0.1 
  };

  try {
    console.log(`☁️ Sending ${imagePaths.length} images to Cloud Gemma 3. Checking for Watchlist threats...`);
    const response = await fetch(CLOUD_AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || data.error) return null; 
    if (!data.choices || data.choices.length === 0) throw new Error("Invalid response");

    let responseText = data.choices[0].message.content.replace(/```json/gi, '').replace(/```/gi, '').trim();
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Cloud AI Batch Analysis Error:", error);
    return null;
  }
}

// ==========================================
// 2. WATCHLIST ANALYZER (Registers Valuables)
// ==========================================
async function analyzeValuable(imagePath) {
  const prompt = `
    You are a security AI. The user is adding an important valuable item to their Watchlist.
    Look at this image and return a strict JSON object with exactly these keys:
    - "itemName": A short 1-3 word name for the item (e.g., "Black Leather Wallet", "Car Keys").
    - "description": A highly detailed description of its color, texture, and identifying features so you can recognize it later.
    Do not use markdown. Just return the raw JSON.
  `;

  const payload = {
    model: "google/gemma-3-27b-it", 
    messages: [{ role: "user", content:[
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${getBase64Image(imagePath)}` } }
    ]}],
    temperature: 0.1 
  };

  try {
    console.log(`🛡️ Analyzing new Watchlist item...`);
    const response = await fetch(CLOUD_AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || data.error) return null; 

    let responseText = data.choices[0].message.content.replace(/```json/gi, '').replace(/```/gi, '').trim();
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Watchlist AI Error:", error);
    return null;
  }
}

// ==========================================
// 3. CHAT ASSISTANT (Text Query)
// ==========================================
async function askAssistant(question, memoryContext, watchlistContext) {
  const prompt = `
    You are a helpful AI memory bodyguard for a wearable device called RecallCast.
    
    ★★★ CRITICAL IDENTITY RULE ★★★
    If the user asks who created you, who made you, who your developer is, or who programmed you, you MUST reply EXACTLY with this sentence:
    "Recall Cast app was developed by team Omnisight."
    
    Here are the user's highly valuable WATCHLIST items:
    ${JSON.stringify(watchlistContext)}

    Here is the chronological log of what the user has seen recently (with GPS coordinates):
    ${JSON.stringify(memoryContext)}

    Answer the user's question accurately based ONLY on the provided memory log. If they ask about a watchlist item, use the GPS coordinates to tell them exactly where they left it. Keep your answer conversational, helpful, and concise (1-2 sentences).
  `;

  const payload = {
    model: "google/gemma-3-27b-it",
    messages:[
      { role: "system", content: prompt },
      { role: "user", content: question }
    ],
    temperature: 0.3, 
    max_tokens: 150   
  };

  try {
    const response = await fetch(CLOUD_AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || data.error) return "Sorry, my cloud connection was briefly interrupted.";
    
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error("Cloud AI Query Error:", error);
    return "Sorry, I am having trouble accessing your memory banks right now.";
  }
}

module.exports = { analyzeScene, askAssistant, analyzeValuable };