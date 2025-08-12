const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  website: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  industry: {
    type: String,
    trim: true
  },
  contactEmail: {
    type: String,
    trim: true,
    lowercase: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending'],
    default: 'active'
  },
  scrapingConfig: {
    maxPages: {
      type: Number,
      default: 50
    },
    allowedDomains: [{
      type: String,
      trim: true
    }],
    excludePatterns: [{
      type: String,
      trim: true
    }],
    customSelectors: {
      title: String,
      content: String,
      exclude: String
    }
  },
  lastScrapedAt: {
    type: Date
  },
  totalPagesScrapped: {
    type: Number,
    default: 0
  },
  embeddingModel: {
    type: String,
    default: 'all-MiniLM-L6-v2'
  },
  embedScript: {
    type: String,
    trim: true
  },
  scriptGeneratedAt: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
clientSchema.index({ name: 1 });
clientSchema.index({ website: 1 });
clientSchema.index({ status: 1 });
clientSchema.index({ createdBy: 1 });

// Virtual for client ID string
clientSchema.virtual('clientId').get(function() {
  return this._id.toString();
});

// Remove sensitive data from JSON output
clientSchema.methods.toJSON = function() {
  const clientObject = this.toObject();
  clientObject.clientId = this.clientId;
  return clientObject;
};

module.exports = mongoose.model('Client', clientSchema);