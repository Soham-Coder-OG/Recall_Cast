const fs = require('fs');
require('dotenv').config(); //  1. Tell it to read the .env file

// 1. OpenRouter Cloud Endpoint
const CLOUD_AI_URL = "https://openrouter.ai/api/v1/chat/completions"; 

// 2. Pull the secret key safely from the vault!
const API_KEY = process.env.OPENROUTER_API_KEY; 

// Helper function to convert saved images into Base64 strings for the AI
function getBase64Image(path) {
  const image = fs.readFileSync(path);
  return Buffer.from(image).toString('base64');
}

// ==========================================
// 1. BATCH IMAGE ANALYSIS (Vision)
// ==========================================
async function analyzeScene(imagePaths) {
  // Grab the exact time the batch is processing
  const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const prompt = `
    You are an AI memory assistant analyzing a batch of chronological frames from a wearable camera.
    Time of capture: Approximately ${currentTime}.
    Analyze these images together and return a strict JSON object with exactly these keys:
    - "text_found": Any readable text across all images.
    - "objects": An array of key objects or people visible across the timeframe.
    - "summary": A one-sentence summary of what the user was doing.
    Do not use markdown formatting or code blocks. Just return the raw JSON.
  `;

  // Start building the content array with the text prompt
  const contentArray = [{ type: "text", text: prompt }];
  
  // Loop through the batch of images and attach them as Base64 data
  for (const path of imagePaths) {
    const base64Image = getBase64Image(path);
    contentArray.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${base64Image}` }
    });
  }

  const payload = {
    model: "google/gemma-3-27b-it", // The massive 27B open-weights model
    messages: [
      {
        role: "user",
        content: contentArray
      }
    ],
    temperature: 0.1 // Low temperature for strict JSON formatting
  };

  try {
    console.log(`☁️ Sending ${imagePaths.length} images to Cloud Gemma 3 (27B)...`);
    const response = await fetch(CLOUD_AI_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}` // Your VIP pass to OpenRouter
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    // Debugging: Catch API rejections from OpenRouter
    if (!response.ok || data.error) {
        console.error("\n❌ OpenRouter API Rejected the Payload:");
        console.error(JSON.stringify(data, null, 2));
        return null; 
    }

    if (!data.choices || data.choices.length === 0) {
        throw new Error("Invalid response from Cloud AI");
    }

    let responseText = data.choices[0].message.content;
    
    // Strip markdown formatting just in case the AI includes it
    responseText = responseText.replace(/```json/gi, '').replace(/```/gi, '').trim();
    
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Cloud AI Batch Analysis Error:", error);
    return null;
  }
}

// ==========================================
// 2. CHAT ASSISTANT (Text Query)
// ==========================================
async function askAssistant(question, memoryContext) {
  const prompt = `
    You are a helpful AI memory assistant for a wearable device called RecallCast.
    The user is asking a question about their past experiences based on a log of their visual memories.
    
    Here is the chronological log of what the user has seen recently:
    ${JSON.stringify(memoryContext)}

    Answer the user's question accurately based ONLY on the provided memory log. 
    Keep your answer conversational, helpful, and concise (1-2 sentences). 
    If the answer cannot be found in the memory logs, politely inform the user that you don't have a record of it.
  `;

  const payload = {
    model: "google/gemma-3-27b-it",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: question }
    ],
    temperature: 0.3, 
    max_tokens: 150   
  };

  try {
    const response = await fetch(CLOUD_AI_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}` // Don't forget the key here too!
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok || data.error) {
        console.error("\n❌ OpenRouter API Error in Query:", JSON.stringify(data, null, 2));
        return "Sorry, my cloud connection was briefly interrupted.";
    }

    return data.choices[0].message.content.trim();
    
  } catch (error) {
    console.error("Cloud AI Query Error:", error);
    return "Sorry, I am having trouble accessing your memory banks right now.";
  }
}

module.exports = { analyzeScene, askAssistant };