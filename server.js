const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors'); 
const { analyzeScene, askAssistant } = require('./aiService'); 
const Memory = require('./db'); 

const app = express();
const port = 3000;

// ==========================================
// MIDDLEWARE & SETUP
// ==========================================
app.use(cors()); 
app.use(express.json());
app.use(express.static('public')); 

// Ensure the uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// ==========================================
// BATCHING QUEUE
// ==========================================
let imageBatchQueue = [];
const BATCH_SIZE = 3; // Set to 3 for testing (change back to 30 for hackathon!)

// ==========================================
// ROUTES
// ==========================================

// 1. Receive RAW Binary Image from ESP32 or Webcam & Queue It
app.post('/upload', express.raw({ type: 'image/jpeg', limit: '10mb' }), async (req, res) => {
  
  if (!req.body || req.body.length === 0) {
    console.log("Empty request received.");
    return res.status(400).send('No image data received.');
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
    imageBatchQueue = []; 

    try {
      const analysis = await analyzeScene(batchToProcess);

      if (analysis) {
        const formattedText = Array.isArray(analysis.text_found) 
          ? analysis.text_found.join(' | ') 
          : analysis.text_found;

        // Save memory WITHOUT imagePath since images will be deleted
        const newMemory = new Memory({
          text_found: formattedText,
          objects: analysis.objects,
          summary: analysis.summary
        });

        await newMemory.save();
        console.log(`✅ Memory saved: "${analysis.summary}"`);

        // ==========================================
        // SMART DELETION: Delete all images in the
        // batch after AI has finished processing
        // ==========================================
        console.log(`🗑️  Cleaning up ${batchToProcess.length} processed images...`);
        let deletedCount = 0;
        let failedCount = 0;

        for (const imagePath of batchToProcess) {
          try {
            if (fs.existsSync(imagePath)) {
              fs.unlinkSync(imagePath);
              deletedCount++;
            }
          } catch (deleteError) {
            console.error(`Failed to delete ${imagePath}:`, deleteError.message);
            failedCount++;
          }
        }

        console.log(`✅ Cleanup done: ${deletedCount} deleted, ${failedCount} failed.`);
      }
    } catch (error) {
      console.error("Batch processing error:", error);

      // If AI fails, still clean up the images to avoid filling up disk
      console.log(`🗑️  AI failed — cleaning up ${batchToProcess.length} images anyway...`);
      for (const imagePath of batchToProcess) {
        try {
          if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        } catch (deleteError) {
          console.error(`Failed to delete ${imagePath}:`, deleteError.message);
        }
      }
    }
  }
});

// 2. Fetch Timeline Data for React Dashboard
app.get('/memories', async (req, res) => {
  try {
    const memories = await Memory.find().sort({ timestamp: -1 }).limit(50);
    res.status(200).json(memories);
  } catch (error) {
    console.error("Database fetch error:", error);
    res.status(500).send("Error fetching memories");
  }
});

// 3. Handle Chat Queries from React Dashboard
app.post('/api/ask', async (req, res) => {
  const { question } = req.body;
  
  if (!question) return res.status(400).json({ error: "No question provided" });
  
  console.log(`\n💬 User asks: "${question}"`);

  try {
    const recentMemories = await Memory.find().sort({ timestamp: -1 }).limit(100);
    
    const cleanContext = recentMemories.map(m => ({
      time: new Date(m.timestamp).toLocaleString(),
      summary: m.summary,
      objects: m.objects
    }));

    const answer = await askAssistant(question, cleanContext);
    console.log(`🤖 AI Answers: ${answer}`);
    
    res.status(200).json({ answer: answer });
    
  } catch (error) {
    console.error("Query processing error:", error);
    res.status(500).json({ answer: "System error while searching memories." });
  }
});

// ==========================================
// START SERVER
// ==========================================
app.listen(port, '0.0.0.0', () => {
  console.log(`\n🚀 RecallCast Backend is live on port ${port}!`);
  console.log(`Listening for uploads on /upload...`);
});