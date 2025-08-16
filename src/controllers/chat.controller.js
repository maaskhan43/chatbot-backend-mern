const Client = require('../models/Client');
const ClientQA = require('../models/ClientQA');
const ChatHistory = require('../models/ChatHistory');
const GeminiService = require('../services/gemini.service');
const { cosineSimilarity } = require('../utils/vector.util');
const mongoose = require('mongoose');

class ChatController {
  constructor() {
    this.getPriorityQuestions = this.getPriorityQuestions.bind(this);
    this.semanticSearch = this.semanticSearch.bind(this);
    this.handleSuggestionClick = this.handleSuggestionClick.bind(this);
    this.saveChatInteraction = this.saveChatInteraction.bind(this);
    this.getChatHistory = this.getChatHistory.bind(this);
    this.getChatSessions = this.getChatSessions.bind(this);
    this.deleteChatHistory = this.deleteChatHistory.bind(this);
    this.handleWidgetRequest = this.handleWidgetRequest.bind(this);
    
    // Initialize Gemini service (it's exported as a singleton)
    this.geminiService = GeminiService;
    
    // Define restricted question patterns
    this.restrictedPatterns = [
      /write.*code|code.*for|programming|javascript|python|html|css|sql/i,
      /calculate|math|mathematics|solve.*equation|what.*is.*\+|\*|\/|\-/i,
      /weather|time|date|current.*time|what.*time/i,
      /translate|translation|convert.*language/i,
      /recipe|cooking|how.*to.*cook|ingredients/i,
      /medical.*advice|health|symptoms|disease|medicine/i,
      /legal.*advice|law|lawsuit|attorney/i,
      /investment|stock|crypto|bitcoin|financial.*advice/i,
      /write.*essay|homework|assignment|thesis/i,
      /personal.*opinion|what.*do.*you.*think|your.*opinion/i
    ];
  }

  // Dynamic AI-powered greeting detection
  async isGreeting(query) {
    try {
      const greetingPrompt = `
Analyze if the following text is a greeting or casual conversation starter. Consider greetings in multiple languages including English, Hindi, Spanish, French, German, etc.

Text: "${query}"

Is this a greeting? Respond with only "YES" or "NO".

Examples of greetings:
- Hi, Hello, Hey, Good morning, Good evening
- How are you?, What's up?, How's it going?
- Namaste, Hola, Bonjour, Guten Tag
- Casual conversation starters

Response:`;

      const result = await this.geminiService.generateText(greetingPrompt);
      const isGreetingResponse = result.trim().toLowerCase();
      
      console.log(`[GREETING-AI] Query: "${query}" | AI Response: "${result}" | Is Greeting: ${isGreetingResponse === 'yes'}`);
      return isGreetingResponse === 'yes';
    } catch (error) {
      console.log(`[GREETING-AI] Error detecting greeting: ${error.message}`);
      // Fallback to simple pattern matching
      const simpleGreetingPattern = /^(hi|hello|hey|namaste|hola|bonjour|guten tag|good morning|good afternoon|good evening|how are you|what's up)$/i;
      return simpleGreetingPattern.test(query.trim());
    }
  }

  // Dynamic AI-powered greeting response generation
  async generateGreetingResponse(query, language = 'en', chatHistory = null) {
    try {
      // Get context from chat history if available
      let contextInfo = '';
      if (chatHistory && chatHistory.messages.length > 0) {
        const recentTopics = chatHistory.context.recentTopics.slice(0, 3);
        if (recentTopics.length > 0) {
          contextInfo = `\nRecent conversation topics: ${recentTopics.join(', ')}`;
        }
      }

      const greetingPrompt = `
Generate a friendly, professional greeting response for a knowledge base chatbot assistant. 

User's greeting: "${query}"
User's language: ${language}
${contextInfo}

Guidelines:
1. Respond in the same language as the user
2. Be warm and welcoming
3. Briefly mention that you can help with questions from the knowledge base
4. If there are recent topics, you can subtly reference continuing the conversation
5. Keep it concise (1-2 sentences)
6. Sound natural and conversational

Generate a greeting response:`;

      const response = await this.geminiService.generateText(greetingPrompt);
      
      if (response) {
        console.log(`[GREETING-AI] Generated response in ${language}: ${response.substring(0, 100)}...`);
        return response.trim();
      } else {
        console.log(`[GREETING-AI] No response from Gemini, using fallback`);
        // Use fallback responses when Gemini fails
        const fallbackResponses = {
          'hi': 'नमस्ते! मैं आपके ज्ञान आधार से प्रश्नों में मदद करने के लिए यहाँ हूँ। आज मैं आपकी कैसे सहायता कर सकता हूँ?',
          'es': '¡Hola! Estoy aquí para ayudarte con preguntas de nuestra base de conocimientos. ¿En qué puedo asistirte hoy?',
          'fr': 'Bonjour! Je suis là pour vous aider avec des questions de notre base de connaissances. Comment puis-je vous aider aujourd\'hui?',
          'de': 'Hallo! Ich bin hier, um Ihnen bei Fragen aus unserer Wissensdatenbank zu helfen. Wie kann ich Ihnen heute helfen?',
          'en': 'Hello! I\'m here to help you with questions from our knowledge base. How can I assist you today?'
        };
        return fallbackResponses[language] || fallbackResponses['en'];
      }
    } catch (error) {
      console.log(`[GREETING-AI] Error generating greeting: ${error.message}`);
      // Fallback responses based on language
      const fallbackResponses = {
        'hi': 'नमस्ते! मैं आपके ज्ञान आधार से प्रश्नों में मदद करने के लिए यहाँ हूँ। आज मैं आपकी कैसे सहायता कर सकता हूँ?',
        'es': '¡Hola! Estoy aquí para ayudarte con preguntas de nuestra base de conocimientos. ¿En qué puedo asistirte hoy?',
        'fr': 'Bonjour! Je suis là pour vous aider avec des questions de notre base de connaissances. Comment puis-je vous aider aujourd\'hui?',
        'de': 'Hallo! Ich bin hier, um Ihnen bei Fragen aus unserer Wissensdatenbank zu helfen. Wie kann ich Ihnen heute helfen?',
        'en': 'Hello! I\'m here to help you with questions from our knowledge base. How can I assist you today?'
      };
      return fallbackResponses[language] || fallbackResponses['en'];
    }
  }

  // Check if query is restricted (general question)
  isRestrictedQuery(query) {
    return this.restrictedPatterns.some(pattern => pattern.test(query));
  }

  // Enhanced contact intent detection with type classification
  async detectContactIntentWithType(query) {
    if (!query) return { isContact: false, type: null };
    
    try {
      const contactIntentPrompt = `
Analyze the user query and determine:
1. Is it asking for contact information?
2. What specific type of contact info?

Query: "${query}"

Classify into one of these categories:
- email: asking for email address, mail id, email contact
- phone: asking for phone number, contact number, mobile number
- general: asking for general contact info (could be either)
- none: not asking for contact information

Examples:
- "give me contact" → general
- "phone number" → phone  
- "email address" → email
- "mail id" → email
- "contact number" → phone
- "how to contact" → general

Respond with only: email|phone|general|none

Response:`;

      const result = await this.geminiService.generateText(contactIntentPrompt);
      const contactType = result.trim().toLowerCase();
      
      const isContact = ['email', 'phone', 'general'].includes(contactType);
      console.log(`[CONTACT-AI] Query: "${query}" | Type: "${contactType}" | Is Contact: ${isContact}`);
      
      return { isContact, type: contactType };
    } catch (error) {
      console.log(`[CONTACT-AI] Error detecting contact intent: ${error.message}`);
      // Fallback logic
      const q = query.toLowerCase();
      if (q.includes('phone') || q.includes('number') || q.includes('mobile')) {
        return { isContact: true, type: 'phone' };
      } else if (q.includes('email') || q.includes('mail')) {
        return { isContact: true, type: 'email' };
      } else if (q.includes('contact')) {
        return { isContact: true, type: 'general' };
      }
      return { isContact: false, type: null };
    }
  }

  // Search for contact information in Q&A data
  async findContactInQA(clientId, contactType) {
    try {
      const qaData = await ClientQA.find({ clientId, status: 'completed' });
      const allPairs = qaData.flatMap(doc => doc.pairs);
      
      // Search patterns based on contact type
      let searchPatterns = [];
      if (contactType === 'phone') {
        searchPatterns = [
          /phone.*number|contact.*number|mobile.*number|call.*us|phone.*contact/i,
          /\+?\d{1,4}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/
        ];
      } else if (contactType === 'email') {
        searchPatterns = [
          /email.*address|contact.*email|mail.*id|e-mail/i,
          /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
        ];
      } else {
        // General contact - search for both
        searchPatterns = [
          /contact|phone|email|reach.*us|get.*in.*touch/i,
          /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
          /\+?\d{1,4}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/
        ];
      }
      
      // Find matching Q&A pairs
      for (const pair of allPairs) {
        const question = pair.question.toLowerCase();
        const answer = pair.answer;
        
        // Check if question matches contact patterns
        const questionMatches = searchPatterns.some(pattern => pattern.test(question));
        
        if (questionMatches) {
          console.log(`[CONTACT-QA] Found contact Q&A: "${pair.question}"`);
          return {
            found: true,
            question: pair.question,
            answer: pair.answer,
            type: contactType
          };
        }
      }
      
      return { found: false, type: contactType };
    } catch (error) {
      console.error('[CONTACT-QA] Error searching Q&A:', error);
      return { found: false, type: contactType };
    }
  }

  // Detect contact email intent (multilingual) - AI-powered
  async detectContactIntent(query) {
    if (!query) return false;
    
    try {
      const contactIntentPrompt = `
Analyze if the following user query is asking for contact information (email, phone, address, how to reach/contact).

Query: "${query}"

Consider queries in multiple languages (English, Hindi, Spanish, French, German, etc.) that might be asking for:
- Email address or contact email
- Phone number or contact number  
- Physical address or location
- General contact information
- How to reach/contact someone
- Ways to get in touch

Examples of contact queries:
- "give me contact", "contact info", "how to contact"
- "email address", "phone number", "mail id"
- "संपर्क", "ईमेल", "नंबर" (Hindi)
- "contacto", "correo" (Spanish)
- "contact", "courriel" (French)
- "kontakt" (German)

Is this asking for contact information? Respond with only "YES" or "NO".

Response:`;

      const result = await this.geminiService.generateText(contactIntentPrompt);
      const isContactIntent = result.trim().toLowerCase() === 'yes';
      
      console.log(`[CONTACT-AI] Query: "${query}" | AI Response: "${result}" | Is Contact Intent: ${isContactIntent}`);
      return isContactIntent;
    } catch (error) {
      console.log(`[CONTACT-AI] Error detecting contact intent: ${error.message}`);
      // Fallback to simple pattern matching
      const q = query.toLowerCase();
      const basicPatterns = [
        /\b(contact|email|phone|mail|reach)\b/i
      ];
      return basicPatterns.some(p => p.test(q));
    }
  }

  // LLM-based intent classification for short/ambiguous queries
  async classifyIntent(query) {
    try {
      const prompt = `Classify the user's intent into EXACTLY one of the following labels:
contact_email | contact_phone | website | pricing | appointment | other

Rules:
- Output ONLY the label, nothing else.
- Consider multilingual input (English, Hindi, Spanish, French, German, Hinglish).
- Examples:
  - "email", "mail id", "ईमेल", "correo" -> contact_email
  - "phone number", "contact number", "नंबर" -> contact_phone
  - "website", "site", "वेबसाइट" -> website
  - "price", "pricing", "cost", "किंमत", "precio" -> pricing
  - "book appointment", "schedule a call" -> appointment
  - otherwise -> other

User query: "${query}"

Label:`;

      const raw = await this.geminiService.generateText(prompt);
      const label = (raw || '').trim().toLowerCase();
      const allowed = new Set(['contact_email', 'contact_phone', 'website', 'pricing', 'appointment', 'other']);
      const cleaned = label.replace(/[^a-z_]/g, '');
      return allowed.has(cleaned) ? cleaned : 'other';
    } catch (e) {
      console.log('[INTENT] classifyIntent failed, defaulting to other:', e.message);
      return 'other';
    }
  }

  // Check if query is a direct question match from knowledge base (skip refinement)
  async isDirectQuestionMatch(query, clientId) {
    try {
      const qaDocuments = await ClientQA.find({ clientId });
      
      for (const doc of qaDocuments) {
        for (const qaPair of doc.pairs) {
          // Check for exact or very close match (case-insensitive)
          const questionLower = qaPair.question.toLowerCase().trim();
          const queryLower = query.toLowerCase().trim();
          
          if (questionLower === queryLower || 
              questionLower.includes(queryLower) || 
              queryLower.includes(questionLower)) {
            console.log(`[DIRECT-MATCH] Found direct question match: "${qaPair.question}"`);
            return true;
          }
        }
      }
      return false;
    } catch (error) {
      console.error('Error checking direct question match:', error);
      return false; // Fallback to normal processing
    }
  }

  // Filter WH-words and helping verbs
  filterKeywords(query) {
    const whWords = new Set(['who', 'what', 'when', 'where', 'why', 'how', 'which', 'whom', 'whose']);
    const helpingVerbs = new Set(['is', 'am', 'are', 'was', 'were', 'be', 'being', 'been', 'do', 'does', 'did', 'has', 'have', 'had', 'may', 'might', 'must', 'can', 'could', 'shall', 'should', 'will', 'would']);

    const words = query.toLowerCase().split(/\s+/);
    const filteredWords = words.filter(word => !whWords.has(word) && !helpingVerbs.has(word));
    
    const filteredQuery = filteredWords.join(' ');
    console.log(`[FILTER] Original for filtering: '${query}' | Filtered: '${filteredQuery}'`);
    return filteredQuery;
  }

  // Detect query language using Gemini (more accurate than hardcoded patterns)
  async detectLanguage(query) {
    return await this.geminiService.detectLanguage(query);
  }

  // Enhanced match evaluation with multiple confidence tiers
  evaluateMatchConfidence(score) {
    if (score > 0.7) {
      return {
        level: 'high',
        description: 'High confidence match',
        shouldReturnAnswer: true,
        includeConfidenceNote: false
      };
    } else {
      return {
        level: 'low',
        description: 'Low confidence match',
        shouldReturnAnswer: false,
        includeConfidenceNote: false
      };
    }
  }

  // Format suggestions with enhanced metadata and translation
  async formatSuggestions(matches, originalQuery, userLanguage = 'en') {
    const suggestions = [];
    
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      let translatedQuestion = match.question;
      
      // Translate suggestion if user language is not English
      if (userLanguage !== 'en') {
        try {
          translatedQuestion = await this.geminiService.translateResponse(match.question, userLanguage);
          console.log(`[SUGGESTION-TRANSLATE] ${userLanguage}: "${match.question}" → "${translatedQuestion}"`);
        } catch (error) {
          console.error('Error translating suggestion:', error);
          // Keep original question if translation fails
        }
      }
      
      suggestions.push({
        id: `suggestion_${i + 1}`,
        question: translatedQuestion,
        originalQuestion: match.question, // Keep original for backend processing
        score: parseFloat(match.score.toFixed(4)),
        relevanceReason: this.generateRelevanceReason(match.score)
      });
    }
    
    return suggestions;
  }

  // Generate relevance reason based on score
  generateRelevanceReason(score) {
    if (score >= 0.50) return 'Closely related topic';
    if (score >= 0.40) return 'Somewhat related';
    return 'Potentially relevant';
  }

  async getPriorityQuestions(req, res) {
    try {
      const { clientId } = req.params;
      const limit = parseInt(req.query.limit) || 3;

      if (!clientId) {
        return res.status(400).json({
          success: false,
          message: 'Client ID is required'
        });
      }

      // Dynamic LLM-based intent classification for short queries
      const tokenCount = query.trim().split(/\s+/).filter(Boolean).length;
      if (tokenCount <= 4) {
        const intent = await this.classifyIntent(query);
        if (intent === 'contact_email') {
          console.log('[INTENT] LLM classified as contact_email. Searching for contact information in Q&A data.');
          const detectedLanguage = await this.geminiService.detectLanguage(query);
          const contactInfo = await this.findContactInQA(clientId, 'email');
          if (contactInfo.found) {
            const answer = contactInfo.answer;
            const translated = await this.geminiService.translateResponse(answer, detectedLanguage);
            await this.saveChatInteraction(chatHistory, query, query, translated, 'high', 1.0, detectedLanguage, 'contact_email');
            return res.json({
              answer: translated,
              score: 1.0,
              confidence: 'high',
              type: 'contact_email',
              language: detectedLanguage
            });
          } else {
            return res.json({
              answer: "I'm sorry, I couldn't find any contact information in our knowledge base.",
              score: 0,
              type: 'no_data'
            });
          }
        }
      }

      const client = await Client.findById(clientId);
      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      const qaDocs = await ClientQA.find({ clientId: clientId, status: 'completed' });
      let allPairs = [];
      qaDocs.forEach(doc => {
        allPairs = allPairs.concat(doc.pairs);
      });

      const priorityQuestions = allPairs
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, limit)
        .map(p => ({ question: p.question, confidence: p.confidence }));

      res.status(200).json({ success: true, priorityQuestions });

    } catch (error) {
      console.error('Error getting priority questions:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  async semanticSearch(req, res) {
    const { query, clientId, sessionId } = req.body;

    if (!query || !clientId || !sessionId) {
      return res.status(400).json({ message: 'Query, Client ID, and Session ID are required.' });
    }

    console.log('\n--- New Semantic Search Request ---');
    console.log(`[1] Received Query: '${query}' for Client ID: '${clientId}' and Session ID: '${sessionId}'`);

    try {
      // Get or create chat history for session first (needed for greeting context)
      const chatHistory = await this.getOrCreateChatHistory(clientId, sessionId);

      // Check for greeting first with AI-powered detection
      if (await this.isGreeting(query)) {
        console.log('[GREETING] Detected greeting message, generating dynamic AI-powered response.');
        
        // Detect language for contextual greeting
        const detectedLanguage = await this.geminiService.detectLanguage(query);
        
        // Generate contextual greeting response
        const greetingResponse = await this.generateGreetingResponse(query, detectedLanguage, chatHistory);
        
        // Save greeting interaction to history
        await this.saveChatInteraction(
          chatHistory, 
          query, 
          query, 
          greetingResponse, 
          'high', 
          1.0, 
          detectedLanguage, 
          'greeting'
        );

        return res.json({ 
          answer: greetingResponse, 
          score: 1.0,
          confidence: 'high',
          type: 'greeting',
          language: detectedLanguage
        });
      }

      // Check for restricted queries
      if (this.isRestrictedQuery(query)) {
        console.log('[RESTRICTION] Detected restricted/general query, blocking response.');
        return res.json({ 
          answer: "I'm sorry, but I can only help with questions related to our knowledge base. I cannot assist with general questions like coding, math calculations, or other topics outside my scope. Please ask me something related to the information in our uploaded documents.", 
          score: 0,
          type: 'restricted'
        });
      }

      // Shortcut: contact email intent
      const contactIntent = await this.detectContactIntentWithType(query);
      if (contactIntent.isContact) {
        console.log('[INTENT] Detected contact intent. Searching for contact information in Q&A data.');
        const detectedLanguage = await this.geminiService.detectLanguage(query);
        const contactInfo = await this.findContactInQA(clientId, contactIntent.type);
        if (contactInfo.found) {
          const answer = contactInfo.answer;
          const translated = await this.geminiService.translateResponse(answer, detectedLanguage);
          await this.saveChatInteraction(chatHistory, query, query, translated, 'high', 1.0, detectedLanguage, contactIntent.type);
          return res.json({
            answer: translated,
            score: 1.0,
            confidence: 'high',
            type: contactIntent.type,
            language: detectedLanguage
          });
        } else {
          return res.json({
            answer: "I'm sorry, I couldn't find any contact information in our knowledge base.",
            score: 0,
            type: 'no_data'
          });
        }
      }

      // Check if this is a direct question match (from suggestions) - skip refinement
      const isDirectQuestionMatch = await this.isDirectQuestionMatch(query, clientId);
      
      let refinedQuery = query;
      let filteredKeywords = '';
      
      if (!isDirectQuestionMatch) {
        // Build context-aware query using chat history
        const contextAwareQuery = await this.buildContextAwareQuery(query, chatHistory);

        // --- Query Refinement and Filtering ---
        console.log('[PRE-PROCESSING] Starting query refinement and filtering...');
        // 1. Refine the context-aware query with Gemini for semantic richness
        refinedQuery = await this.geminiService.refineQuery(contextAwareQuery);

        // 2. Filter keywords for logging or future hybrid search (vector search will use the full refined query)
        filteredKeywords = this.filterKeywords(refinedQuery);
        console.log(`[PRE-PROCESSING] Using refined query for vector search: '${refinedQuery}'`);
      } else {
        console.log('[PRE-PROCESSING] Direct question match detected, skipping refinement');
        filteredKeywords = this.filterKeywords(query);
      }

      // Detect query language using Gemini (more accurate than hardcoded patterns)
      const originalLanguage = await this.geminiService.detectLanguage(query);
      console.log(`[LANGUAGE] Detected language: ${originalLanguage}`);

      // Set similarity threshold (only return answers when score >= 0.7)
      const baseSimilarityThreshold = 0.7;
      console.log(`[i] Using base similarity threshold: ${baseSimilarityThreshold}`);

      // Generate embedding for the refined query
      const queryEmbedding = await this.geminiService.generateEmbedding(refinedQuery);
      if (!queryEmbedding) {
        return res.status(500).json({ message: 'Failed to generate query embedding.' });
      }
      console.log('[2] Successfully generated query embedding.');

      // Retrieve Q&A data for this client
      const clientQAData = await ClientQA.find({ clientId: clientId, status: 'completed' });
      const allPairs = clientQAData.flatMap(doc => doc.pairs.filter(p => p.embedding && p.embedding.length > 0));

      console.log(`[3] Found ${clientQAData.length} Q&A documents with a total of ${allPairs.length} Q&A pairs for this client.`);

      if (allPairs.length === 0) {
        return res.json({ 
          answer: "I'm sorry, but there are no Q&A pairs available for this client. Please upload some Q&A data first.", 
          score: 0,
          type: 'no_data'
        });
      }

      // Perform vector similarity search
      const comparisons = allPairs.map(pair => ({
        question: pair.question,
        answer: pair.answer,
        score: cosineSimilarity(queryEmbedding, pair.embedding)
      }));

      // Sort by similarity score (descending)
      comparisons.sort((a, b) => b.score - a.score);
      const topMatches = comparisons.slice(0, 5);

      console.log(`[4] Performed ${allPairs.length} vector comparisons.`);
      console.log('[5] Top 5 matches found:');
      topMatches.forEach((match, index) => {
        console.log(`  ${index + 1}. Score: ${match.score.toFixed(4)} | Question: ${match.question}`);
      });

      let bestMatch = topMatches[0];
      const matchEvaluation = this.evaluateMatchConfidence(bestMatch ? bestMatch.score : 0);
      console.log(`[EVALUATION] Match confidence: ${matchEvaluation.level} (${matchEvaluation.description || 'Confidence evaluation'})`);

      if (bestMatch && bestMatch.score >= baseSimilarityThreshold) {
        console.log(`[6] ${matchEvaluation.level} confidence match. Checking for answer synthesis.`);
        
        // Check if multiple relevant answers should be combined
        const relevantMatches = topMatches.filter(match => match.score >= 0.6).slice(0, 3);
        
        // Intelligent query analysis - understand specific intent
        let shouldSynthesize = false;
        let specificMatch = null;
        
        if (relevantMatches.length > 1) {
          try {
            const intentAnalysisPrompt = `
Analyze if the user wants SPECIFIC information or GENERAL information.

Query: "${query}"

Available answers:
${relevantMatches.map((match, index) => `${index + 1}. ${match.answer.substring(0, 80)}...`).join('\n')}

Rules:
- If asking for specific plan/price (like "$299 plan", "starter plan", "between $50-$499"), return "SPECIFIC:X" (X = best match number)
- If asking for general overview ("what services", "all plans", "what do you offer"), return "GENERAL"

Response format: SPECIFIC:1 or GENERAL

Analysis:`;

            const intentResult = await this.geminiService.generateText(intentAnalysisPrompt);
            const intentMatch = intentResult.trim().match(/^(SPECIFIC|GENERAL)(?::(\d+))?/);
            
            if (intentMatch) {
              const intentType = intentMatch[1];
              const specificIndex = intentMatch[2] ? parseInt(intentMatch[2]) - 1 : 0;
              
              console.log(`[INTENT-ANALYSIS] Query intent: ${intentType}${intentMatch[2] ? `, specific match: ${intentMatch[2]}` : ''}`);
              
              if (intentType === 'SPECIFIC' && relevantMatches[specificIndex]) {
                specificMatch = relevantMatches[specificIndex];
                console.log(`[SPECIFIC-MATCH] Using specific answer instead of synthesis`);
              } else if (intentType === 'GENERAL') {
                shouldSynthesize = true;
                console.log(`[SYNTHESIS] Will combine answers for general query`);
              }
            }
          } catch (analysisError) {
            console.log(`[INTENT-ANALYSIS] Error: ${analysisError.message}, using single answer`);
          }
        }
        
        // Use specific match if identified
        if (specificMatch) {
          bestMatch = specificMatch; // Override bestMatch with specific match
        }
        
        // Synthesize answers for general queries only
        if (shouldSynthesize && !specificMatch) {
          console.log(`[SYNTHESIS] Found ${relevantMatches.length} relevant matches. Combining answers.`);
          
          try {
            const synthesisPrompt = `
Combine the following relevant answers into one comprehensive, coherent response for the user's question.

User Question: "${query}"

Relevant Answers:
${relevantMatches.map((match, index) => `${index + 1}. ${match.answer}`).join('\n')}

Instructions:
1. Merge all relevant information into one complete answer
2. Remove duplicate information
3. Keep the response concise and direct
4. Maintain all important details
5. Use simple, clear language
6. No asterisks, bullet points, or formatting symbols
7. Present as one flowing answer

Combined Answer:`;

            const synthesizedAnswer = await this.geminiService.generateText(synthesisPrompt);
            
            if (synthesizedAnswer && synthesizedAnswer.trim().length > 0) {
              // Clean the synthesized answer
              let finalAnswer = synthesizedAnswer.trim()
                .replace(/\*+/g, '') // Remove asterisks
                .replace(/•/g, '') // Remove bullet points
                .replace(/\*\*/g, '') // Remove bold formatting
                .replace(/#+/g, '') // Remove headers
                .replace(/\s+/g, ' ') // Replace multiple spaces with single space
                .trim();

              console.log(`[SYNTHESIS] Successfully combined ${relevantMatches.length} answers`);

              // Translate response if needed
              const translatedAnswer = await this.geminiService.translateResponse(finalAnswer, originalLanguage);

              // Save interaction to history
              await this.saveChatInteraction(
                chatHistory, 
                query, 
                refinedQuery, 
                translatedAnswer, 
                'high', 
                bestMatch.score, 
                originalLanguage, 
                'synthesized_answer'
              );

              return res.json({
                answer: translatedAnswer,
                score: bestMatch.score,
                confidence: 'high',
                type: 'synthesized_answer',
                language: originalLanguage,
                sourceCount: relevantMatches.length
              });
            }
          } catch (synthesisError) {
            console.log(`[SYNTHESIS] Error combining answers: ${synthesisError.message}, using single answer`);
          }
        }
        
        // Process single answer (either specific match or fallback)
        console.log(`[6] Using single answer processing.`);
        
        let rawAnswer = bestMatch.answer;
        
        // Regex to detect and remove prefixes like "Q1:", "Q91:", "Question:" etc.
        const questionPrefixRegex = /^(Q\d+:|Question:)\s*/i;
        const cleanedAnswer = rawAnswer.replace(questionPrefixRegex, '').trim();
        
        // Remove asterisks and formatting symbols from stored answers
        let finalCleanedAnswer = cleanedAnswer
          .replace(/\*+/g, '') // Remove all asterisks
          .replace(/•/g, '') // Remove bullet points
          .replace(/\*\*/g, '') // Remove bold formatting
          .replace(/#+/g, '') // Remove headers
          .replace(/\s+/g, ' ') // Replace multiple spaces with single space
          .trim();
        
        let finalAnswer = finalCleanedAnswer;

        // Apply dynamic answer template
        try {
          finalAnswer = await this.applyDynamicTemplate(query, finalAnswer);
        } catch (templateError) {
          console.log(`[TEMPLATE] Error applying template: ${templateError.message}`);
        }

        // Smart answer extraction - make answers direct and concise
        try {
          const extractionPrompt = `
Extract the most direct and concise answer from the following Q&A response. Remove unnecessary theory, explanations, or fluff.

User asked: "${query}"
Full response: "${cleanedAnswer}"

Rules:
1. Give ONLY the essential information the user needs
2. Remove marketing language, unnecessary details, theory
3. For contact info: just give email/phone directly
4. For pricing: just state the price and key features
5. For services: list main services only
6. Keep it concise (1-2 sentences)
7. Be direct and helpful

Direct answer:`;

          const directAnswer = await this.geminiService.generateText(extractionPrompt);
          if (directAnswer && directAnswer.trim().length > 0 && directAnswer.trim().length < cleanedAnswer.length) {
            finalAnswer = directAnswer.trim();
            console.log(`[EXTRACT] Made answer more direct: ${cleanedAnswer.length} → ${finalAnswer.length} chars`);
          }
        } catch (extractError) {
          console.log(`[EXTRACT] Error extracting direct answer: ${extractError.message}`);
          // Use cleaned answer as fallback
        }
        
        // --- End of Processing ---
        
        // Translate response if needed
        const translatedAnswer = await this.geminiService.translateResponse(finalAnswer, originalLanguage);

        // Generate smart follow-up questions (top 3 only)
        let followUpQuestions = [];
        try {
          followUpQuestions = await this.generateFollowUpQuestions(query, finalAnswer);
        } catch (followUpError) {
          console.log(`[FOLLOW-UP] Error generating follow-up questions: ${followUpError.message}`);
        }

        // Check answer completeness
        let completenessScore = 1.0;
        let enrichedAnswer = translatedAnswer;
        try {
          completenessScore = await this.checkAnswerCompleteness(query, finalAnswer);
          // If completeness is low, try to enrich the answer
          if (completenessScore < 0.8) {
            const newEnrichedAnswer = await this.enrichAnswer(query, finalAnswer);
            if (newEnrichedAnswer) {
              enrichedAnswer = newEnrichedAnswer;
            }
          }
        } catch (completenessError) {
          console.log(`[COMPLETENESS] Error checking completeness: ${completenessError.message}`);
        }

        // Save interaction to history
        await this.saveChatInteraction(
          chatHistory, 
          query, 
          refinedQuery, 
          enrichedAnswer, 
          matchEvaluation.level, 
          bestMatch.score, 
          originalLanguage, 
          bestMatch.question
        );

        return res.json({
          answer: enrichedAnswer,
          score: bestMatch.score,
          confidence: matchEvaluation.level,
          type: 'answer',
          language: originalLanguage,
          matchedQuestion: bestMatch.question,
          completenessScore: completenessScore,
          followUpQuestions: followUpQuestions.length > 0 ? followUpQuestions : undefined
        });

      } else {
        // Low confidence or no match, return suggestions
        console.log('[6] Low confidence match or no match found. Returning suggestions.');

        const suggestions = await this.formatSuggestions(topMatches, query, originalLanguage);

        // Save interaction to history
        await this.saveChatInteraction(chatHistory, query, refinedQuery, 'suggestions_provided', 'low', bestMatch ? bestMatch.score : 0, originalLanguage, null);

        // Translate the "no answer found" message to user's language
        let noAnswerMessage = "I couldn't find a direct answer to your question, but here are some related topics that might help:";
        if (originalLanguage !== 'en') {
          try {
            noAnswerMessage = await this.geminiService.translateResponse(noAnswerMessage, originalLanguage);
          } catch (error) {
            console.error('Error translating no-answer message:', error);
          }
        }

        return res.json({
          answer: noAnswerMessage,
          suggestions: suggestions,
          score: bestMatch ? bestMatch.score : 0,
          confidence: 'low',
          type: 'suggestions',
          language: originalLanguage,
          metadata: {
            originalQuery: query,
            refinedQuery: refinedQuery,
            filteredKeywords: filteredKeywords
          }
        });
      }

    } catch (error) {
      console.error('Error during semantic search:', error);
      res.status(500).json({ message: 'An error occurred during the search.' });
    }
    console.log('--- Search Request Finished ---\n');
  }

  // Handle suggestion click with Gemini AI enhancement
  async handleSuggestionClick(req, res) {
    const { originalQuestion, userLanguage = 'en', clientId, sessionId } = req.body;

    try {
      console.log(`[SUGGESTION-CLICK] Processing for client: ${clientId}, question: "${originalQuestion}"`);
      
      if (!originalQuestion || !clientId) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: originalQuestion and clientId'
        });
      }

      // Verify client exists
      const client = await Client.findById(clientId);
      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      // Get Q&A data for the client
      const qaData = await ClientQA.find({ clientId }).select('pairs');
      
      if (!qaData || qaData.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No Q&A data found for this client'
        });
      }

      // Find the matching answer
      let bestMatch = null;
      let bestScore = 0;

      for (const qa of qaData) {
        for (const pair of qa.pairs) {
          // Check for exact match first
          if (pair.question && pair.question.toLowerCase().trim() === originalQuestion.toLowerCase().trim()) {
            bestMatch = pair;
            bestScore = 1.0;
            break;
          }
          
          // Simple text similarity as fallback
          if (pair.question) {
            const words1 = originalQuestion.toLowerCase().split(' ');
            const words2 = pair.question.toLowerCase().split(' ');
            const commonWords = words1.filter(word => words2.includes(word));
            const similarity = commonWords.length / Math.max(words1.length, words2.length);
            
            if (similarity > bestScore) {
              bestMatch = pair;
              bestScore = similarity;
            }
          }
        }
        if (bestScore === 1.0) break; // Exit outer loop if exact match found
      }

      if (!bestMatch || bestScore < 0.3) {
        return res.status(404).json({
          success: false,
          message: 'No matching answer found for the selected question'
        });
      }

      // Return clean answer without enhancement
      let enhancedAnswer = bestMatch.answer;
      
      // Remove formatting symbols from the answer
      enhancedAnswer = enhancedAnswer
        .replace(/\*+/g, '') // Remove asterisks
        .replace(/•/g, '') // Remove bullet points
        .replace(/\*\*/g, '') // Remove bold formatting
        .replace(/#+/g, '') // Remove headers
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .trim();
      
      console.log(`[CLEAN-ANSWER] Cleaned formatting from suggestion answer`);
      
      // Save interaction to chat history if session provided
      if (sessionId) {
        try {
          const chatHistory = await this.getOrCreateChatHistory(clientId, sessionId);
          await this.saveChatInteraction(
            chatHistory, 
            originalQuestion, 
            originalQuestion, 
            enhancedAnswer, 
            bestScore >= 0.8 ? 'high' : bestScore >= 0.5 ? 'medium' : 'low',
            bestScore,
            userLanguage,
            bestMatch.question
          );
        } catch (historyError) {
          console.log(`[HISTORY] Failed to save interaction: ${historyError.message}`);
        }
      }

      res.json({
        success: true,
        answer: enhancedAnswer,
        score: bestScore,
        confidence: bestScore >= 0.8 ? 'high' : bestScore >= 0.5 ? 'medium' : 'low',
        type: 'suggestion_click',
        matchedQuestion: bestMatch.question,
        language: userLanguage,
        enhanced: false
      });

    } catch (error) {
      console.error('[SUGGESTION-CLICK] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process suggestion click'
      });
    }
  }

  // Handle widget chat requests
  async handleWidgetRequest(req, res) {
    try {
      const { clientId, query, sessionId } = req.body;

      if (!clientId || !query) {
        return res.status(400).json({
          success: false,
          message: 'Client ID and query are required'
        });
      }

      // Create a mock request object for semanticSearch
      const mockReq = {
        body: { query, clientId, sessionId }
      };

      // Create a mock response object to capture the result
      let semanticResult = null;
      const mockRes = {
        json: (data) => {
          semanticResult = data;
          return mockRes;
        },
        status: (code) => mockRes
      };

      // Call the same semanticSearch logic used by admin panel
      await this.semanticSearch(mockReq, mockRes);

      if (semanticResult) {
        // Extract follow-up questions if they exist
        const followUpQuestions = semanticResult.followUpQuestions || [];
        const completenessScore = semanticResult.completenessScore || 100;
        const suggestions = semanticResult.suggestions || [];

        return res.json({
          success: true,
          response: semanticResult.answer,
          suggestions: suggestions,
          followUpQuestions: followUpQuestions,
          completenessScore: completenessScore
        });
      } else {
        return res.status(500).json({
          success: false,
          message: 'Failed to process request'
        });
      }

    } catch (error) {
      console.error('Widget request error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get or create chat history for session
  async getOrCreateChatHistory(clientId, sessionId, userId = 'anonymous') {
    let chatHistory = await ChatHistory.findOne({ clientId, sessionId });
    
    if (!chatHistory) {
      chatHistory = new ChatHistory({
        clientId,
        sessionId,
        userId,
        messages: [],
        context: {
          recentTopics: [],
          userPreferences: { language: 'en', responseStyle: 'standard' },
          frequentQueries: []
        },
        metadata: {
          totalQueries: 0,
          avgConfidence: 0,
          lastActive: new Date()
        }
      });
      await chatHistory.save();
      console.log(`[HISTORY] Created new chat history for session: ${sessionId}`);
    }
    
    return chatHistory;
  }

  // Build context-aware query using chat history
  async buildContextAwareQuery(originalQuery, chatHistory) {
    const recentContext = chatHistory.getRecentContext(3);
    
    if (recentContext.length === 0) {
      return originalQuery; // No context available
    }

    // Create context string from recent conversations
    const contextString = recentContext
      .map(msg => `Q: ${msg.query} A: ${msg.response.substring(0, 100)}...`)
      .join('\n');

    // Use Gemini to create context-aware query
    try {
      const contextPrompt = `
Based on this recent conversation context:
${contextString}

Current user query: "${originalQuery}"

Please enhance the current query by considering the conversation context. If the current query relates to previous topics, make it more specific. If it's a follow-up question, make the context clear. Return only the enhanced query, nothing else.

Enhanced query:`;

      const enhancedQuery = await this.geminiService.generateText(contextPrompt);
      
      if (enhancedQuery && enhancedQuery.trim() !== originalQuery.trim()) {
        // Validate that enhanced query is actually related to original query
        const originalWords = originalQuery.toLowerCase().split(/\s+/);
        const enhancedWords = enhancedQuery.toLowerCase().split(/\s+/);
        
        // Check if enhanced query has at least one significant word from original
        const hasCommonWords = originalWords.some(word => 
          word.length > 3 && enhancedWords.includes(word)
        );
        
        if (hasCommonWords) {
          console.log(`[CONTEXT] Original: "${originalQuery}" | Enhanced: "${enhancedQuery}"`);
          return enhancedQuery.trim();
        } else {
          console.log(`[CONTEXT] Enhanced query seems unrelated, using original: "${originalQuery}"`);
          return originalQuery;
        }
      }
    } catch (error) {
      console.error('Error building context-aware query:', error);
    }
    
    return originalQuery; // Fallback to original query
  }

  // Apply dynamic answer template using Gemini
  async applyDynamicTemplate(query, answer) {
    try {
      const templatePrompt = `
Identify the query type and format the answer using the appropriate template:

Query: "${query}"
Answer: "${answer}"

Templates:
- PRICING: "Price: $X. Features: A, B, C. Duration: Y."
- CONTACT: "Email: X. Phone: Y. Address: Z."
- FEATURES: "Main features: A, B, C. Benefits: X, Y, Z."
- SERVICES: "We offer: A, B, C."
- OTHER: Keep as-is

Apply the template if it matches, otherwise keep original. No formatting symbols.

Formatted Answer:`;

      const templateResult = await this.geminiService.generateText(templatePrompt);
      if (templateResult && templateResult.trim().length > 0) {
        const formattedAnswer = templateResult.trim()
          .replace(/\*+/g, '') // Remove asterisks
          .replace(/•/g, '') // Remove bullet points
          .replace(/\*\*/g, '') // Remove bold formatting
          .replace(/#+/g, '') // Remove headers
          .replace(/\s+/g, ' ') // Replace multiple spaces
          .trim();
        
        if (formattedAnswer.length > 0) {
          console.log(`[TEMPLATE] Applied dynamic answer template`);
          return formattedAnswer;
        }
      }
    } catch (templateError) {
      console.log(`[TEMPLATE] Error applying template: ${templateError.message}`);
    }
    return answer; // Return original answer on error or no-op
  }

  // Generate follow-up questions using Gemini
  async generateFollowUpQuestions(query, answer) {
    try {
      const followUpPrompt = `
Based on the user's question and the answer provided, suggest 3 relevant follow-up questions they might want to ask next.

User Question: "${query}"
Answer: "${answer}"

Generate 3 short, relevant follow-up questions that would naturally come next. Focus on:
- Related features or details
- Next steps or actions
- Comparisons or alternatives
- Pricing or availability (if relevant)

Format as simple questions, one per line:

Follow-up questions:`;

      const followUpResult = await this.geminiService.generateText(followUpPrompt);
      if (followUpResult) {
        const questions = followUpResult
          .split('\n')
          .filter(q => q.trim().length > 0)
          .slice(0, 3)
          .map(q => q.trim().replace(/^\d+\.\s*/, '').replace(/^-\s*/, ''));
        console.log(`[FOLLOW-UP] Generated ${questions.length} follow-up questions`);
        return questions;
      }
    } catch (followUpError) {
      console.log(`[FOLLOW-UP] Error generating follow-up questions: ${followUpError.message}`);
    }
    return []; // Return empty array on error
  }

  // Check answer completeness using Gemini
  async checkAnswerCompleteness(query, answer) {
    try {
      const completenessPrompt = `
Rate how completely this answer addresses the user's question on a scale of 0.0 to 1.0.

User Question: "${query}"
Answer: "${answer}"

Consider:
- Does it answer the main question?
- Are important details missing?
- Would a user need to ask follow-up questions for basic info?

Respond with only a number between 0.0 and 1.0:`;

      const completenessResult = await this.geminiService.generateText(completenessPrompt);
      const score = parseFloat(completenessResult.trim());
      if (!isNaN(score) && score >= 0 && score <= 1) {
        console.log(`[COMPLETENESS] Answer completeness score: ${score}`);
        return score;
      }
    } catch (completenessError) {
      console.log(`[COMPLETENESS] Error checking completeness: ${completenessError.message}`);
    }
    return 1.0; // Default to 1.0 on error
  }

  // Enrich answer using Gemini
  async enrichAnswer(query, currentAnswer) {
    try {
      const enrichmentPrompt = `
The following answer seems incomplete for the user's question. Add any missing essential information to make it more complete.

User Question: "${query}"
Current Answer: "${currentAnswer}"

Add only the most important missing information. Keep it concise and direct. No formatting symbols.

Enhanced Answer:`;

      const enrichedResult = await this.geminiService.generateText(enrichmentPrompt);
      if (enrichedResult && enrichedResult.trim().length > currentAnswer.length) {
        const finalAnswer = enrichedResult.trim()
          .replace(/\*+/g, '') // Remove asterisks
          .replace(/•/g, '') // Remove bullet points
          .replace(/\*\*/g, '') // Remove bold formatting
          .replace(/#+/g, '') // Remove headers
          .replace(/\s+/g, ' ') // Replace multiple spaces with single space
          .trim();
        console.log(`[ENRICHMENT] Enhanced answer for better completeness`);
        return finalAnswer;
      }
    } catch (enrichmentError) {
      console.log(`[ENRICHMENT] Error enriching answer: ${enrichmentError.message}`);
    }
    return null; // Return null if no enrichment occurs
  }

  // Get chat history for a specific session
  async getChatHistory(req, res) {
    const { clientId, sessionId } = req.params;

    try {
      const chatHistory = await ChatHistory.findOne({ clientId, sessionId });
      
      if (!chatHistory) {
        return res.status(404).json({ 
          success: false, 
          message: 'Chat history not found for this session' 
        });
      }

      res.json({
        success: true,
        data: {
          sessionId: chatHistory.sessionId,
          userId: chatHistory.userId,
          messages: chatHistory.messages,
          context: chatHistory.context,
          metadata: chatHistory.metadata,
          createdAt: chatHistory.createdAt,
          updatedAt: chatHistory.updatedAt
        }
      });
    } catch (error) {
      console.error('Error getting chat history:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error retrieving chat history' 
      });
    }
  }

  // Get all chat sessions for a client
  async getChatSessions(req, res) {
    const { clientId } = req.params;
    const { limit = 20, page = 1 } = req.query;

    try {
      const skip = (page - 1) * limit;
      
      const sessions = await ChatHistory.find({ clientId })
        .select('sessionId userId metadata.createdAt updatedAt')
        .sort({ 'metadata.lastActive': -1 })
        .limit(parseInt(limit))
        .skip(skip);

      const totalSessions = await ChatHistory.countDocuments({ clientId });

      res.json({
        success: true,
        data: {
          sessions,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalSessions / limit),
            totalSessions,
            hasMore: skip + sessions.length < totalSessions
          }
        }
      });
    } catch (error) {
      console.error('Error getting chat sessions:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error retrieving chat sessions' 
      });
    }
  }

  // Delete chat history for a specific session
  async deleteChatHistory(req, res) {
    const { clientId, sessionId } = req.params;

    try {
      const deletedHistory = await ChatHistory.findOneAndDelete({ clientId, sessionId });
      
      if (!deletedHistory) {
        return res.status(404).json({ 
          success: false, 
          message: 'Chat history not found for this session' 
        });
      }

      console.log(`[HISTORY] Deleted chat history for session: ${sessionId}`);
      
      res.json({
        success: true,
        message: 'Chat history deleted successfully',
        data: {
          sessionId: deletedHistory.sessionId,
          messagesDeleted: deletedHistory.messages.length
        }
      });
    } catch (error) {
      console.error('Error deleting chat history:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error deleting chat history' 
      });
    }
  }

  // Save chat interaction to history
  async saveChatInteraction(chatHistory, query, refinedQuery, response, confidence, score, language, matchedQuestion) {
    try {
      const messageData = {
        query,
        refinedQuery,
        response,
        confidence,
        score,
        language,
        matchedQuestion,
        timestamp: new Date()
      };

      await chatHistory.addMessage(messageData);
      console.log(`[HISTORY] Saved interaction - Query: "${query}" | Confidence: ${confidence}`);
    } catch (error) {
      console.error('Error saving chat interaction:', error);
    }
  }
}

module.exports = new ChatController();
