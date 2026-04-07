const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors'); 
const multer = require('multer'); 

const { analyzeScene, askAssistant, analyzeValuable } = require('./aiService'); 
const { Memory, WatchlistItem } = require('./db'); 

const app = express();
const port = 3000;

// ==========================================
// MIDDLEWARE & SETUP
// ==========================================
app.use(cors()); 
app.use(express.json());
app.use(express.static('public')); 

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const appUpload = multer({ dest: 'uploads/' });

// ==========================================
// STATE VARIABLES
// ==========================================
let imageBatchQueue =[];
const BATCH_SIZE = 3; // Set to 3 for testing (change to 30 for hackathon!)

let lastKnownLat = null;
let lastKnownLng = null;
let activeAlerts =[]; // 🚨 Mailbox for proactive Android warnings

// ==========================================
// ROUTE 1: Receive RAW Binary Image & Queue It
// ==========================================
app.post('/upload', express.raw({ type: 'image/jpeg', limit: '10mb' }), async (req, res) => {
  
  if (!req.body || req.body.length === 0) {
    console.log("Empty request received.");
    return res.status(400).send('No image data received.');
  }

  // 📍 Catch GPS from the URL! (e.g. /upload?lat=19.07&lng=72.87)
  if (req.query.lat && req.query.lng) {
      lastKnownLat = parseFloat(req.query.lat);
      lastKnownLng = parseFloat(req.query.lng);
  }
  
  const filename = `snapshot-${Date.now()}.jpg`;
  const filepath = path.join(uploadDir, filename);
  fs.writeFileSync(filepath, req.body);
  
  imageBatchQueue.push(filepath);
  
  const captureTime = new Date().toLocaleTimeString();
  console.log(`\n📸 Frame captured at ${captureTime}. Queue: ${imageBatchQueue.length}/${BATCH_SIZE}`);

  res.status(200).send('Frame saved'); 

  if (imageBatchQueue.length >= BATCH_SIZE) {
    console.log(`🚀 Batch full! Sending ${BATCH_SIZE} frames to AI...`);
    
    const batchToProcess = [...imageBatchQueue];
    imageBatchQueue =[]; 

    try {
      // 1. Fetch the user's Watchlist
      const watchlistItems = await WatchlistItem.find({ isTracking: true });
      const cleanWatchlist = watchlistItems.map(w => ({ item: w.itemName, description: w.description }));

      // 2. Send photos + watchlist to AI
      const analysis = await analyzeScene(batchToProcess, cleanWatchlist);

      if (analysis) {
        const formattedText = Array.isArray(analysis.text_found) ? analysis.text_found.join(' | ') : analysis.text_found;

        const newMemory = new Memory({
          text_found: formattedText,
          objects: analysis.objects,
          summary: analysis.summary,
          latitude: lastKnownLat, 
          longitude: lastKnownLng 
        });

        await newMemory.save();
        console.log(`✅ Memory saved[GPS: ${lastKnownLat}, ${lastKnownLng}]: "${analysis.summary}"`);

        // 🚨 3. CHECK FOR PROACTIVE ALERTS!
        if (analysis.alert && analysis.alert !== "null" && analysis.alert.toLowerCase() !== "null") {
            console.log(`\n🚨 DANGER DETECTED: ${analysis.alert}`);
            activeAlerts.push(analysis.alert); 
        }

        // ==========================================
        // SMART DELETION (Success)
        // ==========================================
        console.log(`🗑️ Cleaning up ${batchToProcess.length} processed images...`);
        for (const imagePath of batchToProcess) {
          try { if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch (e) { }
        }
      }
    } catch (error) {
      console.error("Batch processing error:", error);
      // ==========================================
      // SMART DELETION (Failure Fallback)
      // ==========================================
      console.log(`🗑️ AI failed — cleaning up images anyway...`);
      for (const imagePath of batchToProcess) {
        try { if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch (e) { }
      }
    }
  }
});

// ==========================================
// ROUTE 2: Watchlist Upload (From Android App)
// ==========================================
app.post('/api/watchlist', appUpload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No image provided" });
        
        console.log("\n🛡️ Received Watchlist photo from Android app!");
        
        const analysis = await analyzeValuable(req.file.path);
        
        if (analysis && analysis.itemName) {
            const newItem = new WatchlistItem({
                itemName: analysis.itemName,
                description: analysis.description
            });
            await newItem.save();
            console.log(`✅ Added to Watchlist: ${analysis.itemName}`);
            
            fs.unlinkSync(req.file.path); // Smart Delete!
            res.status(200).json({ success: true, item: analysis.itemName });
        } else {
            fs.unlinkSync(req.file.path); // Smart Delete!
            res.status(500).json({ error: "AI failed to identify the valuable item." });
        }
    } catch (err) {
        console.error("Watchlist Error:", err);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: "Server error saving watchlist item." });
    }
});

// ==========================================
// ROUTE 3: Handle Chat Queries
// ==========================================
app.post('/api/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: "No question provided" });
  
  console.log(`\n💬 User asks: "${question}"`);

  // 🥚 EASTER EGG (Hardcoded Interceptor)
  const lowerQ = question.toLowerCase();
  if (lowerQ.includes("who created") || lowerQ.includes("who made") || lowerQ.includes("developer")) {
      console.log(`🤖 Easter Egg Triggered!`);
      return res.status(200).json({ answer: "Recall Cast app was developed by team Omnisight." });
  }

  try {
    const recentMemories = await Memory.find().sort({ timestamp: -1 }).limit(100);
    const watchlistItems = await WatchlistItem.find({ isTracking: true });
    
    const cleanContext = recentMemories.map(m => ({
      time: new Date(m.timestamp).toLocaleString(),
      summary: m.summary,
      objects: m.objects,
      location: m.latitude ? `GPS: ${m.latitude}, ${m.longitude}` : "Location unknown"
    }));

    const cleanWatchlist = watchlistItems.map(w => ({
        item: w.itemName,
        description: w.description
    }));

    const answer = await askAssistant(question, cleanContext, cleanWatchlist);
    console.log(`🤖 AI Answers: ${answer}`);
    
    res.status(200).json({ answer: answer });
    
  } catch (error) {
    console.error("Query processing error:", error);
    res.status(500).json({ answer: "System error while searching memories." });
  }
});

// ==========================================
// ROUTE 4: The Alert Mailbox (For Android Polling)
// ==========================================
app.get('/api/alerts', (req, res) => {
    if (activeAlerts.length > 0) {
        // Grab the alerts, then instantly clear the mailbox 
        const alertsToSend = [...activeAlerts];
        activeAlerts =[]; 
        return res.status(200).json({ hasAlerts: true, alerts: alertsToSend });
    }
    // No danger detected
    res.status(200).json({ hasAlerts: false, alerts:[] });
});

// ==========================================
// START SERVER
// ==========================================
app.listen(port, '0.0.0.0', () => {
  console.log(`\n🚀 RecallCast Backend is live on port ${port}!`);
  console.log(`Listening for uploads...`);
});