const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');

// @route   GET /api/chat/priority-questions/:clientId
// @desc    Get top priority questions for a client (for chatbot UI)
// @access  Public
router.get('/priority-questions/:clientId', chatController.getPriorityQuestions);

// @route   POST /api/chat/semantic-search
// @desc    Perform semantic search on Q&A data
// @access  Public
router.post('/semantic-search', chatController.semanticSearch);

module.exports = router;
