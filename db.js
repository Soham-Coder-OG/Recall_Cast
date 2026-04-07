const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('📈 MongoDB Connected'))
  .catch(err => console.log(err));

// -------------------------------------------------------
// 1. THE MEMORY BLUEPRINT (Now with GPS!)
// -------------------------------------------------------
const memorySchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  text_found: String,
  objects: [String],
  summary: String,
  latitude: Number,   // 📍 NEW: Stores GPS Latitude
  longitude: Number,  // 📍 NEW: Stores GPS Longitude
  imagePath: String 
});

const Memory = mongoose.model('Memory', memorySchema);

// -------------------------------------------------------
// 2. THE WATCHLIST BLUEPRINT (For Phase 2 Alerts)
// -------------------------------------------------------
const watchlistSchema = new mongoose.Schema({
  addedAt: { type: Date, default: Date.now },
  itemName: String,       // e.g., "Black Leather Wallet"
  description: String,    // Detailed AI description to help it look for it later
  isTracking: { type: Boolean, default: true } // Toggle tracking on/off
});

const WatchlistItem = mongoose.model('WatchlistItem', watchlistSchema);

// Export both blueprints so server.js can use them!
module.exports = { Memory, WatchlistItem };