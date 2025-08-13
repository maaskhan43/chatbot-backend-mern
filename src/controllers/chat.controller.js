const Client = require('../models/Client');
const ClientQA = require('../models/ClientQA');
const GeminiService = require('../services/gemini.service');
const { cosineSimilarity } = require('../utils/vector.util');

class ChatController {
  constructor() {
    this.getPriorityQuestions = this.getPriorityQuestions.bind(this);
    this.semanticSearch = this.semanticSearch.bind(this);
    
    // Define greeting patterns
    this.greetingPatterns = [
      /^(hi|hello|hey|good morning|good afternoon|good evening|greetings|hiii|hiiiii|hiiiiii|hiiiiiii|hiiiiiiiiii)$/i,
      /^(hi there|hello there|hey there)$/i,
      /^(how are you|how do you do)$/i,
      /^(what's up|whats up|sup)$/i
    ];
    
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
    
    // Static greeting responses
    this.greetingResponses = [
      "Hello! I'm here to help you with questions related to our knowledge base. How can I assist you today?",
      "Hi there! I can help you find answers from our uploaded documents. What would you like to know?",
      "Greetings! I'm your knowledge base assistant. Feel free to ask me anything related to our stored information.",
      "Hello! I'm ready to help you find relevant information from our Q&A database. What's your question?"
    ];
  }

  // Check if query is a greeting
  isGreeting(query) {
    const trimmedQuery = query.trim();
    return this.greetingPatterns.some(pattern => pattern.test(trimmedQuery));
  }

  // Check if query is restricted (general question)
  isRestrictedQuery(query) {
    return this.restrictedPatterns.some(pattern => pattern.test(query));
  }

  // Get random greeting response
  getGreetingResponse() {
    const randomIndex = Math.floor(Math.random() * this.greetingResponses.length);
    return this.greetingResponses[randomIndex];
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
    const { query, clientId } = req.body;

    if (!query || !clientId) {
      return res.status(400).json({ message: 'Query and Client ID are required.' });
    }

    console.log('\n--- New Semantic Search Request ---');
    console.log(`[1] Received Query: '${query}' for Client ID: '${clientId}'`);

    try {
      // Check for greeting first
      if (this.isGreeting(query)) {
        console.log('[GREETING] Detected greeting message, returning static response.');
        return res.json({ 
          answer: this.getGreetingResponse(), 
          score: 1.0,
          type: 'greeting'
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

      const threshold = 0.70;
      console.log(`[i] Using similarity threshold: ${threshold}`);

      const queryEmbedding = await GeminiService.generateEmbedding(query);
      if (!queryEmbedding) {
        return res.status(500).json({ message: 'Failed to generate query embedding.' });
      }
      console.log('[2] Successfully generated query embedding.');

      const clientQAData = await ClientQA.find({ clientId: clientId, status: 'completed' });
      const allPairs = clientQAData.flatMap(doc => doc.pairs.filter(p => p.embedding && p.embedding.length > 0));

      console.log(`[3] Found ${clientQAData.length} Q&A documents with a total of ${allPairs.length} Q&A pairs for this client.`);

      if (allPairs.length === 0) {
        console.log('[6] No Q&A pairs with embeddings found. Returning generic response.');
        console.log('--- Search Request Finished ---\n');
        return res.json({ 
          answer: "I'm sorry, I couldn't find a relevant answer in our knowledge base. Please make sure some Q&A documents have been uploaded and processed.", 
          score: 0,
          type: 'no_data'
        });
      }

      const comparisons = allPairs.map(pair => ({
        question: pair.question,
        answer: pair.answer,
        score: cosineSimilarity(queryEmbedding, pair.embedding)
      }));

      console.log(`[4] Performed ${comparisons.length} vector comparisons.`);

      comparisons.sort((a, b) => b.score - a.score);

      const top5 = comparisons.slice(0, 5);
      console.log('[5] Top 5 matches found:');
      top5.forEach((match, i) => {
        console.log(`  ${i + 1}. Score: ${match.score.toFixed(4)} | Question: ${match.question}`);
      });

      const bestMatch = comparisons[0];

      if (bestMatch && bestMatch.score >= threshold) {
        console.log(`[6] Best match score is above threshold (${threshold}). Returning answer.`);
        res.json({ 
          answer: bestMatch.answer, 
          score: bestMatch.score,
          type: 'knowledge_base'
        });
      } else {
        console.log('[6] Best match score is below threshold. Returning suggested questions.');
        const suggestedQuestions = top5.map(match => match.question);
        res.json({
          answer: "I couldn't find a direct answer in our knowledge base. Perhaps one of these related questions will help?",
          suggestedQuestions: suggestedQuestions,
          score: bestMatch ? bestMatch.score : 0,
          type: 'suggestions'
        });
      }

    } catch (error) {
      console.error('Error during semantic search:', error);
      res.status(500).json({ message: 'An error occurred during the search.' });
    }
    console.log('--- Search Request Finished ---\n');
  }
}

module.exports = new ChatController();
