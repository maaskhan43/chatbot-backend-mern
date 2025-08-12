const Client = require('../models/Client');
const ClientQA = require('../models/ClientQA');
const GeminiService = require('../services/gemini.service');
const { cosineSimilarity } = require('../utils/vector.util');

class ChatController {
  constructor() {
    this.getPriorityQuestions = this.getPriorityQuestions.bind(this);
    this.semanticSearch = this.semanticSearch.bind(this);
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
        return res.json({ answer: "I'm sorry, I couldn't find a relevant answer.", score: 0 });
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
        res.json({ answer: bestMatch.answer, score: bestMatch.score });
      } else {
        console.log('[6] Best match score is below threshold. Returning suggested questions.');
        const suggestedQuestions = top5.map(match => match.question);
        res.json({
          answer: "I couldn't find a direct answer. Perhaps one of these related questions will help?",
          suggestedQuestions: suggestedQuestions,
          score: bestMatch ? bestMatch.score : 0
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
