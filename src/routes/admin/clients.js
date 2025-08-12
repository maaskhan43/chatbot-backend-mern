const express = require('express');
const clientController = require('../../controllers/client.controller');
const clientQAController = require('../../controllers/clientQA.controller');
const { authenticateAdmin } = require('../../middleware/auth');

const router = express.Router();

// All routes require admin authentication
router.use(authenticateAdmin);

// @route   GET /api/admin/clients
// @desc    Get all clients for the authenticated admin
// @access  Private (Admin only)
router.get('/', clientController.getAllClients);

// @route   GET /api/admin/clients/:id
// @desc    Get single client by ID
// @access  Private (Admin only)
router.get('/:id', clientController.getClient);

// @route   POST /api/admin/clients
// @desc    Create new client
// @access  Private (Admin only)
router.post('/', clientController.createClient);

// @route   PUT /api/admin/clients/:id
// @desc    Update client
// @access  Private (Admin only)
router.put('/:id', clientController.updateClient);

// @route   DELETE /api/admin/clients/:id
// @desc    Delete client
// @access  Private (Admin only)
router.delete('/:id', clientController.deleteClient);

// @route   POST /api/admin/clients/:id/scrape
// @desc    Start scraping job for client
// @access  Private (Admin only)
router.post('/:id/scrape', clientController.startScraping);

// @route   GET /api/admin/clients/:id/scraped-data
// @desc    Get scraped data for client
// @access  Private (Admin only)
router.get('/:id/scraped-data', clientController.getScrapedData);

// @route   GET /api/admin/clients/:id/export-csv
// @desc    Export scraped data as CSV for client
// @access  Private (Admin only)
router.get('/:id/export-csv', clientController.exportScrapedDataCSV);

// @route   GET /api/admin/scraping/status/:jobId
// @desc    Get scraping job status
// @access  Private (Admin only)
router.get('/scraping/status/:jobId', clientController.getScrapingStatus);

// @route   POST /api/admin/clients/:id/upload-qa
// @desc    Upload Q&A pairs file for client
// @access  Private (Admin only)
router.post('/:id/upload-qa', clientQAController.upload, clientQAController.uploadQAPairs);

// @route   GET /api/admin/clients/:id/qa-data
// @desc    Get Q&A data for client
// @access  Private (Admin only)
router.get('/:id/qa-data', clientQAController.getClientQA);

// @route   GET /api/admin/clients/:id/embed-script
// @desc    Get embed script for client website integration
// Get embed script for existing client
router.get('/:id/embed-script', clientController.getEmbedScript);

// Regenerate embed script for existing client
router.post('/:id/regenerate-script', clientController.regenerateEmbedScript);

module.exports = router;