const Client = require('../models/Client');
const ClientQA = require('../models/ClientQA');
const ChatHistory = require('../models/ChatHistory');
const GeminiService = require('../services/gemini.service');
const { cosineSimilarity } = require('../utils/vector.util');

class ChatController {
  constructor() {
    this.getPriorityQuestions = this.getPriorityQuestions.bind(this);
    this.semanticSearch = this.semanticSearch.bind(this);
    this.handleSuggestionClick = this.handleSuggestionClick.bind(this);
    this.saveChatInteraction = this.saveChatInteraction.bind(this);
    this.getChatHistory = this.getChatHistory.bind(this);
    this.getChatSessions = this.getChatSessions.bind(this);
    this.deleteChatHistory = this.deleteChatHistory.bind(this);
    
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

      const result = await GeminiService.generateText(greetingPrompt);
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

      const response = await GeminiService.generateText(greetingPrompt);
      console.log(`[GREETING-AI] Generated response in ${language}: ${response.substring(0, 100)}...`);
      return response.trim();
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
    return await GeminiService.detectLanguage(query);
  }

  // Enhanced match evaluation with multiple confidence tiers
  evaluateMatchConfidence(score) {
    if (score >= 0.80) {
      return {
        level: 'high',
        description: 'High confidence match',
        shouldReturnAnswer: true,
        includeConfidenceNote: false
      };
    } else if (score >= 0.60) {
      return {
        level: 'medium',
        description: 'Medium confidence match',
        shouldReturnAnswer: true,
        includeConfidenceNote: true
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

  // Format suggestions with enhanced metadata
  formatSuggestions(matches, originalQuery) {
    return matches.map((match, index) => ({
      id: `suggestion_${index + 1}`,
      question: match.question,
      score: parseFloat(match.score.toFixed(4)),
      relevanceReason: this.generateRelevanceReason(match.score)
    }));
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
        const detectedLanguage = await GeminiService.detectLanguage(query);
        
        // Generate contextual greeting response
        const greetingResponse = await this.generateGreetingResponse(query, detectedLanguage, chatHistory);
        
        // Save greeting interaction to history
        await this.saveChatInteraction(chatHistory, query, query, greetingResponse, 'high', 1.0, detectedLanguage, 'greeting');
        
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

      // Build context-aware query using chat history
      const contextAwareQuery = await this.buildContextAwareQuery(query, chatHistory);

      // --- Query Refinement and Filtering ---
      console.log('[PRE-PROCESSING] Starting query refinement and filtering...');
      // 1. Refine the context-aware query with Gemini for semantic richness
      const refinedQuery = await GeminiService.refineQuery(contextAwareQuery);

      // 2. Filter keywords for logging or future hybrid search (vector search will use the full refined query)
      const filteredKeywords = this.filterKeywords(refinedQuery);
      console.log(`[PRE-PROCESSING] Using refined query for vector search: '${refinedQuery}'`);

      // Detect query language using Gemini (more accurate than hardcoded patterns)
      const originalLanguage = await GeminiService.detectLanguage(query);
      console.log(`[LANGUAGE] Detected language: ${originalLanguage}`);

      // Set similarity threshold
      const baseSimilarityThreshold = 0.6;
      console.log(`[i] Using base similarity threshold: ${baseSimilarityThreshold}`);

      // Generate embedding for the refined query
      const queryEmbedding = await GeminiService.generateEmbedding(refinedQuery);
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

      const bestMatch = topMatches[0];
      const matchEvaluation = this.evaluateMatchConfidence(bestMatch ? bestMatch.score : 0);
      console.log(`[EVALUATION] Match confidence: ${matchEvaluation.level} (${matchEvaluation.description || 'Confidence evaluation'})`);

      if (bestMatch && bestMatch.score >= baseSimilarityThreshold) {
        console.log(`[6] ${matchEvaluation.level} confidence match. Returning answer.`);
        
        let responseAnswer = bestMatch.answer;

        // Add confidence note for medium confidence answers
        if (matchEvaluation.level === 'medium' && matchEvaluation.message) {
          responseAnswer += `\n\n*Note: ${matchEvaluation.message}*`;
        }

        // Translate response if needed
        if (originalLanguage !== 'en') {
          console.log(`[TRANSLATION] Translating response to ${originalLanguage}`);
          responseAnswer = await GeminiService.translateResponse(responseAnswer, originalLanguage);
        }

        // Save chat interaction to history
        await this.saveChatInteraction(chatHistory, query, refinedQuery, responseAnswer, matchEvaluation.level, bestMatch.score, originalLanguage, bestMatch.question);

        res.json({ 
          answer: responseAnswer,
          score: bestMatch.score,
          confidence: matchEvaluation.level,
          type: 'answer',
          language: originalLanguage,
          matchedQuestion: bestMatch.question,
          metadata: {
            originalQuery: query,
            refinedQuery: refinedQuery,
            filteredKeywords: filteredKeywords
          }
        });
      } else {
        console.log('[6] Low confidence match. Returning enhanced suggested questions.');
        
        // Enhanced suggestion system with better metadata
        const enhancedSuggestions = this.formatSuggestions(topMatches);
        let suggestionMessage = "I couldn't find a direct answer in our knowledge base with high confidence. Here are some related questions that might help:";

        // Translate suggestion message if needed
        if (originalLanguage !== 'en') {
          console.log(`[TRANSLATION] Translating suggestion message to ${originalLanguage}`);
          suggestionMessage = await GeminiService.translateResponse(suggestionMessage, originalLanguage);
        }
        
        // Save chat interaction to history
        await this.saveChatInteraction(chatHistory, query, refinedQuery, suggestionMessage, 'low', bestMatch ? bestMatch.score : 0, originalLanguage, bestMatch ? bestMatch.question : '');

        res.json({
          answer: suggestionMessage,
          suggestedQuestions: enhancedSuggestions,
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
      const qaData = await ClientQA.find({ clientId }).select('question answer embedding priority');
      
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
        // Check for exact match first
        if (qa.question.toLowerCase().trim() === originalQuestion.toLowerCase().trim()) {
          bestMatch = qa;
          bestScore = 1.0;
          break;
        }
        
        // Simple text similarity as fallback
        const words1 = originalQuestion.toLowerCase().split(' ');
        const words2 = qa.question.toLowerCase().split(' ');
        const commonWords = words1.filter(word => words2.includes(word));
        const similarity = commonWords.length / Math.max(words1.length, words2.length);
        
        if (similarity > bestScore) {
          bestMatch = qa;
          bestScore = similarity;
        }
      }

      if (!bestMatch || bestScore < 0.3) {
        return res.status(404).json({
          success: false,
          message: 'No matching answer found for the selected question'
        });
      }

      // Enhanced flow: Process answer through Gemini AI for beautification
      let enhancedAnswer = bestMatch.answer;
      
      try {
        const enhancementPrompt = `
You are a professional customer service assistant. Please enhance and beautify the following answer to make it more natural, polished, and user-friendly while maintaining all the original information.

Original Question: "${originalQuestion}"
User Language: ${userLanguage}
Raw Answer: "${bestMatch.answer}"

Guidelines:
1. Make the response sound more conversational and natural
2. Maintain all factual information from the original answer
3. Respond in ${userLanguage === 'en' ? 'English' : userLanguage}
4. Use proper formatting with bullet points or paragraphs if needed
5. Be helpful and professional
6. Keep the same core meaning but improve readability

Enhanced Answer:`;

        const geminiResponse = await GeminiService.generateText(enhancementPrompt);
        enhancedAnswer = geminiResponse.trim() || bestMatch.answer;
        
        console.log(`[GEMINI-ENHANCEMENT] Original: "${bestMatch.answer.substring(0, 100)}..." | Enhanced: "${enhancedAnswer.substring(0, 100)}..."`);
      } catch (geminiError) {
        console.log(`[GEMINI-ENHANCEMENT] Failed to enhance answer: ${geminiError.message}, using original`);
        enhancedAnswer = bestMatch.answer;
      }

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
        enhanced: true
      });

    } catch (error) {
      console.error('[SUGGESTION-CLICK] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process suggestion click'
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

      const enhancedQuery = await GeminiService.generateText(contextPrompt);
      console.log(`[CONTEXT] Original: "${originalQuery}" | Enhanced: "${enhancedQuery}"`);
      return enhancedQuery || originalQuery;
    } catch (error) {
      console.log(`[CONTEXT] Failed to enhance query: ${error.message}`);
      return originalQuery;
    }
  }

  // Save chat interaction to history
  async saveChatInteraction(chatHistory, query, refinedQuery, response, confidence, score, language, matchedQuestion) {
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
}

module.exports = new ChatController();
