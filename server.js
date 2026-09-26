const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
const cron = require('node-cron');
const crypto = require('crypto');

const { analyzeScene, askAssistant, analyzeValuable, compressMemories, generateDaySummary, summarizeVoiceMemory, extractKeywords } = require('./aiService');
const { Memory, WatchlistItem, User, ChatMessage, DaySummary, VoiceMemory } = require('./db');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const appUpload = multer({ dest: 'uploads/' });

let imageBatchQueue = [];
const BATCH_SIZE = 3;

const userLocations = new Map();
const activeAlerts = new Map();

// ==========================================
// ROUTE 1: Receive RAW Binary Image & Queue It
// ==========================================
app.post('/upload', express.raw({ type: 'image/jpeg', limit: '10mb' }), async (req, res) => {
  if (!req.body || req.body.length === 0) {
    console.log("Empty request received.");
    return res.status(400).send('No image data received.');
  }

  const glassesToken = req.headers['x-glasses-token'] || req.headers['authorization'] || null;

  const latInput = req.query.lat || req.headers['lat'] || req.headers['x-lat'];
  const lngInput = req.query.lng || req.headers['lng'] || req.headers['x-lng'];

  if (latInput && lngInput && latInput !== "null" && lngInput !== "null"
    && latInput !== "undefined") {
    const parsedLat = parseFloat(latInput);
    const parsedLng = parseFloat(lngInput);
    if (!isNaN(parsedLat) && !isNaN(parsedLng) && parsedLat !== 0.0) {
      if (glassesToken) {
        const existing = userLocations.get(glassesToken) || {};
        userLocations.set(glassesToken, {
          lat: parsedLat, lng: parsedLng,
          time: existing.time || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        });
      }
    }
  }

  const filename = `snapshot-${Date.now()}.jpg`;
  const filepath = path.join(uploadDir, filename);
  fs.writeFileSync(filepath, req.body);
  imageBatchQueue.push({ filepath, glassesToken });

  const captureTime = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  });
  console.log(`\n📸 Frame captured at ${captureTime} IST. Queue: ${imageBatchQueue.length}/${BATCH_SIZE}`);

  res.status(200).send('Frame saved');

  if (imageBatchQueue.length >= BATCH_SIZE) {
    console.log(`🚀 Batch full! Sending ${BATCH_SIZE} frames to AI...`);
    const batchToProcess = [...imageBatchQueue];
    imageBatchQueue = [];
    const batchToken = batchToProcess[0].glassesToken;
    const filepaths = batchToProcess.map(b => b.filepath);

    let userLat = null, userLng = null, userTime = null;
    if (batchToken && userLocations.has(batchToken)) {
      const loc = userLocations.get(batchToken);
      userLat = loc.lat; userLng = loc.lng; userTime = loc.time;
    }

    try {
      const watchlistQuery = batchToken
        ? { isTracking: true, glassesToken: batchToken }
        : { isTracking: true };
      const watchlistItems = await WatchlistItem.find(watchlistQuery);
      const cleanWatchlist = watchlistItems.map(w => ({
        item: w.itemName, description: w.description
      }));
      const analysis = await analyzeScene(filepaths, cleanWatchlist);

      if (analysis) {
        const formattedText = Array.isArray(analysis.text_found)
          ? analysis.text_found.join(' | ') : (analysis.text_found || "None");

        const formattedIdentifiers = Array.isArray(analysis.unique_identifiers)
          ? (analysis.unique_identifiers.length > 0
            ? analysis.unique_identifiers.join(', ')
            : "None")
          : (analysis.unique_identifiers || "None");

        const formattedPeople = String(analysis.people_count || "0");

        // ✅ FIX: The AI sometimes returns objects as an array of {type, details}
        //    objects instead of plain strings. The schema expects [String].
        //    Convert each element: if it's an object, stringify it to
        //    "type: details" format. If already a string, keep it as-is.
        //    If the whole field is a string (AI returned a JSON blob), wrap it.
        let formattedObjects = [];
        if (Array.isArray(analysis.objects)) {
          formattedObjects = analysis.objects.map(obj => {
            if (typeof obj === 'string') return obj;
            if (typeof obj === 'object' && obj !== null) {
              // Convert {type: 'Lanyard', details: 'Blue...'} → "Lanyard: Blue..."
              if (obj.type && obj.details) return `${obj.type}: ${obj.details}`;
              if (obj.type) return obj.type;
              // Fallback for any other object shape
              return JSON.stringify(obj);
            }
            return String(obj);
          });
        } else if (typeof analysis.objects === 'string') {
          // AI returned entire array as a string — wrap in array
          formattedObjects = [analysis.objects];
        }
        // If null/undefined, stays as empty array []

        const newMemory = new Memory({
          text_found: formattedText,
          objects: formattedObjects,
          summary: analysis.summary || "No clear summary available.",
          environment: analysis.environment || "Unknown",
          action: analysis.action || "Unknown",
          people_count: formattedPeople,
          unique_identifiers: formattedIdentifiers,
          latitude: userLat,
          longitude: userLng,
          capturedAt: userTime || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          glassesToken: batchToken
        });

        await newMemory.save();
        console.log(`✅ Memory saved [GPS: ${userLat || "Unknown"}, ${userLng || "Unknown"}] [Action: ${analysis.action || "Unknown"}]: "${analysis.summary}"`);

        if (analysis.alert && analysis.alert !== "null" && analysis.alert.toLowerCase() !== "null") {
          console.log(`\n🚨 DANGER DETECTED: ${analysis.alert}`);
          if (batchToken) {
            if (!activeAlerts.has(batchToken)) activeAlerts.set(batchToken, []);
            activeAlerts.get(batchToken).push(analysis.alert);
          }
        }
        for (const imagePath of filepaths) {
          try { if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch (e) { }
        }
      }
    } catch (error) {
      console.error("Batch processing error:", error);
      for (const imagePath of filepaths) {
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

    const glassesToken = req.body.glassesToken || req.headers['authorization'] || null;
    let lat = parseFloat(req.body.latitude);
    let lng = parseFloat(req.body.longitude);

    if ((!lat || lat === 0.0) && glassesToken && userLocations.has(glassesToken)) {
      const loc = userLocations.get(glassesToken);
      lat = loc.lat; lng = loc.lng;
    }

    const timestampString = req.body.timestamp
      || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const addedAtDate = new Date();

    if (glassesToken && lat && lat !== 0.0) {
      const existing = userLocations.get(glassesToken) || {};
      userLocations.set(glassesToken, { lat, lng, time: existing.time || timestampString });
    }

    console.log(`📍 Watchlist item location: [${lat}, ${lng}] at ${timestampString}`);
    const analysis = await analyzeValuable(req.file.path);

    if (analysis && analysis.itemName) {
      const formattedAnchors = Array.isArray(analysis.unique_anchors)
        ? (analysis.unique_anchors.length > 0
          ? analysis.unique_anchors.join(', ')
          : "None")
        : (analysis.unique_anchors || "None");

      const newItem = new WatchlistItem({
        itemName: analysis.itemName,
        description: analysis.description,
        unique_anchors: formattedAnchors,
        latitude: lat,
        longitude: lng,
        addedAt: addedAtDate,
        glassesToken: glassesToken
      });
      await newItem.save();
      console.log(`✅ Added to Watchlist: ${analysis.itemName} [Anchors: ${formattedAnchors}] at ${timestampString}`);
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
// ROUTE 3: Handle Chat Queries
// ==========================================
app.post('/api/ask', async (req, res) => {
  const { question, sessionId, sessionTitle } = req.body;
  if (!question) return res.status(400).json({ error: "No question provided" });

  const glassesToken = req.headers['authorization'] || req.body.token || null;
  console.log(`\n💬 User asks: "${question}"`);

  try {
    const memoryQuery = glassesToken ? { glassesToken } : {};
    
    const totalMemoriesCount = await Memory.countDocuments(memoryQuery);

    // 1. Fetch Top 15 Recent Memories (for immediate context)
    const recentMemories = await Memory.find(memoryQuery).sort({ timestamp: -1 }).limit(15);
    
    // 2. Extract Keywords & Fetch Historical Matches (RAG)
    const keywords = await extractKeywords(question);
    let matchedMemories = [];
    if (keywords && keywords.length > 0) {
      const searchString = keywords.join(" ");
      console.log(`🔍 RAG Search for: "${searchString}"`);
      const searchQuery = glassesToken 
        ? { glassesToken, $text: { $search: searchString } }
        : { $text: { $search: searchString } };
      matchedMemories = await Memory.find(searchQuery).sort({ score: { $meta: "textScore" } }).limit(30);
    }

    // 3. Combine and Deduplicate Context
    const combinedMemoriesMap = new Map();
    recentMemories.forEach(m => combinedMemoriesMap.set(m._id.toString(), m));
    matchedMemories.forEach(m => combinedMemoriesMap.set(m._id.toString(), m));
    const combinedMemories = Array.from(combinedMemoriesMap.values());
    combinedMemories.sort((a, b) => b.timestamp - a.timestamp);

    const watchlistQuery = glassesToken ? { isTracking: true, glassesToken } : { isTracking: true };
    const watchlistItems = await WatchlistItem.find(watchlistQuery);

    const cleanContext = combinedMemories.map(m => ({
      time: new Date(m.timestamp).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
      }),
      summary: m.summary,
      objects: m.objects,
      location: m.latitude ? `GPS: ${m.latitude}, ${m.longitude}` : "Location unknown"
    }));

    const cleanWatchlist = watchlistItems.map(w => ({
      item: w.itemName,
      description: w.description,
      unique_anchors: w.unique_anchors
    }));

    const answer = await askAssistant(question, cleanContext, cleanWatchlist, totalMemoriesCount);
    console.log(`🤖 AI Answers: ${answer}`);

    if (glassesToken && sessionId) {
      const title = sessionTitle || (question.length > 25 ? question.substring(0, 25) + '...' : question);
      try {
        await ChatMessage.insertMany([
          { sessionId, glassesToken, sessionTitle: title, isUser: true, text: question },
          { sessionId, glassesToken, sessionTitle: title, isUser: false, text: '🤖 ' + answer }
        ]);
        console.log(`💾 Chat saved to cloud [session: ${sessionId.substring(0, 8)}...]`);
      } catch (saveErr) {
        console.error("Chat save error (non-fatal):", saveErr.message);
      }
    }

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
  const glassesToken = req.query.token || req.headers['authorization'] || null;
  const latInput = req.query.lat;
  const lngInput = req.query.lng;
  const timeInput = req.query.time;

  if (glassesToken && latInput && lngInput && latInput !== "null" && lngInput !== "null" && latInput !== "0.0") {
    const parsedLat = parseFloat(latInput);
    const parsedLng = parseFloat(lngInput);
    if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
      userLocations.set(glassesToken, {
        lat: parsedLat, lng: parsedLng,
        time: timeInput ? decodeURIComponent(timeInput)
          : new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      });
    }
  }

  if (glassesToken && activeAlerts.has(glassesToken)) {
    const userAlerts = activeAlerts.get(glassesToken);
    if (userAlerts.length > 0) {
      activeAlerts.delete(glassesToken);
      return res.status(200).json({ hasAlerts: true, alerts: userAlerts });
    }
  }

  res.status(200).json({ hasAlerts: false, alerts: [] });
});

// ==========================================
// ROUTE 5: Register
// ==========================================
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password)
    return res.status(400).json({ error: "Username, email and password are required." });
  if (username.trim().length < 3)
    return res.status(400).json({ error: "Username must be at least 3 characters." });
  if (!email.includes('@'))
    return res.status(400).json({ error: "Invalid email address." });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters." });

  try {
    const existing = await User.findOne({
      $or: [{ username: username.trim() }, { email: email.trim().toLowerCase() }]
    });
    if (existing) {
      if (existing.username === username.trim())
        return res.status(409).json({ error: "Username already taken." });
      return res.status(409).json({ error: "Email already registered." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const glassesToken = crypto.randomBytes(16).toString('hex');
    const newUser = new User({
      username: username.trim(), email: email.trim().toLowerCase(),
      password: hashedPassword, glassesToken
    });
    await newUser.save();
    console.log(`✅ New user registered: ${username}`);
    res.status(200).json({ token: glassesToken, username: newUser.username });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error during registration." });
  }
});

// ==========================================
// ROUTE 6: Login
// ==========================================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password)
    return res.status(400).json({ error: "Username and password are required." });

  try {
    const user = await User.findOne({ username: username.trim() });
    if (!user)
      return res.status(404).json({ error: "No account found with that username. Please register first." });

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch)
      return res.status(401).json({ error: "Incorrect password. Please try again." });

    console.log(`✅ User logged in: ${username}`);
    res.status(200).json({ token: user.glassesToken, username: user.username });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error during login." });
  }
});

// ==========================================
// ROUTE 7: Get Glasses Token
// ==========================================
app.get('/api/token', async (req, res) => {
  const authToken = req.headers['authorization'] || req.query.token;
  if (!authToken) return res.status(400).json({ error: "No token provided." });

  try {
    const user = await User.findOne({ glassesToken: authToken });
    if (!user) return res.status(404).json({ error: "User not found." });
    res.status(200).json({ glassesToken: user.glassesToken, username: user.username });
  } catch (err) {
    console.error("Token fetch error:", err);
    res.status(500).json({ error: "Server error fetching token." });
  }
});

// ==========================================
// ROUTE 8: Download Chat History from Cloud
// ==========================================
app.get('/api/chats', async (req, res) => {
  const glassesToken = req.headers['authorization'] || req.query.token;
  if (!glassesToken) return res.status(400).json({ error: "No token provided." });

  try {
    const messages = await ChatMessage.find({ glassesToken })
      .sort({ timestamp: 1 })
      .lean();

    if (messages.length === 0) {
      return res.status(200).json({ sessions: [] });
    }

    const sessionMap = {};
    for (const msg of messages) {
      if (!sessionMap[msg.sessionId]) {
        sessionMap[msg.sessionId] = {
          id: msg.sessionId,
          title: msg.sessionTitle || 'New Chat',
          messages: []
        };
      }
      sessionMap[msg.sessionId].messages.push({
        text: msg.text,
        isUser: msg.isUser
      });
    }

    const sessions = Object.values(sessionMap);
    console.log(`📥 Sending ${sessions.length} chat sessions to device`);
    res.status(200).json({ sessions });

  } catch (err) {
    console.error("Chat fetch error:", err);
    res.status(500).json({ error: "Server error fetching chat history." });
  }
});

// ==========================================
// ROUTE 9: Voice Query from Glasses Mic
// ==========================================
app.post('/api/voice', (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    appUpload.single('audio')(req, res, next);
  } else {
    express.raw({ type: '*/*', limit: '5mb' })(req, res, next);
  }
}, async (req, res) => {
  const glassesToken = req.headers['x-glasses-token']
    || req.headers['authorization']
    || (req.body && req.body.glassesToken)
    || null;

  const preTranscribedText = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)
    ? req.body.text || null : null;

  let audioFilePath = null;
  if (req.file) {
    audioFilePath = req.file.path;
  } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    audioFilePath = path.join(uploadDir, `voice-${Date.now()}.wav`);
    fs.writeFileSync(audioFilePath, req.body);
  }

  if (!audioFilePath && !preTranscribedText) {
    return res.status(400).json({ error: "No audio file or text received." });
  }
  if (!glassesToken) {
    if (audioFilePath && fs.existsSync(audioFilePath)) fs.unlinkSync(audioFilePath);
    return res.status(400).json({ error: "No glasses token provided." });
  }

  try {
    const shortToken = glassesToken.substring(0, 8) + '...';
    console.log(`\n🎙️ Voice query received from glasses (token: ${shortToken})`);

    let transcription = preTranscribedText;
    if (!transcription && audioFilePath) {
      transcription = await transcribeAudio(audioFilePath);
    }

    if (!transcription) {
      if (audioFilePath && fs.existsSync(audioFilePath)) fs.unlinkSync(audioFilePath);
      return res.status(500).json({ error: "Failed to transcribe audio." });
    }

    console.log(`📝 Transcription: "${transcription}"`);

    const totalMemoriesCount = await Memory.countDocuments({ glassesToken });

    // 1. Fetch Top 15 Recent Memories
    const recentMemories = await Memory.find({ glassesToken }).sort({ timestamp: -1 }).limit(15);
    
    // 2. Extract Keywords & Fetch Historical Matches (RAG)
    const keywords = await extractKeywords(transcription);
    let matchedMemories = [];
    if (keywords && keywords.length > 0) {
      const searchString = keywords.join(" ");
      console.log(`🔍 Voice RAG Search for: "${searchString}"`);
      matchedMemories = await Memory.find({ 
        glassesToken, 
        $text: { $search: searchString } 
      }).sort({ score: { $meta: "textScore" } }).limit(30);
    }

    // 3. Combine and Deduplicate Context
    const combinedMemoriesMap = new Map();
    recentMemories.forEach(m => combinedMemoriesMap.set(m._id.toString(), m));
    matchedMemories.forEach(m => combinedMemoriesMap.set(m._id.toString(), m));
    const combinedMemories = Array.from(combinedMemoriesMap.values());
    combinedMemories.sort((a, b) => b.timestamp - a.timestamp);

    const watchlistItems = await WatchlistItem.find({ isTracking: true, glassesToken });

    const cleanContext = combinedMemories.map(m => ({
      time: new Date(m.timestamp).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
      }),
      summary: m.summary,
      objects: m.objects,
      location: m.latitude ? `GPS: ${m.latitude}, ${m.longitude}` : "Location unknown"
    }));

    const cleanWatchlist = watchlistItems.map(w => ({
      item: w.itemName,
      description: w.description,
      unique_anchors: w.unique_anchors
    }));

    const answer = await askAssistant(transcription, cleanContext, cleanWatchlist, totalMemoriesCount);
    console.log(`🤖 Voice answer: ${answer}`);

    if (audioFilePath && fs.existsSync(audioFilePath)) fs.unlinkSync(audioFilePath);
    res.status(200).json({ answer, transcription });

  } catch (err) {
    console.error("Voice route error:", err);
    if (audioFilePath && fs.existsSync(audioFilePath)) fs.unlinkSync(audioFilePath);
    res.status(500).json({ error: "Voice processing failed." });
  }
});

// ==========================================
// ROUTE 9b: Voice Memory Upload (Passive Context)
// ==========================================
app.post('/api/voice/memory', (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    multer({ dest: 'uploads/', limits: { fileSize: 200 * 1024 * 1024 } }).single('audio')(req, res, next);
  } else {
    express.raw({ type: '*/*', limit: '200mb' })(req, res, next);
  }
}, async (req, res) => {
  const glassesToken = req.headers['x-glasses-token']
    || req.headers['authorization']
    || (req.body && req.body.glassesToken)
    || null;

  let audioFilePath = null;
  if (req.file) {
    audioFilePath = req.file.path;
  } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    audioFilePath = path.join(uploadDir, `voice-memory-${Date.now()}.wav`);
    fs.writeFileSync(audioFilePath, req.body);
  }

  if (!audioFilePath) {
    return res.status(400).json({ error: "No audio file received." });
  }
  if (!glassesToken) {
    if (fs.existsSync(audioFilePath)) fs.unlinkSync(audioFilePath);
    return res.status(400).json({ error: "No glasses token provided." });
  }

  try {
    const shortToken = glassesToken.substring(0, 8) + '...';
    console.log(`\n🎙️ Passive Voice Memory received (token: ${shortToken})`);

    const transcription = await transcribeAudio(audioFilePath);

    if (!transcription) {
      if (fs.existsSync(audioFilePath)) fs.unlinkSync(audioFilePath);
      return res.status(500).json({ error: "Failed to transcribe voice memory." });
    }

    console.log(`📝 Voice Memory Transcription: "${transcription.substring(0, 50)}..."`);

    const summary = await summarizeVoiceMemory(transcription);

    if (summary) {
      const newVoiceMemory = new VoiceMemory({
        transcription: transcription,
        summary: summary,
        glassesToken: glassesToken,
        timestamp: new Date()
      });
      await newVoiceMemory.save();
      console.log(`✅ Voice Memory saved for user ${shortToken}.`);
    } else {
      console.log(`⚠️ Failed to generate AI summary for voice memory, saving transcription only.`);
      const newVoiceMemory = new VoiceMemory({
        transcription: transcription,
        summary: "Context extraction failed. Raw text available.",
        glassesToken: glassesToken,
        timestamp: new Date()
      });
      await newVoiceMemory.save();
    }

    if (fs.existsSync(audioFilePath)) fs.unlinkSync(audioFilePath);
    res.status(200).json({ success: true, transcription, summary });

  } catch (err) {
    console.error("Voice Memory route error:", err);
    if (audioFilePath && fs.existsSync(audioFilePath)) fs.unlinkSync(audioFilePath);
    res.status(500).json({ error: "Voice memory processing failed." });
  }
});

// -------------------------------------------------------
// WHISPER TRANSCRIPTION HELPER — Groq + Native Blob/FormData
// -------------------------------------------------------
async function transcribeAudio(audioPath) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    console.warn("⚠️  GROQ_API_KEY not set — audio transcription skipped.");
    return null;
  }

  try {
    const fileBuffer = fs.readFileSync(audioPath);
    const blob = new Blob([fileBuffer], { type: 'audio/wav' });
    const form = new FormData();
    form.append('file', blob, path.basename(audioPath));
    form.append('model', 'whisper-large-v3');
    form.append('language', 'en');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: form
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Groq API error:", data);
      return null;
    }

    console.log(`✅ Transcription successful: "${data.text}"`);
    return data.text || null;

  } catch (err) {
    console.error("Groq transcription error:", err);
    return null;
  }
}

// ==========================================
// CRON JOB: Semantic Compression at 2AM IST
// ==========================================
cron.schedule('30 20 * * *', async () => {
  console.log('\n🕑 [CRON] Starting nightly semantic compression at 2:00 AM IST...');

  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rawMemories = await Memory.find({
      isCompressed: false, timestamp: { $lt: yesterday }
    }).sort({ timestamp: 1 });

    if (rawMemories.length === 0) {
      console.log('[CRON] No uncompressed memories to process tonight.');
      return;
    }

    console.log(`[CRON] Found ${rawMemories.length} total memories across all users.`);

    const tokenGroups = {};
    for (const m of rawMemories) {
      const token = m.glassesToken || 'unknown';
      if (!tokenGroups[token]) tokenGroups[token] = [];
      tokenGroups[token].push(m);
    }

    for (const [token, mems] of Object.entries(tokenGroups)) {
      const shortId = token === 'unknown' ? 'unknown' : token.substring(0, 8) + '...';
      console.log(`[CRON] Processing user ${shortId} — ${mems.length} memories`);

      const cleanRaw = mems.map(m => ({
        time: m.capturedAt,
        summary: m.summary,
        objects: m.objects,
        environment: m.environment,
        action: m.action,
        unique_identifiers: m.unique_identifiers,
        location: m.latitude ? `GPS: ${m.latitude}, ${m.longitude}` : "Unknown"
      }));

      const compressed = await compressMemories(cleanRaw);

      if (compressed) {
        const compressedMemory = new Memory({
          summary: compressed,
          text_found: "Compressed summary",
          objects: [],
          isCompressed: true,
          glassesToken: token === 'unknown' ? null : token,
          capturedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        });
        await compressedMemory.save();
        const ids = mems.map(m => m._id);
        await Memory.deleteMany({ _id: { $in: ids } });
        console.log(`✅ [CRON] User ${shortId} → Deleted ${mems.length} raw memories, saved 1 compressed summary.`);
      } else {
        console.log(`[CRON] AI compression failed for user ${shortId} — skipping.`);
      }
    }

    console.log('[CRON] Nightly compression complete.');
  } catch (err) {
    console.error('[CRON] Compression error:', err);
  }
});

// ==========================================
// CRON JOB: Daily Summary at 11 PM IST
// ==========================================
cron.schedule('30 17 * * *', async () => {
  console.log('\n🕑 [CRON] Starting daily summary generation at 11:00 PM IST...');

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    const rawMemories = await Memory.find({
      timestamp: { $gte: today }
    }).sort({ timestamp: 1 });

    const rawVoice = await VoiceMemory.find({
      timestamp: { $gte: today }
    }).sort({ timestamp: 1 });

    if (rawMemories.length === 0 && rawVoice.length === 0) {
      console.log('[CRON] No memories to summarize today.');
      return;
    }

    console.log(`[CRON] Found ${rawMemories.length} visual memories and ${rawVoice.length} voice memories for today's summary.`);

    const tokenGroups = {};
    for (const m of rawMemories) {
      const token = m.glassesToken || 'unknown';
      if (!tokenGroups[token]) tokenGroups[token] = { visual: [], voice: [] };
      tokenGroups[token].visual.push(m);
    }
    for (const v of rawVoice) {
      const token = v.glassesToken || 'unknown';
      if (!tokenGroups[token]) tokenGroups[token] = { visual: [], voice: [] };
      tokenGroups[token].voice.push(v);
    }

    const dateString = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    for (const [token, mems] of Object.entries(tokenGroups)) {
      if (token === 'unknown') continue; // Don't summarize for unknown users

      const shortId = token.substring(0, 8) + '...';
      console.log(`[CRON] Generating summary for user ${shortId} — ${mems.visual.length} visual, ${mems.voice.length} voice`);

      const cleanRaw = mems.visual.map(m => ({
        time: m.capturedAt,
        summary: m.summary,
        objects: m.objects,
        environment: m.environment,
        action: m.action
      }));

      const cleanVoice = mems.voice.map(v => ({
        time: new Date(v.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }),
        summary: v.summary
      }));

      const summaryText = await generateDaySummary(cleanRaw, cleanVoice, dateString);

      if (summaryText) {
        const newSummary = new DaySummary({
          date: dateString,
          summary: summaryText,
          glassesToken: token,
          timestamp: new Date()
        });
        await newSummary.save();
        console.log(`✅ [CRON] User ${shortId} → Daily summary saved.`);

        // Push notification to the user's active alerts
        if (!activeAlerts.has(token)) activeAlerts.set(token, []);
        activeAlerts.get(token).push("Here is today's memory summary");

      } else {
        console.log(`[CRON] AI summary generation failed for user ${shortId}.`);
      }
    }

    console.log('[CRON] Daily summary generation complete.');
  } catch (err) {
    console.error('[CRON] Summary generation error:', err);
  }
});

// ==========================================
// ROUTE 10: Get Daily Summaries
// ==========================================
app.get('/api/summaries', async (req, res) => {
  const glassesToken = req.headers['authorization'] || req.query.token;
  if (!glassesToken) return res.status(400).json({ error: "No token provided." });

  try {
    const summaries = await DaySummary.find({ glassesToken })
      .sort({ timestamp: -1 })
      .lean();

    res.status(200).json({ summaries });
  } catch (err) {
    console.error("Fetch summaries error:", err);
    res.status(500).json({ error: "Server error fetching summaries." });
  }
});

// ==========================================
// ROUTE 11: Get Instant Partial Day Summary
// ==========================================
app.post('/api/summary/instant', async (req, res) => {
  const glassesToken = req.headers['authorization'] || req.body.token;
  if (!glassesToken) return res.status(400).json({ error: "No token provided." });

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    const rawMemories = await Memory.find({
      glassesToken: glassesToken,
      timestamp: { $gte: today }
    }).sort({ timestamp: 1 });

    const rawVoice = await VoiceMemory.find({
      glassesToken: glassesToken,
      timestamp: { $gte: today }
    }).sort({ timestamp: 1 });

    if (rawMemories.length === 0 && rawVoice.length === 0) {
      return res.status(200).json({ summary: "You don't have any memories recorded yet today." });
    }

    console.log(`[INSTANT SUMMARY] Found ${rawMemories.length} visual memories and ${rawVoice.length} voice memories for user.`);

    const nowIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
    const dateString = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const fullDateString = `${dateString} (Up to ${nowIST})`;

    const cleanRaw = rawMemories.map(m => ({
      time: m.capturedAt,
      summary: m.summary,
      objects: m.objects,
      environment: m.environment,
      action: m.action
    }));

    const cleanVoice = rawVoice.map(v => ({
      time: new Date(v.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }),
      summary: v.summary
    }));

    const summaryText = await generateDaySummary(cleanRaw, cleanVoice, fullDateString);

    if (summaryText) {
      const newSummary = new DaySummary({
        date: fullDateString,
        summary: summaryText,
        glassesToken: glassesToken,
        timestamp: new Date()
      });
      await newSummary.save();
      console.log(`✅ [INSTANT SUMMARY] Saved partial summary for user.`);
      return res.status(200).json({ summary: summaryText, date: fullDateString });
    } else {
      return res.status(500).json({ error: "Failed to generate instant summary." });
    }
  } catch (err) {
    console.error("Instant summary error:", err);
    res.status(500).json({ error: "Server error generating instant summary." });
  }
});

// ==========================================
// ROUTE 12: Lost Prompt Cooldown
// ==========================================
app.post('/api/lost/cooldown', async (req, res) => {
  const glassesToken = req.headers['authorization'] || req.body.token;
  if (!glassesToken) return res.status(400).json({ error: "No token provided." });

  try {
    const user = await User.findOne({ glassesToken });
    if (!user) return res.status(404).json({ error: "User not found." });

    // Set cooldown for 1 hour
    user.lostPromptCooldownUntil = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    console.log(`⏳ [COOLDOWN] User ${user.username} snoozed wandering alerts for 1 hour.`);
    res.status(200).json({ success: true, message: "Cooldown applied for 1 hour." });
  } catch (err) {
    console.error("Cooldown error:", err);
    res.status(500).json({ error: "Server error setting cooldown." });
  }
});

// ==========================================
// Helper: Calculate distance in meters between two GPS coordinates (Haversine)
// ==========================================
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// ==========================================
// CRON JOB: Wandering/Lost Detection (Every 5 mins)
// ==========================================
cron.schedule('*/5 * * * *', async () => {
  try {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

    // Get all memories from the last 30 minutes that have GPS coordinates
    const recentMemories = await Memory.find({
      timestamp: { $gte: thirtyMinsAgo },
      latitude: { $ne: null },
      longitude: { $ne: null },
      glassesToken: { $ne: null }
    }).sort({ timestamp: 1 });

    if (recentMemories.length === 0) return;

    // Group memories by user
    const tokenGroups = {};
    for (const m of recentMemories) {
      if (!tokenGroups[m.glassesToken]) tokenGroups[m.glassesToken] = [];
      tokenGroups[m.glassesToken].push(m);
    }

    for (const [token, mems] of Object.entries(tokenGroups)) {
      if (mems.length < 3) continue; // Need some data points to confirm wandering

      // Check the time span of these memories
      const firstTime = new Date(mems[0].timestamp).getTime();
      const lastTime = new Date(mems[mems.length - 1].timestamp).getTime();
      const durationMs = lastTime - firstTime;

      // If the user has been active for at least 15 minutes in this 30 min window
      if (durationMs >= 15 * 60 * 1000) {
        let maxDistance = 0;

        // Find max distance between any two points
        for (let i = 0; i < mems.length; i++) {
          for (let j = i + 1; j < mems.length; j++) {
            const dist = getDistanceInMeters(mems[i].latitude, mems[i].longitude, mems[j].latitude, mems[j].longitude);
            if (dist > maxDistance) maxDistance = dist;
          }
        }

        // If they stayed within a 50 meter radius over 15+ minutes
        if (maxDistance <= 50) {
          const user = await User.findOne({ glassesToken: token });
          if (user) {
            const now = new Date();
            // Check if they are in cooldown
            if (!user.lostPromptCooldownUntil || user.lostPromptCooldownUntil < now) {
              console.log(`⚠️ [WANDERING DETECTED] User ${token.substring(0, 8)}... has stayed within ${maxDistance.toFixed(2)}m for ${Math.round(durationMs / 60000)} mins.`);

              if (!activeAlerts.has(token)) activeAlerts.set(token, []);

              // Only push if it's not already there
              const alerts = activeAlerts.get(token);
              if (!alerts.includes("LOST_PROMPT")) {
                alerts.push("LOST_PROMPT");
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("[CRON] Wandering detection error:", err);
  }
});

// ==========================================
// START SERVER
// ==========================================
app.listen(port, '0.0.0.0', () => {
  console.log(`\n🚀 RecallCast Server running on port ${port}`);
  console.log(`📡 Listening on all network interfaces`);
  console.log(`🕐 Server time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
});