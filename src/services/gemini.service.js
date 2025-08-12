const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set in environment variables.');
    }
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.embeddingModel = this.genAI.getGenerativeModel({ model: 'embedding-001' });
  }

  async generateEmbedding(text) {
    try {
      console.log('🔍 GeminiService: Generating embedding for text:', text.substring(0, 100) + '...');
      console.log('🔑 GeminiService: Using API key:', process.env.GEMINI_API_KEY ? 'Present' : 'Missing');
      
      const result = await this.embeddingModel.embedContent(text);
      const embedding = result.embedding;
      
      console.log('✅ GeminiService: Successfully generated embedding, length:', embedding.values.length);
      console.log('📊 GeminiService: First 5 values:', embedding.values.slice(0, 5));
      
      return embedding.values;
    } catch (error) {
      console.error('❌ GeminiService: Error generating embedding:', error);
      console.error('❌ GeminiService: Error details:', {
        message: error.message,
        status: error.status,
        code: error.code,
        details: error.details
      });
      // Return null or an empty array so that one failed embedding doesn't stop the whole process
      return null; 
    }
  }
}

module.exports = new GeminiService();
