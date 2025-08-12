const express = require('express');
const chunksController = require('../../controllers/chunks.controller');
const authMiddleware = require('../../middleware/auth');

const router = express.Router();

// Middleware to check for internal service calls
const checkInternalService = (req, res, next) => {
  console.log('🔍 Checking internal service headers:', req.headers['x-internal-service']);
  const isInternalService = req.headers['x-internal-service'] === 'python-scraper';
  
  if (isInternalService) {
    console.log('🔧 Bypassing auth for internal service call');
    return next(); // Skip authentication for internal calls
  }
  
  console.log('🔐 Applying normal authentication for external call');
  // Apply normal authentication for external calls
  return authMiddleware.authenticateAdmin(req, res, next);
};

// Bulk save chunks (called by Python scraping service) - allows internal calls
router.post('/chunks/bulk-save', checkInternalService, chunksController.bulkSaveChunks);

// Apply admin authentication middleware to remaining routes
router.use(authMiddleware.authenticateAdmin);

// Get all chunks for a specific client (for semantic search)
router.get('/client/:clientId', chunksController.getClientChunks);

// Delete chunks for a client
router.delete('/:clientId/chunks', chunksController.deleteClientChunks);

// Search chunks by text
router.post('/:clientId/chunks/search', chunksController.searchChunks);

module.exports = router;
