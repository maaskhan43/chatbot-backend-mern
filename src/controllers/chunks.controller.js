const ScrapedChunk = require('../models/ScrapedChunk');
const Client = require('../models/Client');

class ChunksController {
  // Bulk save chunks from Python scraping service
  async bulkSaveChunks(req, res) {
    try {
      const { chunks, jobId, internal_service } = req.body;
      
      // Log internal service call
      if (internal_service || req.headers['x-internal-service']) {
        console.log('🔧 Internal service call from Python scraper');
      }
      
      if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Chunks array is required and cannot be empty'
        });
      }

      if (!jobId) {
        return res.status(400).json({
          success: false,
          message: 'Job ID is required'
        });
      }

      console.log(`💾 Saving ${chunks.length} chunks to database for job ${jobId}`);

      // Validate client exists
      const clientId = chunks[0]?.clientId;
      if (!clientId) {
        return res.status(400).json({
          success: false,
          message: 'Client ID is required in chunks'
        });
      }

      const client = await Client.findById(clientId);
      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      // Delete existing chunks for this job (in case of re-scraping)
      await ScrapedChunk.deleteMany({ jobId });

      // Prepare chunks for insertion
      const chunksToInsert = chunks.map(chunk => ({
        chunkId: chunk.chunkId,
        clientId: chunk.clientId,
        sourceUrl: chunk.sourceUrl,
        pageTitle: chunk.pageTitle || '',
        metaDescription: chunk.metaDescription || '',
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunk.totalChunks,
        text: chunk.text,
        charCount: chunk.charCount,
        wordCount: chunk.wordCount,
        tokenCount: chunk.tokenCount, // CRITICAL: Missing field that caused validation failure!
        // NEW: Semantic metadata fields
        heading: chunk.heading || null,
        headingLevel: chunk.headingLevel || null,
        sectionType: chunk.sectionType || null,
        isHeader: chunk.isHeader || false,
        semanticMetadata: chunk.semanticMetadata || {},
        embedding: chunk.embedding,
        embeddingModel: chunk.embeddingModel || 'all-MiniLM-L6-v2',
        embeddingDimensions: chunk.embeddingDimensions || 384,
        scrapedAt: chunk.scrapedAt ? new Date(chunk.scrapedAt) : new Date(),
        jobId: chunk.jobId || jobId
      }));

      // Bulk insert chunks
      const savedChunks = await ScrapedChunk.insertMany(chunksToInsert);

      console.log(`✅ Successfully saved ${savedChunks.length} chunks to database`);

      // Update client's scraped pages count
      const uniquePages = new Set(chunks.map(chunk => chunk.sourceUrl)).size;
      client.totalPagesScrapped = (client.totalPagesScrapped || 0) + uniquePages;
      client.lastScrapedAt = new Date();
      await client.save();

      res.status(200).json({
        success: true,
        message: `Successfully saved ${savedChunks.length} chunks`,
        chunksCount: savedChunks.length,
        jobId: jobId,
        clientId: clientId
      });

    } catch (error) {
      console.error('Error bulk saving chunks:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save chunks to database',
        error: error.message
      });
    }
  }

  // Get chunks for a client
  async getClientChunks(req, res) {
    try {
      const { clientId } = req.params;
      const { page = 1, limit = 50, search } = req.query;

      // Validate client exists
      const client = await Client.findById(clientId);
      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      // Build query
      let query = { clientId };
      if (search) {
        query.$text = { $search: search };
      }

      // Execute query with pagination
      const skip = (page - 1) * limit;
      const chunks = await ScrapedChunk.find(query)
        .sort(search ? { score: { $meta: 'textScore' } } : { sourceUrl: 1, chunkIndex: 1 })
        .skip(skip)
        .limit(parseInt(limit));

      const totalChunks = await ScrapedChunk.countDocuments(query);
      const totalPages = Math.ceil(totalChunks / limit);

      // Get summary statistics
      const stats = await ScrapedChunk.aggregate([
        { $match: { clientId: client._id } },
        {
          $group: {
            _id: null,
            totalChunks: { $sum: 1 },
            totalCharacters: { $sum: '$charCount' },
            totalWords: { $sum: '$wordCount' },
            uniqueUrls: { $addToSet: '$sourceUrl' }
          }
        }
      ]);

      const summary = stats[0] || {
        totalChunks: 0,
        totalCharacters: 0,
        totalWords: 0,
        uniqueUrls: []
      };

      res.status(200).json({
        success: true,
        clientId: clientId,
        chunks: chunks,
        pagination: {
          currentPage: parseInt(page),
          totalPages: totalPages,
          totalChunks: totalChunks,
          limit: parseInt(limit)
        },
        summary: {
          totalChunks: summary.totalChunks,
          totalCharacters: summary.totalCharacters,
          totalWords: summary.totalWords,
          uniquePages: summary.uniqueUrls.length
        }
      });

    } catch (error) {
      console.error('Error getting client chunks:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve chunks',
        error: error.message
      });
    }
  }

  // Delete chunks for a client
  async deleteClientChunks(req, res) {
    try {
      const { clientId } = req.params;

      // Validate client exists
      const client = await Client.findById(clientId);
      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      const result = await ScrapedChunk.deleteMany({ clientId });

      res.status(200).json({
        success: true,
        message: `Deleted ${result.deletedCount} chunks for client`,
        deletedCount: result.deletedCount,
        clientId: clientId
      });

    } catch (error) {
      console.error('Error deleting client chunks:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete chunks',
        error: error.message
      });
    }
  }

  // Search chunks by text similarity (for future vector search)
  async searchChunks(req, res) {
    try {
      const { clientId } = req.params;
      const { query, limit = 10 } = req.body;

      if (!query) {
        return res.status(400).json({
          success: false,
          message: 'Search query is required'
        });
      }

      // For now, use text search. Later can be enhanced with vector similarity
      const chunks = await ScrapedChunk.searchByText(clientId, query, limit);

      res.status(200).json({
        success: true,
        query: query,
        results: chunks.length,
        chunks: chunks
      });

    } catch (error) {
      console.error('Error searching chunks:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search chunks',
        error: error.message
      });
    }
  }

  // Get all chunks for a specific client (for semantic search)
  async getClientChunks(req, res) {
    try {
      const { clientId } = req.params;
      
      console.log(`📊 Fetching chunks for client: ${clientId}`);
      
      const chunks = await Chunk.find({ clientId: clientId })
        .select('content title url embedding metadata')
        .sort({ createdAt: -1 });

      console.log(`✅ Found ${chunks.length} chunks for client ${clientId}`);

      res.status(200).json({
        success: true,
        chunks: chunks,
        total: chunks.length
      });

    } catch (error) {
      console.error('Get client chunks error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch client chunks'
      });
    }
  }
}

module.exports = new ChunksController();
