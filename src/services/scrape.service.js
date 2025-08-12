const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');
const { URL } = require('url');
const mongoose = require('mongoose');
const ScrapedChunk = require('../models/ScrapedChunk');

class NodeWebScraper {
  constructor() {
    this.scrapedUrls = new Set();
    this.browser = null;
  }

  // Initialize browser for advanced scraping
  async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    return this.browser;
  }

  // Close browser
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  // Discover sitemap URLs and extract actual page URLs
  async discoverSitemap(baseUrl) {
    try {
      console.log(`🗺️ Discovering sitemap for: ${baseUrl}`);
      
      const sitemapUrls = [
        new URL('/sitemap.xml', baseUrl).href,
        new URL('/sitemap_index.xml', baseUrl).href,
        new URL('/robots.txt', baseUrl).href
      ];

      let allPageUrls = [];

      for (const sitemapUrl of sitemapUrls) {
        try {
          console.log(`📋 Checking: ${sitemapUrl}`);
          const response = await axios.get(sitemapUrl, { timeout: 10000 });
          
          if (response.status === 200) {
            if (sitemapUrl.includes('robots.txt')) {
              const robotsSitemaps = this.parseRobotsTxt(response.data, baseUrl);
              // Fetch URLs from robots.txt sitemaps
              for (const robotsSitemap of robotsSitemaps) {
                const pageUrls = await this.fetchSitemapUrls(robotsSitemap);
                allPageUrls = allPageUrls.concat(pageUrls);
              }
            } else {
              const pageUrls = await this.fetchSitemapUrls(sitemapUrl, response.data);
              allPageUrls = allPageUrls.concat(pageUrls);
            }
          }
        } catch (error) {
          console.log(`⚠️ Failed to fetch ${sitemapUrl}: ${error.message}`);
        }
      }

      if (allPageUrls.length > 0) {
        // Filter out sitemap URLs and keep only actual page URLs
        const actualPageUrls = allPageUrls.filter(url => 
          !url.includes('.xml') && 
          !url.includes('sitemap') &&
          this.isValidUrl(url, baseUrl)
        );
        
        console.log(`✅ Found ${actualPageUrls.length} actual page URLs from sitemaps`);
        return [...new Set(actualPageUrls)]; // Remove duplicates
      }

      console.log(`ℹ️ No sitemap found, will use crawling approach`);
      return [];

    } catch (error) {
      console.error('❌ Error discovering sitemap:', error);
      return [];
    }
  }

  // Fetch actual page URLs from a sitemap (recursive for sitemap indexes)
  async fetchSitemapUrls(sitemapUrl, xmlContent = null) {
    try {
      let content = xmlContent;
      
      // Fetch content if not provided
      if (!content) {
        console.log(`📋 Fetching sitemap: ${sitemapUrl}`);
        const response = await axios.get(sitemapUrl, { timeout: 10000 });
        content = response.data;
      }

      const $ = cheerio.load(content, { xmlMode: true });
      const urls = [];

      // Check for sitemap index (contains other sitemaps)
      const sitemapElements = $('sitemap loc');
      if (sitemapElements.length > 0) {
        console.log(`📂 Found sitemap index with ${sitemapElements.length} sub-sitemaps`);
        
        // Recursively fetch URLs from each sub-sitemap
        for (let i = 0; i < sitemapElements.length && i < 10; i++) { // Limit to 10 sub-sitemaps
          const subSitemapUrl = $(sitemapElements[i]).text().trim();
          if (subSitemapUrl) {
            const subUrls = await this.fetchSitemapUrls(subSitemapUrl);
            urls.push(...subUrls);
          }
        }
      }

      // Extract individual page URLs
      $('url loc').each((i, elem) => {
        const url = $(elem).text().trim();
        if (url && !url.includes('.xml')) { // Skip XML files
          urls.push(url);
        }
      });

      console.log(`📄 Extracted ${urls.length} URLs from ${sitemapUrl}`);
      return urls;

    } catch (error) {
      console.error(`❌ Error fetching sitemap ${sitemapUrl}:`, error.message);
      return [];
    }
  }

  // Parse robots.txt for sitemap references
  parseRobotsTxt(robotsContent, baseUrl) {
    const urls = [];
    const lines = robotsContent.split('\n');
    
    for (const line of lines) {
      if (line.toLowerCase().startsWith('sitemap:')) {
        const sitemapUrl = line.substring(8).trim();
        if (sitemapUrl) {
          urls.push(sitemapUrl);
        }
      }
    }

    return urls;
  }

  // Crawl website to discover URLs (fallback)
  async crawlWebsite(baseUrl, maxPages = 50) {
    try {
      console.log(`🕷️ Crawling website: ${baseUrl} (max ${maxPages} pages)`);
      
      const urlsToVisit = [baseUrl];
      const visitedUrls = new Set();
      const discoveredUrls = [];

      while (urlsToVisit.length > 0 && discoveredUrls.length < maxPages) {
        const currentUrl = urlsToVisit.shift();
        
        if (visitedUrls.has(currentUrl)) continue;
        
        visitedUrls.add(currentUrl);
        discoveredUrls.push(currentUrl);

        try {
          const pageData = await this.scrapeUrl(currentUrl);
          if (pageData && pageData.links) {
            // Add new links to visit queue
            for (const link of pageData.links.slice(0, 10)) { // Limit links per page
              if (this.isValidUrl(link, baseUrl) && !visitedUrls.has(link)) {
                urlsToVisit.push(link);
              }
            }
          }
        } catch (error) {
          console.log(`⚠️ Error crawling ${currentUrl}: ${error.message}`);
        }

        // Small delay to be respectful
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`✅ Crawled ${discoveredUrls.length} pages from ${baseUrl}`);
      return discoveredUrls;

    } catch (error) {
      console.error('❌ Error crawling website:', error);
      return [baseUrl]; // Return at least the base URL
    }
  }

  // Scrape a single URL
  async scrapeUrl(url) {
    try {
      if (this.scrapedUrls.has(url)) {
        return null;
      }

      console.log(`📄 Scraping: ${url}`);
      
      // Try simple HTTP request first
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (response.status !== 200) {
        console.log(`⚠️ Failed to fetch ${url}: HTTP ${response.status}`);
        return null;
      }

      this.scrapedUrls.add(url);

      // Parse HTML content
      const $ = cheerio.load(response.data);

      // Extract title
      const title = $('title').text().trim() || '';

      // Extract meta description
      const metaDesc = $('meta[name="description"]').attr('content') || '';

      // Extract main content (remove scripts, styles, nav, footer)
      $('script, style, nav, footer, header, .nav, .navigation, .menu').remove();
      
      // Get main content areas
      const contentSelectors = [
        'main',
        '.main-content',
        '.content',
        'article',
        '.post-content',
        '.entry-content',
        'body'
      ];

      let content = '';
      for (const selector of contentSelectors) {
        const element = $(selector);
        if (element.length > 0) {
          content = element.text();
          break;
        }
      }

      // Clean and normalize text
      const cleanContent = this.cleanText(content);

      // Extract links
      const links = [];
      $('a[href]').each((i, elem) => {
        const href = $(elem).attr('href');
        if (href) {
          try {
            const absoluteUrl = new URL(href, url).href;
            links.push(absoluteUrl);
          } catch (e) {
            // Invalid URL, skip
          }
        }
      });

      return {
        url,
        title,
        meta_description: metaDesc,
        content: cleanContent,
        links: links.slice(0, 50), // Limit links
        scraped_at: new Date(),
        word_count: cleanContent.split(' ').length,
        status: 'success'
      };

    } catch (error) {
      console.error(`❌ Error scraping ${url}:`, error.message);
      return {
        url,
        title: '',
        meta_description: '',
        content: '',
        links: [],
        scraped_at: new Date(),
        word_count: 0,
        status: 'error',
        error: error.message
      };
    }
  }

  // Clean and normalize text
  cleanText(text) {
    if (!text) return '';

    // Remove extra whitespace and normalize
    text = text.replace(/\s+/g, ' ').trim();

    // Remove common unwanted patterns
    text = text.replace(/Cookie Policy|Privacy Policy|Terms of Service/gi, '');
    text = text.replace(/Skip to (main )?content/gi, '');
    text = text.replace(/JavaScript is disabled/gi, '');

    return text;
  }

  // Check if URL is valid for scraping
  isValidUrl(url, baseUrl) {
    try {
      const parsed = new URL(url);
      const baseParsed = new URL(baseUrl);

      // Only same domain
      if (parsed.hostname !== baseParsed.hostname) {
        return false;
      }

      // Skip certain file types
      const skipExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.css', '.js', '.ico'];
      if (skipExtensions.some(ext => url.toLowerCase().endsWith(ext))) {
        return false;
      }

      // Skip certain paths
      const skipPatterns = ['#', 'mailto:', 'tel:', 'javascript:', '/admin', '/wp-admin'];
      if (skipPatterns.some(pattern => url.toLowerCase().includes(pattern))) {
        return false;
      }

      return true;

    } catch (error) {
      return false;
    }
  }

  // Process scraped data into chunks (200 words each, no embeddings needed)
  processIntoChunks(scrapedData, clientId, jobId) {
    const chunks = [];
    const chunkSize = 200; // Changed to 200 words as requested
    const chunkOverlap = 20; // Reduced overlap proportionally

    // Calculate total chunks across all pages first
    let totalChunksCount = 0;
    for (const page of scrapedData) {
      if (!page.content || page.status !== 'success') continue;
      const words = page.content.split(' ');
      const pageChunks = Math.ceil(words.length / (chunkSize - chunkOverlap));
      totalChunksCount += pageChunks;
    }

    let globalChunkIndex = 0;

    for (const page of scrapedData) {
      if (!page.content || page.status !== 'success') continue;

      const content = page.content;
      const words = content.split(' ');
      
      for (let i = 0; i < words.length; i += chunkSize - chunkOverlap) {
        const chunkWords = words.slice(i, i + chunkSize);
        const chunkText = chunkWords.join(' ');

        if (chunkText.trim().length < 30) continue; // Skip very short chunks

        // Generate unique chunk ID
        const chunkId = `${jobId}-${globalChunkIndex}`;

        // Create minimal embedding (still required by schema but not used)
        const minimalEmbedding = new Array(768).fill(0.001); // Minimal dummy values

        chunks.push({
          // Required fields matching existing schema
          chunkId,
          clientId: new mongoose.Types.ObjectId(clientId), // Convert to ObjectId
          sourceUrl: page.url,
          pageTitle: page.title || '',
          metaDescription: page.meta_description || '',
          chunkIndex: globalChunkIndex,
          totalChunks: totalChunksCount,
          text: chunkText,
          charCount: chunkText.length,
          wordCount: chunkWords.length,
          tokenCount: chunkWords.length, // Required field
          
          // Semantic metadata (simplified)
          heading: null,
          headingLevel: null,
          sectionType: 'content',
          isHeader: false,
          semanticMetadata: {
            hasHeading: false,
            headingLevel: null,
            estimatedReadingTime: Math.ceil(chunkWords.length / 200), // ~200 words per minute
            contentType: 'content'
          },
          
          // Minimal embedding info (required by schema but not used)
          embedding: minimalEmbedding, // Minimal dummy values
          embeddingModel: 'text-embedding-004', // Valid enum value
          embeddingDimensions: 768, // Required field
          
          // Timestamps and job tracking
          scrapedAt: page.scraped_at,
          jobId
        });

        globalChunkIndex++;
      }
    }

    console.log(`📦 Created ${chunks.length} chunks of ~200 words each`);
    return chunks;
  }

  // Main scraping job processor
  async processScrapeJob(jobId, jobData) {
    try {
      console.log(`🚀 Starting Node.js scrape job ${jobId} for client ${jobData.client_id}`);

      const clientId = jobData.client_id;
      const baseUrl = jobData.base_url;
      const specificUrls = jobData.urls || [];

      let urlsToScrape = [];

      if (specificUrls.length > 0) {
        urlsToScrape = specificUrls;
        console.log(`📋 Using ${specificUrls.length} specific URLs`);
      } else if (baseUrl) {
        // Try sitemap discovery first
        const sitemapUrls = await this.discoverSitemap(baseUrl);
        
        if (sitemapUrls.length > 0) {
          urlsToScrape = sitemapUrls.slice(0, 50); // Limit to 50 URLs
        } else {
          // Fallback to crawling
          urlsToScrape = await this.crawlWebsite(baseUrl, 20);
        }
      }

      if (urlsToScrape.length === 0) {
        throw new Error('No URLs found to scrape');
      }

      console.log(`📄 Scraping ${urlsToScrape.length} URLs...`);

      // Scrape all URLs
      const scrapedPages = [];
      for (const url of urlsToScrape) {
        const pageData = await this.scrapeUrl(url);
        if (pageData) {
          scrapedPages.push(pageData);
        }
      }

      console.log(`✅ Successfully scraped ${scrapedPages.length} pages`);

      // Process into chunks
      const chunks = this.processIntoChunks(scrapedPages, clientId, jobId);
      console.log(`📦 Created ${chunks.length} chunks`);

      // Save chunks to database
      if (chunks.length > 0) {
        await ScrapedChunk.insertMany(chunks);
        console.log(`💾 Saved ${chunks.length} chunks to database`);
      }

      // Update client's page count and last scraped time
      const Client = require('../models/Client');
      try {
        console.log(`🔍 Looking for client with ID: ${clientId} (type: ${typeof clientId})`);
        const client = await Client.findById(new mongoose.Types.ObjectId(clientId));
        if (client) {
          console.log(`📊 BEFORE UPDATE - Client: ${client.name}`);
          console.log(`📊 BEFORE UPDATE - Current totalPagesScrapped: ${client.totalPagesScrapped}`);
          console.log(`📊 BEFORE UPDATE - Setting to: ${scrapedPages.length} pages`);
          
          const oldPageCount = client.totalPagesScrapped;
          client.totalPagesScrapped = scrapedPages.length;
          client.lastScrapedAt = new Date();
          
          const savedClient = await client.save();
          
          console.log(`📊 AFTER SAVE - Client: ${savedClient.name}`);
          console.log(`📊 AFTER SAVE - totalPagesScrapped: ${savedClient.totalPagesScrapped}`);
          console.log(`📊 AFTER SAVE - Changed from ${oldPageCount} to ${savedClient.totalPagesScrapped}`);
          console.log(`✅ Successfully updated client page count: ${scrapedPages.length} pages scraped`);
          
          // Verify the update by re-fetching the client
          const verifyClient = await Client.findById(new mongoose.Types.ObjectId(clientId));
          console.log(`🔍 VERIFICATION - Re-fetched client totalPagesScrapped: ${verifyClient.totalPagesScrapped}`);
          
        } else {
          console.error(`❌ Client not found with ID: ${clientId}`);
          console.error(`❌ Attempted to find client with ObjectId: ${new mongoose.Types.ObjectId(clientId)}`);
        }
      } catch (error) {
        console.error(`❌ Error updating client page count:`, error);
        console.error(`❌ ClientId: ${clientId}, Type: ${typeof clientId}`);
        console.error(`❌ Stack trace:`, error.stack);
      }

      return {
        success: true,
        pages_scraped: scrapedPages.length,
        chunks_created: chunks.length,
        urls_processed: urlsToScrape.length
      };

    } catch (error) {
      console.error(`❌ Error in scrape job ${jobId}:`, error);
      throw error;
    } finally {
      await this.closeBrowser();
    }
  }
}

module.exports = new NodeWebScraper();