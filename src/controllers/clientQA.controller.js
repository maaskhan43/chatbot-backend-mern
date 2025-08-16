const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const pdf = require('pdf-parse');
const XLSX = require('xlsx');
const { marked } = require('marked');
const cheerio = require('cheerio');
const mammoth = require('mammoth');
const { JSDOM } = require('jsdom');
const xml2js = require('xml2js');
const { htmlToText } = require('html-to-text');
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
    // Text formats
    'text/csv',
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'text/html',
    'text/xml',
    'application/xml',
    'text/rtf',
    'application/rtf',
    
    // Document formats
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
    'application/msword', // DOC
    'application/vnd.oasis.opendocument.text', // ODT
    
    // Spreadsheet formats
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
    'application/vnd.ms-excel', // XLS
    'application/vnd.oasis.opendocument.spreadsheet', // ODS
    
    // Data formats
    'application/json',
    'application/xml',
    'text/xml'
  ];
  
  // Check file extension for additional support
  const fileExtension = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = [
    '.md', '.markdown', '.txt', '.csv', '.json', '.xml', '.html', '.htm',
    '.pdf', '.docx', '.doc', '.odt', '.xlsx', '.xls', '.ods', '.rtf'
  ];
  
  if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type. Please upload supported document formats: PDF, DOCX, DOC, TXT, CSV, JSON, XLSX, XLS, HTML, XML, RTF, Markdown, or ODT files.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB limit for larger documents
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

  // Get file type from MIME type and extension
  getFileType(mimetype, filename = '') {
    const typeMap = {
      // Text formats
      'text/csv': 'csv',
      'text/plain': 'txt',
      'text/markdown': 'markdown',
      'text/x-markdown': 'markdown',
      'text/html': 'html',
      'text/xml': 'xml',
      'application/xml': 'xml',
      'text/rtf': 'rtf',
      'application/rtf': 'rtf',
      
      // Document formats
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/msword': 'doc',
      'application/vnd.oasis.opendocument.text': 'odt',
      
      // Spreadsheet formats
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.ms-excel': 'xlsx',
      'application/vnd.oasis.opendocument.spreadsheet': 'ods',
      
      // Data formats
      'application/json': 'json'
    };
    
    // Check by MIME type first
    if (typeMap[mimetype]) {
      return typeMap[mimetype];
    }
    
    // Fallback to file extension
    const fileExtension = path.extname(filename).toLowerCase();
    const extensionMap = {
      '.md': 'markdown',
      '.markdown': 'markdown',
      '.txt': 'txt',
      '.csv': 'csv',
      '.json': 'json',
      '.xml': 'xml',
      '.html': 'html',
      '.htm': 'html',
      '.pdf': 'pdf',
      '.docx': 'docx',
      '.doc': 'doc',
      '.odt': 'odt',
      '.xlsx': 'xlsx',
      '.xls': 'xlsx',
      '.ods': 'ods',
      '.rtf': 'rtf'
    };
    
    return extensionMap[fileExtension] || 'unknown';
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
      case 'docx':
        return await this.parseDOCX(filePath);
      case 'doc':
        return await this.parseDOC(filePath);
      case 'html':
        return await this.parseHTML(filePath);
      case 'xml':
        return await this.parseXML(filePath);
      case 'rtf':
        return await this.parseRTF(filePath);
      case 'odt':
        return await this.parseODT(filePath);
      case 'ods':
        return await this.parseODS(filePath);
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
  }

  // Parse CSV file with enhanced format support
  async parseCSV(filePath) {
    return new Promise((resolve, reject) => {
      const pairs = [];
      let headers = [];
      let isFirstRow = true;
      
      fs.createReadStream(filePath)
        .pipe(csv({
          skipEmptyLines: true,
          skipLinesWithError: true,
          separator: 'auto' // Auto-detect separator
        }))
        .on('headers', (headerList) => {
          headers = headerList.map(h => h.toLowerCase().trim());
          console.log(`📋 CSV Headers detected: ${headers.join(', ')}`);
        })
        .on('data', (row) => {
          try {
            // Multiple column name variations support
            const questionKeys = ['question', 'q', 'query', 'ask', 'प्रश्न', 'pregunta', 'frage'];
            const answerKeys = ['answer', 'a', 'response', 'reply', 'उत्तर', 'respuesta', 'antwort'];
            const categoryKeys = ['category', 'cat', 'type', 'topic', 'श्रेणी', 'categoría', 'kategorie'];
            const confidenceKeys = ['confidence', 'conf', 'score', 'weight'];
            
            let question = '';
            let answer = '';
            let category = 'general';
            let confidence = 1.0;
            
            // Find question column
            for (const key of questionKeys) {
              if (row[key]) {
                question = row[key].toString().trim();
                break;
              }
            }
            
            // Find answer column
            for (const key of answerKeys) {
              if (row[key]) {
                answer = row[key].toString().trim();
                break;
              }
            }
            
            // Find category column
            for (const key of categoryKeys) {
              if (row[key]) {
                category = row[key].toString().trim();
                break;
              }
            }
            
            // Find confidence column
            for (const key of confidenceKeys) {
              if (row[key]) {
                const conf = parseFloat(row[key]);
                if (!isNaN(conf)) {
                  confidence = Math.max(0, Math.min(1, conf)); // Clamp between 0 and 1
                }
                break;
              }
            }
            
            // If no structured columns found, try to use first two columns
            if (!question && !answer && Object.keys(row).length >= 2) {
              const values = Object.values(row);
              question = values[0] ? values[0].toString().trim() : '';
              answer = values[1] ? values[1].toString().trim() : '';
              console.log(`⚠️ Using first two columns as Q&A: "${question.substring(0, 50)}..." -> "${answer.substring(0, 50)}..."`);
            }
            
            if (question && answer && question.length > 3 && answer.length > 3) {
              pairs.push({
                question: question.substring(0, 500),
                answer: answer.substring(0, 1000),
                category: category || 'general',
                confidence: confidence
              });
            }
          } catch (rowError) {
            console.warn(`⚠️ Skipping malformed CSV row: ${rowError.message}`);
          }
        })
        .on('end', () => {
          console.log(`📊 Parsed ${pairs.length} Q&A pairs from CSV`);
          
          if (pairs.length === 0) {
            console.log(`⚠️ No valid Q&A pairs found. Headers were: ${headers.join(', ')}`);
            console.log(`💡 Expected columns: question/q, answer/a, category (optional), confidence (optional)`);
          }
          
          resolve({
            pairs: pairs.length > 0 ? pairs : [{
              question: 'CSV Processing Notice',
              answer: `CSV file was processed but no valid Q&A pairs were found. Please ensure your CSV has columns named 'question' and 'answer' (or 'q' and 'a'). Detected headers: ${headers.join(', ')}`,
              category: 'info',
              confidence: 0.0
            }],
            fullText: pairs.map(p => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n')
          });
        })
        .on('error', (error) => {
          console.error('CSV parsing error:', error);
          reject(new Error(`Failed to parse CSV file: ${error.message}`));
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

  // Parse TXT file with enhanced format detection
  async parseTXT(filePath) {
    try {
      // Try different encodings
      let text = '';
      try {
        text = fs.readFileSync(filePath, 'utf8');
      } catch (utf8Error) {
        console.log('⚠️ UTF-8 failed, trying latin1 encoding...');
        try {
          text = fs.readFileSync(filePath, 'latin1');
        } catch (latin1Error) {
          console.log('⚠️ Latin1 failed, trying binary encoding...');
          const buffer = fs.readFileSync(filePath);
          text = buffer.toString('binary');
        }
      }
      
      if (!text || text.trim().length === 0) {
        throw new Error('TXT file appears to be empty');
      }
      
      console.log(`📄 Read ${text.length} characters from TXT file`);
      
      // Use the enhanced universal text extraction method
      return await this.extractQAFromText(text, 'txt');
      
    } catch (error) {
      console.error('TXT parsing error:', error);
      throw new Error(`Failed to parse TXT file: ${error.message}`);
    }
  }

  // Parse JSON file with enhanced format support
  async parseJSON(filePath) {
    try {
      const jsonContent = fs.readFileSync(filePath, 'utf8');
      let jsonData;
      
      try {
        jsonData = JSON.parse(jsonContent);
      } catch (parseError) {
        // Try to fix common JSON issues
        const fixedJson = jsonContent
          .replace(/,\s*}/g, '}') // Remove trailing commas
          .replace(/,\s*]/g, ']')
          .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3'); // Add quotes to unquoted keys
        
        try {
          jsonData = JSON.parse(fixedJson);
          console.log('✅ Fixed malformed JSON and parsed successfully');
        } catch (fixError) {
          throw new Error(`Invalid JSON format: ${parseError.message}`);
        }
      }
      
      const pairs = [];
      
      // Multiple JSON structure support
      const possibleArrays = [
        jsonData, // Direct array
        jsonData.qa_pairs,
        jsonData.pairs,
        jsonData.questions,
        jsonData.data,
        jsonData.items,
        jsonData.content,
        jsonData.faq,
        jsonData.qna
      ].filter(arr => Array.isArray(arr));
      
      // If no arrays found, try to extract from object properties
      if (possibleArrays.length === 0 && typeof jsonData === 'object') {
        Object.keys(jsonData).forEach(key => {
          if (Array.isArray(jsonData[key])) {
            possibleArrays.push(jsonData[key]);
          }
        });
      }
      
      // Process all found arrays
      for (const qaArray of possibleArrays) {
        for (const item of qaArray) {
          if (typeof item === 'object' && item !== null) {
            // Multiple property name variations
            const questionKeys = ['question', 'q', 'query', 'ask', 'title'];
            const answerKeys = ['answer', 'a', 'response', 'reply', 'content', 'text'];
            
            let question = '';
            let answer = '';
            
            // Find question
            for (const key of questionKeys) {
              if (item[key]) {
                question = String(item[key]).trim();
                break;
              }
            }
            
            // Find answer
            for (const key of answerKeys) {
              if (item[key]) {
                answer = String(item[key]).trim();
                break;
              }
            }
            
            if (question && answer && question.length > 3 && answer.length > 3) {
              pairs.push({
                question: question.substring(0, 500),
                answer: answer.substring(0, 1000),
                category: item.category || item.type || item.topic || 'general',
                confidence: item.confidence ? parseFloat(item.confidence) : 1.0
              });
            }
          }
        }
      }
      
      console.log(`📊 Parsed ${pairs.length} Q&A pairs from JSON`);
      
      if (pairs.length === 0) {
        console.log('⚠️ No valid Q&A pairs found in JSON');
        console.log('💡 Expected structure: [{"question": "...", "answer": "..."}] or {"qa_pairs": [...]}');
      }
      
      return {
        pairs: pairs.length > 0 ? pairs : [{
          question: 'JSON Processing Notice',
          answer: `JSON file was processed but no valid Q&A pairs were found. Please ensure your JSON has the correct structure with 'question' and 'answer' properties.`,
          category: 'info',
          confidence: 0.0
        }],
        fullText: pairs.map(p => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n')
      };
      
    } catch (error) {
      console.error('JSON parsing error:', error);
      throw new Error(`Failed to parse JSON file: ${error.message}`);
    }
  }

  // Parse XLSX file with enhanced format support
  async parseXLSX(filePath) {
    try {
      const workbook = XLSX.readFile(filePath);
      console.log(`📊 XLSX file has ${workbook.SheetNames.length} sheets: ${workbook.SheetNames.join(', ')}`);
      
      const pairs = [];
      
      // Process all sheets
      for (const sheetName of workbook.SheetNames) {
        console.log(`🔍 Processing sheet: ${sheetName}`);
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
          defval: '', // Default value for empty cells
          blankrows: false // Skip blank rows
        });
        
        if (jsonData.length === 0) {
          console.log(`⚠️ Sheet '${sheetName}' is empty, skipping...`);
          continue;
        }
        
        // Get headers for debugging
        const headers = Object.keys(jsonData[0] || {}).map(h => h.toLowerCase().trim());
        console.log(`📋 Sheet '${sheetName}' headers: ${headers.join(', ')}`);
        
        for (const row of jsonData) {
          try {
            // Multiple column name variations support
            const questionKeys = ['question', 'q', 'query', 'ask', 'प्रश्न', 'pregunta', 'frage'];
            const answerKeys = ['answer', 'a', 'response', 'reply', 'उत्तर', 'respuesta', 'antwort'];
            const categoryKeys = ['category', 'cat', 'type', 'topic', 'श्रेणी', 'categoría', 'kategorie'];
            const confidenceKeys = ['confidence', 'conf', 'score', 'weight'];
            
            let question = '';
            let answer = '';
            let category = 'general';
            let confidence = 1.0;
            
            // Find question column (case-insensitive)
            for (const key of Object.keys(row)) {
              const lowerKey = key.toLowerCase().trim();
              if (questionKeys.includes(lowerKey) && row[key]) {
                question = row[key].toString().trim();
                break;
              }
            }
            
            // Find answer column (case-insensitive)
            for (const key of Object.keys(row)) {
              const lowerKey = key.toLowerCase().trim();
              if (answerKeys.includes(lowerKey) && row[key]) {
                answer = row[key].toString().trim();
                break;
              }
            }
            
            // Find category column
            for (const key of Object.keys(row)) {
              const lowerKey = key.toLowerCase().trim();
              if (categoryKeys.includes(lowerKey) && row[key]) {
                category = row[key].toString().trim();
                break;
              }
            }
            
            // Find confidence column
            for (const key of Object.keys(row)) {
              const lowerKey = key.toLowerCase().trim();
              if (confidenceKeys.includes(lowerKey) && row[key]) {
                const conf = parseFloat(row[key]);
                if (!isNaN(conf)) {
                  confidence = Math.max(0, Math.min(1, conf));
                }
                break;
              }
            }
            
            // If no structured columns found, try to use first two columns
            if (!question && !answer && Object.keys(row).length >= 2) {
              const values = Object.values(row);
              question = values[0] ? values[0].toString().trim() : '';
              answer = values[1] ? values[1].toString().trim() : '';
              console.log(`⚠️ Using first two columns as Q&A in sheet '${sheetName}'`);
            }
            
            if (question && answer && question.length > 3 && answer.length > 3) {
              pairs.push({
                question: question.substring(0, 500),
                answer: answer.substring(0, 1000),
                category: category || 'general',
                confidence: confidence,
                source: `Sheet: ${sheetName}`
              });
            }
          } catch (rowError) {
            console.warn(`⚠️ Skipping malformed row in sheet '${sheetName}': ${rowError.message}`);
          }
        }
      }
      
      console.log(`📊 Parsed ${pairs.length} Q&A pairs from XLSX (${workbook.SheetNames.length} sheets)`);
      
      if (pairs.length === 0) {
        console.log(`⚠️ No valid Q&A pairs found in any sheet`);
        console.log(`💡 Expected columns: question/q, answer/a, category (optional), confidence (optional)`);
      }
      
      return {
        pairs: pairs.length > 0 ? pairs : [{
          question: 'XLSX Processing Notice',
          answer: `XLSX file was processed but no valid Q&A pairs were found. Please ensure your spreadsheet has columns named 'question' and 'answer' (or 'q' and 'a'). Processed ${workbook.SheetNames.length} sheets: ${workbook.SheetNames.join(', ')}`,
          category: 'info',
          confidence: 0.0
        }],
        fullText: pairs.map(p => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n')
      };
      
    } catch (error) {
      console.error('XLSX parsing error:', error);
      throw new Error(`Failed to parse XLSX file: ${error.message}`);
    }
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

  // Parse DOCX file
  async parseDOCX(filePath) {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      const text = result.value;
      console.log(`📄 Extracted ${text.length} characters from DOCX`);
      
      return await this.extractQAFromText(text, 'docx');
    } catch (error) {
      console.error('DOCX parsing error:', error);
      throw new Error(`Failed to parse DOCX file: ${error.message}`);
    }
  }

  // Parse DOC file (legacy Word format)
  async parseDOC(filePath) {
    try {
      // For DOC files, we'll try to use mammoth as well, though it works better with DOCX
      const result = await mammoth.extractRawText({ path: filePath });
      const text = result.value;
      console.log(`📄 Extracted ${text.length} characters from DOC`);
      
      return await this.extractQAFromText(text, 'doc');
    } catch (error) {
      console.error('DOC parsing error:', error);
      // Fallback: try reading as plain text
      try {
        const text = fs.readFileSync(filePath, 'utf8');
        return await this.extractQAFromText(text, 'doc');
      } catch (fallbackError) {
        throw new Error(`Failed to parse DOC file: ${error.message}`);
      }
    }
  }

  // Parse HTML file
  async parseHTML(filePath) {
    try {
      const htmlContent = fs.readFileSync(filePath, 'utf-8');
      const dom = new JSDOM(htmlContent);
      const document = dom.window.document;
      
      const pairs = [];
      
      // Strategy 1: Look for structured Q&A in headings and paragraphs
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      headings.forEach(heading => {
        const question = heading.textContent.trim();
        let answer = '';
        
        // Get the next sibling elements until we hit another heading
        let nextElement = heading.nextElementSibling;
        while (nextElement && !nextElement.matches('h1, h2, h3, h4, h5, h6')) {
          if (nextElement.textContent.trim()) {
            answer += nextElement.textContent.trim() + ' ';
          }
          nextElement = nextElement.nextElementSibling;
        }
        
        if (question && answer.trim()) {
          pairs.push({
            question: question.substring(0, 500),
            answer: answer.trim().substring(0, 1000),
            category: 'general',
            confidence: 0.9
          });
        }
      });
      
      // Strategy 2: Extract plain text and use general Q&A extraction
      if (pairs.length === 0) {
        const plainText = htmlToText(htmlContent, {
          wordwrap: false,
          ignoreHref: true,
          ignoreImage: true
        });
        
        const textResult = await this.extractQAFromText(plainText, 'html');
        pairs.push(...textResult.pairs);
      }
      
      console.log(`📊 Extracted ${pairs.length} Q&A pairs from HTML`);
      return {
        pairs: pairs,
        fullText: pairs.map(p => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n')
      };
      
    } catch (error) {
      console.error('HTML parsing error:', error);
      throw new Error(`Failed to parse HTML file: ${error.message}`);
    }
  }

  // Parse XML file
  async parseXML(filePath) {
    try {
      const xmlContent = fs.readFileSync(filePath, 'utf-8');
      const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
      const result = await parser.parseStringPromise(xmlContent);
      
      const pairs = [];
      
      // Strategy 1: Look for structured Q&A elements
      const extractQAFromObject = (obj, path = '') => {
        if (typeof obj === 'object' && obj !== null) {
          // Look for common Q&A patterns in XML
          if (obj.question && obj.answer) {
            pairs.push({
              question: String(obj.question).trim().substring(0, 500),
              answer: String(obj.answer).trim().substring(0, 1000),
              category: obj.category || 'general',
              confidence: obj.confidence ? parseFloat(obj.confidence) : 0.9
            });
          } else if (obj.q && obj.a) {
            pairs.push({
              question: String(obj.q).trim().substring(0, 500),
              answer: String(obj.a).trim().substring(0, 1000),
              category: obj.category || 'general',
              confidence: 0.9
            });
          }
          
          // Recursively search through all properties
          Object.keys(obj).forEach(key => {
            if (Array.isArray(obj[key])) {
              obj[key].forEach((item, index) => {
                extractQAFromObject(item, `${path}.${key}[${index}]`);
              });
            } else if (typeof obj[key] === 'object') {
              extractQAFromObject(obj[key], `${path}.${key}`);
            }
          });
        }
      };
      
      extractQAFromObject(result);
      
      // Strategy 2: If no structured Q&A found, extract all text and parse
      if (pairs.length === 0) {
        const extractTextFromXML = (obj) => {
          let text = '';
          if (typeof obj === 'string') {
            return obj + ' ';
          } else if (typeof obj === 'object' && obj !== null) {
            Object.values(obj).forEach(value => {
              text += extractTextFromXML(value);
            });
          }
          return text;
        };
        
        const allText = extractTextFromXML(result);
        const textResult = await this.extractQAFromText(allText, 'xml');
        pairs.push(...textResult.pairs);
      }
      
      console.log(`📊 Extracted ${pairs.length} Q&A pairs from XML`);
      return {
        pairs: pairs,
        fullText: pairs.map(p => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n')
      };
      
    } catch (error) {
      console.error('XML parsing error:', error);
      throw new Error(`Failed to parse XML file: ${error.message}`);
    }
  }

  // Parse RTF file
  async parseRTF(filePath) {
    try {
      // Read RTF file as text and try to extract readable content
      const rtfContent = fs.readFileSync(filePath, 'utf-8');
      
      // Basic RTF text extraction (remove RTF control codes)
      let text = rtfContent
        .replace(/\\[a-z]+\d*\s?/g, ' ') // Remove RTF control words
        .replace(/[{}]/g, ' ') // Remove braces
        .replace(/\\\\/g, '\\') // Unescape backslashes
        .replace(/\\'/g, "'") // Unescape quotes
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
      
      console.log(`📄 Extracted ${text.length} characters from RTF`);
      return await this.extractQAFromText(text, 'rtf');
      
    } catch (error) {
      console.error('RTF parsing error:', error);
      throw new Error(`Failed to parse RTF file: ${error.message}`);
    }
  }

  // Parse ODT file (OpenDocument Text)
  async parseODT(filePath) {
    try {
      // ODT files are ZIP archives, we'll try to extract content.xml
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(filePath);
      const contentEntry = zip.getEntry('content.xml');
      
      if (contentEntry) {
        const contentXml = contentEntry.getData().toString('utf8');
        const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
        const result = await parser.parseStringPromise(contentXml);
        
        // Extract text from ODT structure
        const extractTextFromODT = (obj) => {
          let text = '';
          if (typeof obj === 'string') {
            return obj + ' ';
          } else if (typeof obj === 'object' && obj !== null) {
            Object.values(obj).forEach(value => {
              text += extractTextFromODT(value);
            });
          }
          return text;
        };
        
        const text = extractTextFromODT(result);
        console.log(`📄 Extracted ${text.length} characters from ODT`);
        return await this.extractQAFromText(text, 'odt');
      } else {
        throw new Error('Could not find content.xml in ODT file');
      }
      
    } catch (error) {
      console.error('ODT parsing error:', error);
      throw new Error(`Failed to parse ODT file: ${error.message}`);
    }
  }

  // Parse ODS file (OpenDocument Spreadsheet)
  async parseODS(filePath) {
    try {
      // Use XLSX library which supports ODS format
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
      
      console.log(`📊 Parsed ${pairs.length} Q&A pairs from ODS`);
      return {
        pairs: pairs,
        fullText: pairs.map(p => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n')
      };
      
    } catch (error) {
      console.error('ODS parsing error:', error);
      throw new Error(`Failed to parse ODS file: ${error.message}`);
    }
  }

  // Universal text-based Q&A extraction method
  async extractQAFromText(text, fileType = 'text') {
    const pairs = [];
    
    if (!text || text.trim().length === 0) {
      throw new Error(`${fileType.toUpperCase()} appears to be empty or contains no extractable text`);
    }
    
    // Enhanced Q&A extraction with multiple patterns and languages
    const qaPatterns = [
      // English patterns
      /(?:Q\d*[:\.]?\s*)(.*?)(?:A\d*[:\.]?\s*)(.*?)(?=Q\d*[:\.]|$)/gis,
      /(?:Question\d*[:\.]?\s*)(.*?)(?:Answer\d*[:\.]?\s*)(.*?)(?=Question|$)/gis,
      /(?:Query\d*[:\.]?\s*)(.*?)(?:Response\d*[:\.]?\s*)(.*?)(?=Query|$)/gis,
      
      // Hindi patterns
      /(?:प्रश्न\d*[:\.]?\s*)(.*?)(?:उत्तर\d*[:\.]?\s*)(.*?)(?=प्रश्न|$)/gis,
      
      // Spanish patterns
      /(?:Pregunta\d*[:\.]?\s*)(.*?)(?:Respuesta\d*[:\.]?\s*)(.*?)(?=Pregunta|$)/gis,
      
      // French patterns
      /(?:Question\d*[:\.]?\s*)(.*?)(?:Réponse\d*[:\.]?\s*)(.*?)(?=Question|$)/gis,
      
      // German patterns
      /(?:Frage\d*[:\.]?\s*)(.*?)(?:Antwort\d*[:\.]?\s*)(.*?)(?=Frage|$)/gis,
      
      // Generic patterns
      /(?:\d+\.\s*)(.*?)(?:\n\s*)(.*?)(?=\d+\.|$)/gis
    ];
    
    // Strategy 1: Pattern-based extraction
    for (const pattern of qaPatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        if (match[1] && match[2]) {
          const question = match[1].trim().replace(/\s+/g, ' ');
          const answer = match[2].trim().replace(/\s+/g, ' ');
          
          if (question.length > 5 && answer.length > 5) {
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
        // Enhanced question indicators (multilingual)
        if (line.match(/^(Q\d*[:\.]?|Question\d*[:\.]?|प्रश्न\d*[:\.]?|Pregunta\d*[:\.]?|Frage\d*[:\.]?)/i)) {
          // Save previous Q&A pair if exists
          if (currentQuestion && currentAnswer) {
            pairs.push({
              question: currentQuestion.trim(),
              answer: currentAnswer.trim(),
              category: 'general',
              confidence: 0.8
            });
          }
          
          currentQuestion = line.replace(/^(Q\d*[:\.]?|Question\d*[:\.]?|प्रश्न\d*[:\.]?|Pregunta\d*[:\.]?|Frage\d*[:\.]?)/i, '').trim();
          currentAnswer = '';
          isQuestion = true;
          isAnswer = false;
        }
        // Enhanced answer indicators (multilingual)
        else if (line.match(/^(A\d*[:\.]?|Answer\d*[:\.]?|उत्तर\d*[:\.]?|Respuesta\d*[:\.]?|Réponse\d*[:\.]?|Antwort\d*[:\.]?)/i)) {
          currentAnswer = line.replace(/^(A\d*[:\.]?|Answer\d*[:\.]?|उत्तर\d*[:\.]?|Respuesta\d*[:\.]?|Réponse\d*[:\.]?|Antwort\d*[:\.]?)/i, '').trim();
          isQuestion = false;
          isAnswer = true;
        }
        // Continue building question or answer
        else if (line.length > 3) {
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
    
    // Strategy 3: Smart paragraph-based extraction
    if (pairs.length === 0) {
      const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 20);
      
      for (let i = 0; i < paragraphs.length - 1; i++) {
        const para1 = paragraphs[i].trim();
        const para2 = paragraphs[i + 1].trim();
        
        // Check if first paragraph looks like a question
        if (para1.includes('?') || 
            para1.match(/^(what|how|when|where|why|which|who|can|could|would|should|is|are|do|does|did)/i) ||
            para1.match(/^(क्या|कैसे|कब|कहाँ|क्यों|कौन)/i) || // Hindi question words
            para1.match(/^(qué|cómo|cuándo|dónde|por qué|quién)/i) || // Spanish question words
            para1.match(/^(was|wie|wann|wo|warum|wer)/i)) { // German question words
          
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
    
    console.log(`📊 Extracted ${pairs.length} Q&A pairs from ${fileType.toUpperCase()} using multiple strategies`);
    
    // Return both Q&A pairs AND full text for chatbot flexibility
    return {
      pairs: pairs.length > 0 ? pairs : [{
        question: `${fileType.toUpperCase()} Processing Notice`,
        answer: `${fileType.toUpperCase()} was processed but no clear Q&A patterns were found. The document contains ${text.length} characters of text but in a format that doesn't match standard Q&A patterns. Please ensure your document has clear Q&A formatting or try a different format.`,
        category: 'info',
        confidence: 0.0
      }],
      fullText: text // Store complete text for chatbot fallback
    };
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
