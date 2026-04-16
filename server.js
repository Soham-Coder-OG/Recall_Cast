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
const BATCH_SIZE = 3;

let lastKnownLat = null;
let lastKnownLng = null;
let lastKnownTime = null; 
let activeAlerts =[];

// ==========================================
// ROUTE 1: Receive RAW Binary Image & Queue It
// ==========================================
app.post('/upload', express.raw({ type: 'image/jpeg', limit: '10mb' }), async (req, res) => {

  if (!req.body || req.body.length === 0) {
    console.log("Empty request received.");
    return res.status(400).send('No image data received.');
  }

  const latInput = req.query.lat || req.headers['lat'] || req.headers['x-lat'];
  const lngInput = req.query.lng || req.headers['lng'] || req.headers['x-lng'];

  if (latInput && lngInput && latInput !== "null" && lngInput !== "null"
      && latInput !== "undefined") {
    const parsedLat = parseFloat(latInput);
    const parsedLng = parseFloat(lngInput);
    if (!isNaN(parsedLat) && !isNaN(parsedLng) && parsedLat !== 0.0) {
      lastKnownLat = parsedLat;
      lastKnownLng = parsedLng;
    }
  }

  const filename = `snapshot-${Date.now()}.jpg`;
  const filepath = path.join(uploadDir, filename);
  fs.writeFileSync(filepath, req.body);

  imageBatchQueue.push(filepath);

  const captureTime = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true
  });
  console.log(`\n📸 Frame captured at ${captureTime} IST. Queue: ${imageBatchQueue.length}/${BATCH_SIZE}`);

  res.status(200).send('Frame saved');

  if (imageBatchQueue.length >= BATCH_SIZE) {
    console.log(`🚀 Batch full! Sending ${BATCH_SIZE} frames to AI...`);

    const batchToProcess =[...imageBatchQueue];
    imageBatchQueue =[];

    try {
      const watchlistItems = await WatchlistItem.find({ isTracking: true });
      const cleanWatchlist = watchlistItems.map(w => ({
        item: w.itemName,
        description: w.description
      }));

      const analysis = await analyzeScene(batchToProcess, cleanWatchlist);

      if (analysis) {
        const formattedText = Array.isArray(analysis.text_found)
            ? analysis.text_found.join(' | ')
            : (analysis.text_found || "None");

        const newMemory = new Memory({
          text_found: formattedText,
          objects: analysis.objects ||[],
          summary: analysis.summary || "No clear summary available.",
          latitude: lastKnownLat,
          longitude: lastKnownLng,
          capturedAt: lastKnownTime || new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata'
          })
        });

        await newMemory.save();
        console.log(`✅ Memory saved [GPS: ${lastKnownLat || "Unknown"}, ${lastKnownLng || "Unknown"}][Time: ${lastKnownTime || "Unknown"}]: "${analysis.summary}"`);

        if (analysis.alert && analysis.alert !== "null"
            && analysis.alert.toLowerCase() !== "null") {
          console.log(`\n🚨 DANGER DETECTED: ${analysis.alert}`);
          activeAlerts.push(analysis.alert);
        }

        console.log(`🗑️ Cleaning up ${batchToProcess.length} processed images...`);
        for (const imagePath of batchToProcess) {
          try {
            if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
          } catch (e) { }
        }
      }
    } catch (error) {
      console.error("Batch processing error:", error);
      console.log(`🗑️ AI failed — cleaning up images anyway...`);
      for (const imagePath of batchToProcess) {
        try {
          if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        } catch (e) { }
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

    const lat = parseFloat(req.body.latitude) || lastKnownLat;
    const lng = parseFloat(req.body.longitude) || lastKnownLng;
    const timestamp = req.body.timestamp || new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata'
    });

    if (lat && lng && lat !== 0.0) {
      lastKnownLat = lat;
      lastKnownLng = lng;
    }

    console.log(`📍 Watchlist item location:[${lat}, ${lng}] at ${timestamp}`);

    const analysis = await analyzeValuable(req.file.path);

    if (analysis && analysis.itemName) {
      const newItem = new WatchlistItem({
        itemName: analysis.itemName,
        description: analysis.description,
        latitude: lat,
        longitude: lng,
        addedAt: timestamp
      });
      await newItem.save();
      console.log(`✅ Added to Watchlist: ${analysis.itemName} at ${timestamp}`);

      fs.unlinkSync(req.file.path);
      res.status(200).json({ success: true, item: analysis.itemName });
    } else {
      fs.unlinkSync(req.file.path);
      res.status(500).json({ error: "AI failed to identify the valuable item." });
    }
  } catch (err) {
    console.error("Watchlist Error:", err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: "Server error saving watchlist item." });
  }
});

// ==========================================
// ROUTE 3: Handle Chat Queries (NO MORE HARDCODED BUGS!)
// ==========================================
app.post('/api/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: "No question provided" });

  console.log(`\n💬 User asks: "${question}"`);

  // 🚀 The dumb hardcoded Easter Egg is DELETED. 
  // The AI in aiService.js will now handle intent matching intelligently.

  try {
    const recentMemories = await Memory.find().sort({ timestamp: -1 }).limit(100);
    const watchlistItems = await WatchlistItem.find({ isTracking: true });

    const cleanContext = recentMemories.map(m => ({
      time: new Date(m.timestamp).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }),
      summary: m.summary,
      objects: m.objects,
      location: m.latitude
          ? `GPS: ${m.latitude}, ${m.longitude}`
          : "Location unknown"
    }));

    const cleanWatchlist = watchlistItems.map(w => ({
      item: w.itemName,
      description: w.description
    }));

    const answer = await askAssistant(question, cleanContext, cleanWatchlist);
    console.log(`🤖 AI Answers: ${answer}`);

    res.status(200).json({ answer });

  } catch (error) {
    console.error("Query processing error:", error);
    res.status(500).json({ answer: "System error while searching memories." });
  }
});

// ==========================================
// ROUTE 4: Alert Mailbox + Heartbeat Beacon
// ==========================================
app.get('/api/alerts', (req, res) => {

  const latInput = req.query.lat;
  const lngInput = req.query.lng;
  const timeInput = req.query.time;

  if (latInput && lngInput && latInput !== "null"
      && lngInput !== "null" && latInput !== "0.0") {
    const parsedLat = parseFloat(latInput);
    const parsedLng = parseFloat(lngInput);
    if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
      lastKnownLat = parsedLat;
      lastKnownLng = parsedLng;
    }
  }

  if (timeInput) {
    lastKnownTime = decodeURIComponent(timeInput);
  }

  if (activeAlerts.length > 0) {
    const alertsToSend = [...activeAlerts];
    activeAlerts =[]; 
    return res.status(200).json({ hasAlerts: true, alerts: alertsToSend });
  }

  res.status(200).json({ hasAlerts: false, alerts:[] });
});

// ==========================================
// START SERVER
// ==========================================
app.listen(port, '0.0.0.0', () => {
  console.log(`\n🚀 RecallCast Server running on port ${port}`);
  console.log(`📡 Listening on all network interfaces`);
  console.log(`🕐 Server time: ${new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata'
  })} IST`);
});