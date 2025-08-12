const mongoose = require('mongoose');

const scrapedChunkSchema = new mongoose.Schema({
  chunkId: {
    type: String,
    required: true,
    unique: true
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true
  },
  sourceUrl: {
    type: String,
    required: true,
    index: true
  },
  pageTitle: {
    type: String,
    default: ''
  },
  metaDescription: {
    type: String,
    default: ''
  },
  chunkIndex: {
    type: Number,
    required: true
  },
  totalChunks: {
    type: Number,
    required: true
  },
  text: {
    type: String,
    required: true,
    index: 'text' // Text search index
  },
  charCount: {
    type: Number,
    required: true
  },
  wordCount: {
    type: Number,
    required: true
  },
  tokenCount: {
    type: Number,
    required: true,
    index: true // For filtering by token size
  },
  // NEW: Semantic chunking metadata
  heading: {
    type: String,
    default: null,
    index: true // For heading-based search
  },
  headingLevel: {
    type: Number,
    default: null,
    min: 1,
    max: 6
  },
  sectionType: {
    type: String,
    default: null,
    enum: ['header', 'paragraph', 'list', 'table', 'navigation', 'contact', 'company_info', 'content', null]
  },
  isHeader: {
    type: Boolean,
    default: false,
    index: true
  },
  semanticMetadata: {
    hasHeading: { type: Boolean, default: false },
    headingLevel: { type: Number, default: null },
    estimatedReadingTime: { type: Number, default: 0 }, // in minutes
    contentType: { 
      type: String, 
      default: 'content',
      enum: ['list', 'contact', 'navigation', 'company_info', 'content']
    }
  },
  embedding: {
    type: [Number], // Array of floats for vector embedding
    required: true,
    validate: {
      validator: function(arr) {
        return arr && arr.length > 0; // Ensure non-empty embedding
      },
      message: 'Embedding must be a non-empty array'
    }
  },
  embeddingModel: {
    type: String,
    default: 'text-embedding-004', // Updated for Gemini
    enum: ['text-embedding-004', 'all-MiniLM-L6-v2'] // Support both Gemini and fallback
  },
  embeddingDimensions: {
    type: Number,
    required: true,
    default: 768 // Gemini embedding dimensions
  },
  scrapedAt: {
    type: Date,
    required: true
  },
  jobId: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
scrapedChunkSchema.index({ clientId: 1, sourceUrl: 1 });
scrapedChunkSchema.index({ clientId: 1, chunkIndex: 1 });
scrapedChunkSchema.index({ jobId: 1 });

// NEW: Semantic search indexes
scrapedChunkSchema.index({ clientId: 1, heading: 1 });
scrapedChunkSchema.index({ clientId: 1, isHeader: 1 });
scrapedChunkSchema.index({ clientId: 1, 'semanticMetadata.contentType': 1 });
scrapedChunkSchema.index({ clientId: 1, tokenCount: 1 });
scrapedChunkSchema.index({ embeddingModel: 1 });

// Static methods for common queries
scrapedChunkSchema.statics.findByClient = function(clientId) {
  return this.find({ clientId }).sort({ sourceUrl: 1, chunkIndex: 1 });
};

scrapedChunkSchema.statics.findByJob = function(jobId) {
  return this.find({ jobId }).sort({ sourceUrl: 1, chunkIndex: 1 });
};

scrapedChunkSchema.statics.searchByText = function(clientId, searchText, limit = 10) {
  return this.find({
    clientId,
    $text: { $search: searchText }
  })
  .sort({ score: { $meta: 'textScore' } })
  .limit(limit);
};

// Method to calculate similarity (for future vector search)
scrapedChunkSchema.methods.calculateSimilarity = function(queryEmbedding) {
  // Cosine similarity calculation
  const dotProduct = this.embedding.reduce((sum, val, i) => sum + val * queryEmbedding[i], 0);
  const magnitudeA = Math.sqrt(this.embedding.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(queryEmbedding.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
};

module.exports = mongoose.model('ScrapedChunk', scrapedChunkSchema);
