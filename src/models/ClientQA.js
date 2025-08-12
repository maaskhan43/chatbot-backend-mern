// backend/src/models/ClientQA.js
const mongoose = require('mongoose');

const ClientQASchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true
  },
  fileName: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    required: true,
    enum: ['csv', 'pdf', 'txt', 'json', 'xlsx', 'markdown']
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  processedAt: {
    type: Date
  },
  totalPairs: {
    type: Number,
    default: 0
  },
  pairs: [{
    question: {
      type: String,
      required: true,
      index: 'text'
    },
    answer: {
      type: String,
      required: true,
      index: 'text'
    },
    category: {
      type: String,
      default: 'general'
    },
    confidence: {
      type: Number,
      default: 1.0,
      min: 0,
      max: 1
    },
    embedding: {
      type: [Number]
    }
  }],
  fullText: {
    type: String,
    index: 'text'
  },
  status: {
    type: String,
    enum: ['processing', 'completed', 'failed'],
    default: 'processing'
  },
  errorMessage: String
});

module.exports = mongoose.model('ClientQA', ClientQASchema);