const Client = require('../models/Client');
const httpx = require('axios');
const scrapeService = require('../services/scrape.service');
const { v4: uuidv4 } = require('uuid');

// In-memory job storage (simplified for now)
const activeJobs = {};

// Generate embed script for website integration
function generateEmbedScript(clientId) {
  const chatbotUrl = process.env.BACKEND_URL || 'http://localhost:5173';
  
  return `<!-- Gemini Chatbot Widget -->
<script>
  (function() {
    // Chatbot configuration
    window.GeminiChatbotConfig = {
      clientId: '${clientId}',
      apiUrl: '${process.env.BACKEND_URL || 'http://localhost:8080'}',
      theme: {
        primaryColor: '#007bff',
        position: 'bottom-right',
        size: 'medium'
      }
    };

    // Load chatbot widget
    var script = document.createElement('script');
    script.src = '${chatbotUrl}/chatbot-widget.js';
    script.async = true;
    script.onload = function() {
      if (window.GeminiChatbot) {
        window.GeminiChatbot.init(window.GeminiChatbotConfig);
      }
    };
    document.head.appendChild(script);

    // Load chatbot styles
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '${chatbotUrl}/chatbot-widget.css';
    document.head.appendChild(link);
  })();
</script>
<!-- End Gemini Chatbot Widget -->`;
}

class ClientController {
  // Get all clients
  async getAllClients(req, res) {
    try {
      const clients = await Client.find({ createdBy: req.admin.id })
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        clients: clients,
        total: clients.length
      });

    } catch (error) {
      console.error('Get clients error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch clients'
      });
    }
  }

  // Get single client
  async getClient(req, res) {
    try {
      const { id } = req.params;
      
      const client = await Client.findOne({ 
        _id: id, 
        createdBy: req.admin.id 
      }).populate('createdBy', 'name email');

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      res.status(200).json({
        success: true,
        client: client
      });

    } catch (error) {
      console.error('Get client error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch client'
      });
    }
  }

  // Create new client
  async createClient(req, res) {
    try {
      const { name, website, description, industry, contactEmail, scrapingConfig } = req.body;

      // Validate required fields
      if (!name || !website) {
        return res.status(400).json({
          success: false,
          message: 'Name and website are required'
        });
      }

      // Check if client with same name already exists
      const existingClient = await Client.findOne({ 
        name: name.trim(),
        createdBy: req.admin.id 
      });

      if (existingClient) {
        return res.status(400).json({
          success: false,
          message: 'Client with this name already exists'
        });
      }

      // Create new client
      const client = new Client({
        name: name.trim(),
        website: website.trim(),
        description: description?.trim(),
        industry: industry?.trim(),
        contactEmail: contactEmail?.trim(),
        scrapingConfig: scrapingConfig || {},
        createdBy: req.admin.id
      });

      await client.save();

      // Generate and store embed script for website integration
      const embedScript = generateEmbedScript(client._id);
      client.embedScript = embedScript;
      client.scriptGeneratedAt = new Date();
      await client.save();

      res.status(201).json({
        success: true,
        message: 'Client created successfully',
        client: client,
        embedScript: embedScript,
        integrationInstructions: {
          wordpress: 'Add this script to your WordPress theme\'s footer.php or use a plugin like "Insert Headers and Footers"',
          html: 'Add this script before the closing </body> tag of your website',
          testing: 'You can test the chatbot by adding this script to any HTML page'
        }
      });

    } catch (error) {
      console.error('Create client error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create client'
      });
    }
  }

  // Update client
  async updateClient(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Remove fields that shouldn't be updated directly
      delete updates.createdBy;
      delete updates.totalPagesScrapped;
      delete updates.lastScrapedAt;

      const client = await Client.findOneAndUpdate(
        { _id: id, createdBy: req.admin.id },
        updates,
        { new: true, runValidators: true }
      );

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Client updated successfully',
        client: client
      });

    } catch (error) {
      console.error('Update client error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update client'
      });
    }
  }

  // Delete client
  async deleteClient(req, res) {
    try {
      const { id } = req.params;

      const client = await Client.findOneAndDelete({ 
        _id: id, 
        createdBy: req.admin.id 
      });

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Client deleted successfully'
      });

    } catch (error) {
      console.error('Delete client error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete client'
      });
    }
  }

  // Start scraping job for client
  async startScraping(req, res) {
    try {
      const { id } = req.params;
      const { urls } = req.body;

      const client = await Client.findOne({ 
        _id: id, 
        createdBy: req.admin.id 
      });

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      // Generate unique job ID
      const jobId = uuidv4();

      // Prepare scraping request for Node.js scraper
      const scrapeRequest = {
        client_id: client._id.toString(),
        base_url: client.website,
        urls: urls || [],
        options: {
          max_pages: client.scrapingConfig?.maxPages || 50,
          delay: client.scrapingConfig?.delay || 1000
        }
      };

      // Store job info
      activeJobs[jobId] = {
        client_id: client._id.toString(),
        status: 'queued',
        created_at: new Date(),
        urls: scrapeRequest.urls,
        base_url: scrapeRequest.base_url
      };

      console.log(`🚀 Starting Node.js scrape job ${jobId} for client ${client.name}`);

      // Start scraping job asynchronously
      scrapeService.processScrapeJob(jobId, scrapeRequest)
        .then(result => {
          activeJobs[jobId].status = 'completed';
          activeJobs[jobId].completed_at = new Date();
          activeJobs[jobId].result = result;
          console.log(`✅ Scrape job ${jobId} completed successfully`);
        })
        .catch(error => {
          activeJobs[jobId].status = 'failed';
          activeJobs[jobId].error = error.message;
          activeJobs[jobId].failed_at = new Date();
          console.error(`❌ Scrape job ${jobId} failed:`, error);
        });

      // Update client's last scraping info
      client.lastScrapingJobId = jobId;
      client.lastScrapingStarted = new Date();
      await client.save();

      res.status(200).json({
        success: true,
        message: 'Node.js scraping job started successfully',
        job_id: jobId,
        client_id: client._id,
        urls_found: scrapeRequest.urls.length || 1
      });

    } catch (error) {
      console.error('Start scraping error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start scraping job'
      });
    }
  }

  // Get scraping status
  async getScrapingStatus(req, res) {
    try {
      const { jobId } = req.params;

      if (!activeJobs[jobId]) {
        return res.status(404).json({
          success: false,
          message: 'Job not found'
        });
      }

      const job = activeJobs[jobId];

      res.status(200).json({
        success: true,
        job_id: jobId,
        client_id: job.client_id,
        status: job.status,
        created_at: job.created_at,
        completed_at: job.completed_at,
        failed_at: job.failed_at,
        error: job.error,
        result: job.result
      });

    } catch (error) {
      console.error('Get scraping status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get scraping status'
      });
    }
  }

  // Get scraped data for client
  async getScrapedData(req, res) {
    try {
      const { id } = req.params;

      const client = await Client.findOne({ 
        _id: id, 
        createdBy: req.admin.id 
      });

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      // Get scraped chunks from database
      const ScrapedChunk = require('../models/ScrapedChunk');
      const chunks = await ScrapedChunk.find({ clientId: client._id.toString() })
        .sort({ scrapedAt: -1 })
        .limit(1000); // Limit for performance

      // Group chunks by URL to get page-level data
      const pageMap = new Map();
      
      for (const chunk of chunks) {
        if (!pageMap.has(chunk.sourceUrl)) {
          pageMap.set(chunk.sourceUrl, {
            url: chunk.sourceUrl,
            title: chunk.title,
            content: '',
            chunks: [],
            scraped_at: chunk.scrapedAt,
            word_count: 0
          });
        }
        
        const page = pageMap.get(chunk.sourceUrl);
        page.chunks.push(chunk);
        page.content += chunk.content + ' ';
        page.word_count += chunk.tokenCount || 0;
      }

      const pages = Array.from(pageMap.values());

      // Calculate totals
      const totalPages = pages.length;
      const totalChunks = chunks.length;
      const totalCharacters = chunks.reduce((sum, chunk) => sum + (chunk.content?.length || 0), 0);
      const totalWords = chunks.reduce((sum, chunk) => sum + (chunk.tokenCount || 0), 0);

      console.log(`📊 Client ${client.name} data: ${totalPages} pages, ${totalChunks} chunks, current totalPagesScrapped: ${client.totalPagesScrapped}`);

      res.status(200).json({
        success: true,
        client_id: client._id,
        total_pages: totalPages,
        total_chunks: totalChunks,
        total_characters: totalCharacters,
        total_words: totalWords,
        pages: pages.map(page => ({
          url: page.url,
          title: page.title,
          content: page.content.substring(0, 500) + '...', // Truncate for response
          scraped_at: page.scraped_at,
          word_count: page.word_count
        })),
        chunks: chunks.map(chunk => ({
          id: chunk._id,
          url: chunk.sourceUrl,
          title: chunk.title,
          content: chunk.content,
          chunk_index: chunk.chunkIndex,
          token_count: chunk.tokenCount,
          scraped_at: chunk.scrapedAt
        }))
      });

    } catch (error) {
      console.error('Get scraped data error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get scraped data'
      });
    }
  }

  // Get embed script for existing client
  async getEmbedScript(req, res) {
    try {
      const { id } = req.params;
      
      const client = await Client.findOne({ 
        _id: id, 
        createdBy: req.admin.id 
      });

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      // Check if script exists in database, generate if not
      let embedScript = client.embedScript;
      if (!embedScript) {
        embedScript = generateEmbedScript(client._id);
        client.embedScript = embedScript;
        client.scriptGeneratedAt = new Date();
        await client.save();
      }

      res.status(200).json({
        success: true,
        embedScript: embedScript,
        clientName: client.name,
        scriptGeneratedAt: client.scriptGeneratedAt,
        integrationInstructions: {
          wordpress: 'Add this script to your WordPress theme footer.php or use a plugin like "Insert Headers and Footers"',
          html: 'Add this script before the closing </body> tag of your website',
          testing: 'You can test the chatbot by adding this script to any HTML page'
        }
      });

    } catch (error) {
      console.error('Get embed script error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate embed script'
      });
    }
  }

  // Regenerate embed script for existing client
  async regenerateEmbedScript(req, res) {
    try {
      const { id } = req.params;
      
      const client = await Client.findOne({ 
        _id: id, 
        createdBy: req.admin.id 
      });

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      // Generate new script and save to database
      const embedScript = generateEmbedScript(client._id);
      client.embedScript = embedScript;
      client.scriptGeneratedAt = new Date();
      await client.save();

      res.status(200).json({
        success: true,
        message: 'Embed script regenerated successfully',
        embedScript: embedScript,
        clientName: client.name,
        scriptGeneratedAt: client.scriptGeneratedAt,
        integrationInstructions: {
          wordpress: 'Add this script to your WordPress theme footer.php or use a plugin like "Insert Headers and Footers"',
          html: 'Add this script before the closing </body> tag of your website',
          testing: 'You can test the chatbot by adding this script to any HTML page'
        }
      });

    } catch (error) {
      console.error('Regenerate embed script error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to regenerate embed script'
      });
    }
  }

  // Export scraped data as CSV
  async exportScrapedDataCSV(req, res) {
    try {
      const { id } = req.params;

      const client = await Client.findOne({ 
        _id: id, 
        createdBy: req.admin.id 
      });

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      // Get scraped chunks from database
      const ScrapedChunk = require('../models/ScrapedChunk');
      const chunks = await ScrapedChunk.find({ clientId: client._id.toString() })
        .sort({ sourceUrl: 1, chunkIndex: 1 });

      if (chunks.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No scraped data found for this client'
        });
      }

      // Generate CSV content
      const csvHeaders = [
        'URL',
        'Page Title', 
        'Chunk Index',
        'Content',
        'Word Count',
        'Character Count',
        'Scraped Date'
      ];

      let csvContent = csvHeaders.join(',') + '\n';

      for (const chunk of chunks) {
        const row = [
          `"${chunk.sourceUrl || ''}"`,
          `"${(chunk.pageTitle || '').replace(/"/g, '""')}"`,
          chunk.chunkIndex || 0,
          `"${(chunk.text || '').replace(/"/g, '""')}"`,
          chunk.wordCount || 0,
          chunk.charCount || 0,
          chunk.scrapedAt ? new Date(chunk.scrapedAt).toISOString().split('T')[0] : ''
        ];
        csvContent += row.join(',') + '\n';
      }

      // Set response headers for CSV download
      const filename = `${client.name.replace(/[^a-zA-Z0-9]/g, '_')}_scraped_data_${new Date().toISOString().split('T')[0]}.csv`;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-cache');
      
      console.log(`📊 Exporting ${chunks.length} chunks as CSV for client: ${client.name}`);
      
      res.status(200).send(csvContent);

    } catch (error) {
      console.error('Export CSV error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export CSV data'
      });
    }
  }
}

module.exports = new ClientController();
