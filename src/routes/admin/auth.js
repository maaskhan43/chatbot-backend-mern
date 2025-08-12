const express = require('express');
const adminAuthController = require('../../controllers/adminAuth.controller');
const { authenticateAdmin } = require('../../middleware/auth');

const router = express.Router();

// @route   POST /admin/auth/login
// @desc    Admin login
// @access  Public
router.post('/login', adminAuthController.login);

// @route   GET /admin/auth/profile
// @desc    Get current admin profile
// @access  Private (Admin only)
router.get('/profile', authenticateAdmin, adminAuthController.getProfile);

// @route   POST /admin/auth/logout
// @desc    Admin logout
// @access  Private (Admin only)
router.post('/logout', authenticateAdmin, adminAuthController.logout);

module.exports = router;