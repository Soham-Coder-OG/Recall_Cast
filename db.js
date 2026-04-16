const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('📈 Connected to Database'))
  .catch(err => console.log(err));

// -------------------------------------------------------
// 1. THE MEMORY BLUEPRINT (V2.0 - Rich Extraction)
// -------------------------------------------------------
const memorySchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  text_found: String,
  objects: [String],
  summary: String,
  
  // 🚀 V2.0 NEW FIELDS: Rich Data Extraction
  environment: String,         // e.g., "Indoor Office", "Bedroom"
  action: String,              // e.g., "Typing", "Walking"
  people_count: String,        // e.g., "2 people", "None"
  unique_identifiers: String,  // e.g., "iPhone with blue case"
  
  latitude: Number,   
  longitude: Number,  
  capturedAt: String,

  // 🚀 V2.0 SCALABILITY: Semantic Compression Flag
  isCompressed: { type: Boolean, default: false } 
});

const Memory = mongoose.model('Memory', memorySchema);

// -------------------------------------------------------
// 2. THE WATCHLIST BLUEPRINT (V2.0 - Unique Anchors)
// -------------------------------------------------------
const watchlistSchema = new mongoose.Schema({
  addedAt: { type: Date, default: Date.now },
  itemName: String,       
  description: String,    
  unique_anchors: String, // 🚀 V2.0 NEW: Prevents the "Two iPhones" confusion
  latitude: Number,
  longitude: Number,
  isTracking: { type: Boolean, default: true } 
});

const WatchlistItem = mongoose.model('WatchlistItem', watchlistSchema);

module.exports = { Memory, WatchlistItem };