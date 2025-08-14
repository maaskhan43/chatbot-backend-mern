const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  query: {
    type: String,
    required: true,
    trim: true
  },
  refinedQuery: {
    type: String,
    trim: true
  },
  response: {
    type: String,
    required: true
  },
  confidence: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  score: {
    type: Number,
    default: 0
  },
  language: {
    type: String,
    default: 'en'
  },
  matchedQuestion: {
    type: String
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const chatHistorySchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: String, // For tracking individual users within a client
    default: 'anonymous'
  },
  messages: [chatMessageSchema],
  context: {
    recentTopics: [String], // Track recent conversation topics
    userPreferences: {
      language: { type: String, default: 'en' },
      responseStyle: { type: String, default: 'standard' }
    },
    frequentQueries: [String] // Track user's common questions
  },
  metadata: {
    totalQueries: { type: Number, default: 0 },
    avgConfidence: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now },
    userAgent: String,
    ipAddress: String
  }
}, {
  timestamps: true
});

// Indexes for better performance
chatHistorySchema.index({ clientId: 1, sessionId: 1 });
chatHistorySchema.index({ 'metadata.lastActive': -1 });
chatHistorySchema.index({ 'messages.timestamp': -1 });

// Methods for context analysis
chatHistorySchema.methods.getRecentContext = function(limit = 5) {
  return this.messages
    .slice(-limit)
    .map(msg => ({
      query: msg.query,
      response: msg.response,
      confidence: msg.confidence,
      timestamp: msg.timestamp
    }));
};

chatHistorySchema.methods.addMessage = function(messageData) {
  this.messages.push(messageData);
  this.metadata.totalQueries += 1;
  this.metadata.lastActive = new Date();
  
  // Update average confidence
  const confidenceScores = { high: 1, medium: 0.6, low: 0.3 };
  const totalScore = this.messages.reduce((sum, msg) => 
    sum + (confidenceScores[msg.confidence] || 0.6), 0);
  this.metadata.avgConfidence = totalScore / this.messages.length;
  
  // Update recent topics (extract keywords from queries)
  const keywords = this.extractKeywords(messageData.query);
  this.context.recentTopics = [...new Set([...keywords, ...this.context.recentTopics])].slice(0, 10);
  
  return this.save();
};

chatHistorySchema.methods.extractKeywords = function(text) {
  // Simple keyword extraction (can be enhanced with NLP)
  const stopWords = ['the', 'is', 'at', 'which', 'on', 'what', 'who', 'how', 'when', 'where', 'why'];
  return text.toLowerCase()
    .split(/\W+/)
    .filter(word => word.length > 2 && !stopWords.includes(word))
    .slice(0, 5);
};

module.exports = mongoose.model('ChatHistory', chatHistorySchema);
