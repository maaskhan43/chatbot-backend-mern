const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const pdf = require('pdf-parse');
const XLSX = require('xlsx');
const { marked } = require('marked');
const cheerio = require('cheerio');
const ClientQA = require('../models/ClientQA');
const Client = require('../models/Client');
const GeminiService = require('../services/gemini.service');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/qa');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `qa-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'text/csv',
    'application/pdf',
    'text/plain',
    'application/json',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/markdown',
    'text/x-markdown'
  ];
  
  // Also check file extension for markdown files
  const fileExtension = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.md', '.markdown'];
  
  if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type. Please upload CSV, PDF, TXT, JSON, XLSX, or Markdown files.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

class ClientQAController {
  constructor() {}

  // Upload Q&A pairs from file
  async uploadQAPairs(req, res) {
    try {
      const { id } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      // Verify client exists and belongs to admin
      const client = await Client.findOne({ 
        _id: id, 
        createdBy: req.admin.id 
      });

      if (!client) {
        // Clean up uploaded file
        fs.unlinkSync(file.path);
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      console.log(`📤 Processing Q&A upload for client ${client.name}: ${file.originalname} (${file.mimetype})`);

      // Determine file type
      const fileType = this.getFileType(file.mimetype, file.originalname);
      
      // Create ClientQA record
      const clientQA = new ClientQA({
        clientId: client._id,
        fileName: file.originalname,
        fileType: fileType,
        status: 'processing'
      });

      await clientQA.save();

      // Process file asynchronously
      this.processQAFile(file.path, fileType, clientQA._id)
        .then(async (result) => {
          const { pairs, fullText } = result;
          console.log(`🧠 Generating embeddings for ${pairs.length} questions...`);
          // Generate embeddings for each question
          const pairsWithEmbeddings = await Promise.all(
            pairs.map(async (pair) => {
              const embedding = await GeminiService.generateEmbedding(pair.question);
              return { ...pair, embedding };
            })
          );

          const successfulPairs = pairsWithEmbeddings.filter(p => p.embedding);
          console.log(`✅ Generated ${successfulPairs.length} embeddings successfully.`);

          clientQA.pairs = successfulPairs;
          clientQA.fullText = fullText;
          clientQA.totalPairs = clientQA.pairs.length;
          clientQA.status = 'completed';
          clientQA.processedAt = new Date();

          await clientQA.save();
          console.log(`💾 Saved ${clientQA.totalPairs} Q&A pairs with embeddings to the database.`);
          
          console.log(`✅ Successfully processed ${result.pairs.length} Q&A pairs for client ${client.name}`);
          
          // Clean up uploaded file
          fs.unlinkSync(file.path);
        })
        .catch(async (error) => {
          console.error(`❌ Failed to process Q&A file for client ${client.name}:`, error);
          
          // Defensive error handling - ensure we have proper error structure
          const errorMessage = error && error.message ? error.message : 'Unknown processing error';
          
          clientQA.status = 'failed';
          clientQA.errorMessage = errorMessage;
          await clientQA.save();
          
          // Clean up uploaded file
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });

      res.status(200).json({
        success: true,
        message: 'Q&A file uploaded and processing started',
        uploadId: clientQA._id,
        fileName: file.originalname,
        fileType: fileType
      });

    } catch (error) {
      console.error('Upload Q&A pairs error:', error);
      
      // Clean up uploaded file if it exists
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      res.status(500).json({
        success: false,
        message: 'Failed to upload Q&A file'
      });
    }
  }

  // Get file type from MIME type
  getFileType(mimetype, filename = '') {
    const typeMap = {
      'text/csv': 'csv',
      'application/pdf': 'pdf',
      'text/plain': 'txt',
      'application/json': 'json',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.ms-excel': 'xlsx',
      'text/markdown': 'markdown',
      'text/x-markdown': 'markdown'
    };
    
    // Check by MIME type first
    if (typeMap[mimetype]) {
      return typeMap[mimetype];
    }
    
    // Fallback to file extension for markdown files
    const fileExtension = path.extname(filename).toLowerCase();
    if (fileExtension === '.md' || fileExtension === '.markdown') {
      return 'markdown';
    }
    
    return 'unknown';
  }

  // Process Q&A file based on type
  async processQAFile(filePath, fileType, clientQAId) {
    console.log(`🔄 Processing ${fileType.toUpperCase()} file: ${filePath}`);
    
    switch (fileType) {
      case 'csv':
        return await this.parseCSV(filePath);
      case 'pdf':
        return await this.parsePDF(filePath);
      case 'txt':
        return await this.parseTXT(filePath);
      case 'json':
        return await this.parseJSON(filePath);
      case 'xlsx':
        return await this.parseXLSX(filePath);
      case 'markdown':
        return await this.parseMarkdown(filePath);
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
  }

  // Parse CSV file
  async parseCSV(filePath) {
    return new Promise((resolve, reject) => {
      const pairs = [];
      
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          // Expected CSV format: question,answer,category (optional)
          if (row.question && row.answer) {
            pairs.push({
              question: row.question.trim(),
              answer: row.answer.trim(),
              category: row.category ? row.category.trim() : 'general',
              confidence: row.confidence ? parseFloat(row.confidence) : 1.0
            });
          }
        })
        .on('end', () => {
          console.log(`📊 Parsed ${pairs.length} Q&A pairs from CSV`);
          resolve({
            pairs: pairs,
            fullText: pairs.map(p => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n')
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  // Parse PDF file
  async parsePDF(filePath) {
    try {
      const dataBuffer = fs.readFileSync(filePath);
      
      // Try multiple PDF parsing strategies
      let text = '';
      let pdfData = null;
      
      try {
        // Primary parsing attempt
        pdfData = await pdf(dataBuffer);
        text = pdfData.text;
      } catch (primaryError) {
        console.log(`⚠️ Primary PDF parsing failed: ${primaryError.message}`);
        
        // Try alternative parsing with different options
        try {
          pdfData = await pdf(dataBuffer, {
            // More lenient parsing options
            max: 0, // Parse all pages
            version: 'v1.10.100'
          });
          text = pdfData.text;
          console.log(`✅ Alternative PDF parsing succeeded`);
        } catch (secondaryError) {
          console.log(`⚠️ Alternative PDF parsing also failed: ${secondaryError.message}`);
          
          // Last resort: try to extract any readable text
          const rawText = dataBuffer.toString('utf8', 0, Math.min(dataBuffer.length, 10000));
          const cleanText = rawText.replace(/[^\x20-\x7E\n\r]/g, ' ').replace(/\s+/g, ' ');
          
          if (cleanText.length > 100) {
            text = cleanText;
            console.log(`⚠️ Using raw text extraction as fallback`);
          } else {
            throw new Error(`Unable to extract any readable text from PDF: ${primaryError.message}`);
          }
        }
      }
      
      if (!text || text.trim().length === 0) {
        throw new Error('PDF appears to be empty or contains no extractable text');
      }
      
      console.log(`📄 Extracted ${text.length} characters from PDF`);
      console.log(`📄 Sample text: ${text.substring(0, 200)}...`);
      
      // Enhanced Q&A extraction with multiple patterns
      const pairs = [];
      
      // Strategy 1: Look for clear Q&A patterns
      const qaPatterns = [
        /(?:Q\d*[:\.]?\s*)(.*?)(?:A\d*[:\.]?\s*)(.*?)(?=Q\d*[:\.]|$)/gis,
        /(?:Question\d*[:\.]?\s*)(.*?)(?:Answer\d*[:\.]?\s*)(.*?)(?=Question|$)/gis,
        /(?:प्रश्न\d*[:\.]?\s*)(.*?)(?:उत्तर\d*[:\.]?\s*)(.*?)(?=प्रश्न|$)/gis, // Hindi Q&A
      ];
      
      for (const pattern of qaPatterns) {
        const matches = [...text.matchAll(pattern)];
        for (const match of matches) {
          if (match[1] && match[2]) {
            const question = match[1].trim().replace(/\s+/g, ' ');
            const answer = match[2].trim().replace(/\s+/g, ' ');
            
            if (question.length > 10 && answer.length > 10) {
              pairs.push({
                question: question.substring(0, 500),
                answer: answer.substring(0, 1000),
                category: 'general',
                confidence: 0.9
              });
            }
          }
        }
      }
      
      // Strategy 2: Line-by-line parsing for structured Q&A
      if (pairs.length === 0) {
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        let currentQuestion = '';
        let currentAnswer = '';
        let isQuestion = false;
        let isAnswer = false;
        
        for (const line of lines) {
          // Check for question indicators
          if (line.match(/^(Q\d*[:\.]?|Question\d*[:\.]?|प्रश्न\d*[:\.]?)/i)) {
            // Save previous Q&A pair if exists
            if (currentQuestion && currentAnswer) {
              pairs.push({
                question: currentQuestion.trim(),
                answer: currentAnswer.trim(),
                category: 'general',
                confidence: 0.8
              });
            }
            
            currentQuestion = line.replace(/^(Q\d*[:\.]?|Question\d*[:\.]?|प्रश्न\d*[:\.]?)/i, '').trim();
            currentAnswer = '';
            isQuestion = true;
            isAnswer = false;
          }
          // Check for answer indicators
          else if (line.match(/^(A\d*[:\.]?|Answer\d*[:\.]?|उत्तर\d*[:\.]?)/i)) {
            currentAnswer = line.replace(/^(A\d*[:\.]?|Answer\d*[:\.]?|उत्तर\d*[:\.]?)/i, '').trim();
            isQuestion = false;
            isAnswer = true;
          }
          // Continue building question or answer
          else if (line.length > 5) {
            if (isQuestion && currentQuestion.length < 400) {
              currentQuestion += ' ' + line;
            } else if (isAnswer && currentAnswer.length < 800) {
              currentAnswer += ' ' + line;
            }
          }
        }
        
        // Save last Q&A pair
        if (currentQuestion && currentAnswer) {
          pairs.push({
            question: currentQuestion.trim(),
            answer: currentAnswer.trim(),
            category: 'general',
            confidence: 0.8
          });
        }
      }
      
      // Strategy 3: Smart paragraph-based extraction if no patterns found
      if (pairs.length === 0) {
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 30);
        
        for (let i = 0; i < paragraphs.length - 1; i++) {
          const para1 = paragraphs[i].trim();
          const para2 = paragraphs[i + 1].trim();
          
          // Check if first paragraph looks like a question
          if (para1.includes('?') || para1.match(/^(what|how|when|where|why|which|who)/i)) {
            pairs.push({
              question: para1.substring(0, 500),
              answer: para2.substring(0, 1000),
              category: 'general',
              confidence: 0.6
            });
            i++; // Skip next paragraph as it's used as answer
          }
        }
      }
      
      // Remove strict filtration - extract ALL Q&A pairs found
      console.log(`📊 Extracted ${pairs.length} Q&A pairs from PDF using multiple strategies (no filtration)`);
      
      if (pairs.length > 0) {
        pairs.forEach((pair, index) => {
          console.log(`📝 Q${index + 1}: ${pair.question.substring(0, 80)}...`);
          console.log(`📝 A${index + 1}: ${pair.answer.substring(0, 80)}...`);
        });
      }
      
      // Return both Q&A pairs AND full text for chatbot flexibility
      return {
        pairs: pairs.length > 0 ? pairs : [{
          question: 'PDF Processing Notice',
          answer: `PDF was processed but no clear Q&A patterns were found. The PDF may contain ${text.length} characters of text but in a format that doesn't match standard Q&A patterns (Q:/A:, Question:/Answer:). Please ensure your PDF has clear Q&A formatting or try converting to TXT/CSV format.`,
          category: 'info',
          confidence: 0.0
        }],
        fullText: text // Store complete PDF text for chatbot fallback
      };
      
    } catch (error) {
      console.error('PDF parsing error:', error.message);
      
      // Fallback: Return error information as a Q&A pair for user reference
      const fallbackPairs = [{
        question: 'PDF Processing Error',
        answer: `Failed to process PDF file: ${error.message}. Please try converting the PDF to text format or use a different PDF file. Common issues: corrupted PDF, password-protected PDF, or complex formatting.`,
        category: 'error',
        confidence: 0.0
      }];
      
      console.log(`⚠️ PDF parsing failed, returning error information as Q&A pair`);
      return {
        pairs: fallbackPairs,
        fullText: `PDF Processing Error: ${error.message}`
      };
    }
  }

  // Parse TXT file
  async parseTXT(filePath) {
    const text = fs.readFileSync(filePath, 'utf8');
    const pairs = [];
    
    // Similar logic to PDF parsing
    const lines = text.split('\n');
    
    let currentQuestion = '';
    let currentAnswer = '';
    let isQuestion = false;
    let isAnswer = false;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine.match(/^(Q:|Question:|Q\d+:)/i)) {
        // Save previous Q&A pair if exists
        if (currentQuestion && currentAnswer) {
          pairs.push({
            question: currentQuestion.trim(),
            answer: currentAnswer.trim(),
            category: 'general',
            confidence: 1.0
          });
        }
        
        currentQuestion = trimmedLine.replace(/^(Q:|Question:|Q\d+:)/i, '').trim();
        currentAnswer = '';
        isQuestion = true;
        isAnswer = false;
      } else if (trimmedLine.match(/^(A:|Answer:|A\d+:)/i)) {
        currentAnswer = trimmedLine.replace(/^(A:|Answer:|A\d+:)/i, '').trim();
        isQuestion = false;
        isAnswer = true;
      } else if (trimmedLine) {
        if (isQuestion) {
          currentQuestion += ' ' + trimmedLine;
        } else if (isAnswer) {
          currentAnswer += ' ' + trimmedLine;
        }
      }
    }
    
    // Save last Q&A pair
    if (currentQuestion && currentAnswer) {
      pairs.push({
        question: currentQuestion.trim(),
        answer: currentAnswer.trim(),
        category: 'general',
        confidence: 1.0
      });
    }
    
    console.log(`📊 Parsed ${pairs.length} Q&A pairs from TXT`);
    return {
      pairs: pairs,
      fullText: text
    };
  }

  // Parse JSON file
  async parseJSON(filePath) {
    const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const pairs = [];
    
    // Expected JSON format: { "qa_pairs": [{ "question": "...", "answer": "..." }] }
    // or direct array: [{ "question": "...", "answer": "..." }]
    
    let qaArray = Array.isArray(jsonData) ? jsonData : jsonData.qa_pairs || jsonData.pairs || [];
    
    for (const item of qaArray) {
      if (item.question && item.answer) {
        pairs.push({
          question: item.question.trim(),
          answer: item.answer.trim(),
          category: item.category || 'general',
          confidence: item.confidence || 1.0
        });
      }
    }
    
    console.log(`📊 Parsed ${pairs.length} Q&A pairs from JSON`);
    return {
      pairs: pairs,
      fullText: pairs.map(p => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n')
    };
  }

  // Parse XLSX file
  async parseXLSX(filePath) {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    
    const pairs = [];
    
    for (const row of jsonData) {
      // Expected columns: question, answer, category (optional)
      if (row.question && row.answer) {
        pairs.push({
          question: row.question.toString().trim(),
          answer: row.answer.toString().trim(),
          category: row.category ? row.category.toString().trim() : 'general',
          confidence: row.confidence ? parseFloat(row.confidence) : 1.0
        });
      }
    }
    
    console.log(`📊 Parsed ${pairs.length} Q&A pairs from XLSX`);
    return {
      pairs: pairs,
      fullText: pairs.map(p => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n')
    };
  }

  // Parse Markdown file
  async parseMarkdown(filePath) {
    try {
      const markdownContent = fs.readFileSync(filePath, 'utf-8');
      const html = marked.parse(markdownContent);
      const $ = cheerio.load(html);
      const pairs = [];

      // Handle questions in h1, h2, h3 tags followed by a p tag
      $('h1, h2, h3').each((i, el) => {
        const question = $(el).text().trim();
        const answerElement = $(el).next('p');
        if (question && answerElement.length > 0) {
          const answer = answerElement.text().trim();
          if (answer) {
            pairs.push({ question, answer, category: 'general', confidence: 1.0 });
          }
        }
      });

      // Handle questions in ordered lists (e.g., 1. **Question**)
      $('li').each((i, el) => {
        const strongTag = $(el).find('strong');
        if (strongTag.length > 0) {
          const question = strongTag.text().trim().replace(/^\d+\.?\s*/, '');
          // The answer is the text of the 'li' element without the question text.
          const fullText = $(el).text().trim();
          let answer = fullText.replace(strongTag.text().trim(), '').trim();
          // Clean up the answer if it starts with a newline or strange characters
          answer = answer.replace(/^[\s\S]*?(\w)/, '$1');

          if (question && answer) {
            pairs.push({ question, answer, category: 'general', confidence: 1.0 });
          }
        }
      });

      const fullText = pairs.map(p => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n');
      return { pairs, fullText };
    } catch (error) {
      console.error('Error parsing Markdown file:', error);
      throw new Error('Failed to parse Markdown file.');
    }
  }

  // Get Q&A data for client
  async getClientQA(req, res) {
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

      const qaRecords = await ClientQA.find({ clientId: client._id })
        .sort({ uploadedAt: -1 });

      const totalPairs = qaRecords.reduce((sum, record) => sum + record.totalPairs, 0);

      // Debug logging
      console.log(`🔍 DEBUG - Client QA Data for ${client.name}:`);
      console.log(`📊 Total uploads: ${qaRecords.length}`);
      console.log(`📊 Total pairs: ${totalPairs}`);
      
      qaRecords.forEach((record, index) => {
        console.log(`📄 Upload ${index + 1}: ${record.fileName} (${record.fileType})`);
        console.log(`   Status: ${record.status}`);
        console.log(`   Pairs: ${record.totalPairs}`);
        console.log(`   Error: ${record.errorMessage || 'None'}`);
        
        if (record.pairs && record.pairs.length > 0) {
          console.log(`   Sample Q&A pairs:`);
          record.pairs.slice(0, 3).forEach((pair, pairIndex) => {
            console.log(`     Q${pairIndex + 1}: ${pair.question.substring(0, 100)}...`);
            console.log(`     A${pairIndex + 1}: ${pair.answer.substring(0, 100)}...`);
          });
        }
      });

      res.status(200).json({
        success: true,
        client_id: client._id,
        client_name: client.name,
        total_uploads: qaRecords.length,
        total_pairs: totalPairs,
        uploads: qaRecords.map(record => ({
          id: record._id,
          fileName: record.fileName,
          fileType: record.fileType,
          uploadedAt: record.uploadedAt,
          processedAt: record.processedAt,
          totalPairs: record.totalPairs,
          status: record.status,
          errorMessage: record.errorMessage,
          samplePairs: record.pairs ? record.pairs.slice(0, 3).map(pair => ({
            question: pair.question.substring(0, 200),
            answer: pair.answer.substring(0, 200),
            category: pair.category,
            confidence: pair.confidence
          })) : []
        }))
      });

    } catch (error) {
      console.error('Get client Q&A error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get Q&A data'
      });
    }
  }
}

const clientQAController = new ClientQAController();

// Export multer middleware and controller
module.exports = {
  upload: upload.single('qaFile'),
  uploadQAPairs: clientQAController.uploadQAPairs.bind(clientQAController),
  getClientQA: clientQAController.getClientQA.bind(clientQAController)
};
