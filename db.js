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
  environment: String,
  action: String,
  people_count: String,
  unique_identifiers: String,
  latitude: Number,
  longitude: Number,
  capturedAt: String,
  isCompressed: { type: Boolean, default: false },
  glassesToken: { type: String, index: true }
});

const Memory = mongoose.model('Memory', memorySchema);

// -------------------------------------------------------
// 2. THE WATCHLIST BLUEPRINT (V2.0 - Unique Anchors)
// -------------------------------------------------------
const watchlistSchema = new mongoose.Schema({
  addedAt: { type: Date, default: Date.now },
  itemName: String,
  description: String,
  unique_anchors: String,
  latitude: Number,
  longitude: Number,
  isTracking: { type: Boolean, default: true },
  glassesToken: { type: String, index: true }
});

const WatchlistItem = mongoose.model('WatchlistItem', watchlistSchema);

// -------------------------------------------------------
// 3. USER BLUEPRINT (Login System + Glasses Token)
// -------------------------------------------------------
const userSchema = new mongoose.Schema({
  createdAt:    { type: Date, default: Date.now },
  username:     { type: String, required: true, unique: true, trim: true },
  email:        { type: String, required: true, unique: true, trim: true, lowercase: true },
  password:     { type: String, required: true },
  glassesToken: { type: String, unique: true, sparse: true }
});

const User = mongoose.model('User', userSchema);

// -------------------------------------------------------
// 4. CHAT HISTORY BLUEPRINT (Cloud-Synced Messages)
// -------------------------------------------------------
const chatMessageSchema = new mongoose.Schema({
  // Which session this message belongs to
  sessionId:    { type: String, required: true, index: true },
  // Which user owns this session
  glassesToken: { type: String, required: true, index: true },
  // Session title (the first question, truncated)
  sessionTitle: { type: String, default: 'New Chat' },
  // true = sent by user, false = sent by AI
  isUser:       { type: Boolean, required: true },
  // The message text
  text:         { type: String, required: true },
  // When it was created
  timestamp:    { type: Date, default: Date.now }
});

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

module.exports = { Memory, WatchlistItem, User, ChatMessage };