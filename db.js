const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('📈 MongoDB Connected'))
  .catch(err => console.log(err));

const memorySchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  text_found: String,
  objects: [String],
  summary: String,
  imagePath: String // Optional: keep the path if you want to view the raw image later
});

const Memory = mongoose.model('Memory', memorySchema);

module.exports = Memory;