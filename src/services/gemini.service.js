const { GoogleGenerativeAI } = require('@google/generative-ai');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

class GeminiService {
  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set in environment variables.');
    }
    this.generativeAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.embeddingModel = this.generativeAI.getGenerativeModel({ model: 'embedding-001' });
    this.generativeModel = this.generativeAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  async refineQuery(query) {
    try {
      const prompt = `You are helping to refine a user query for a semantic search system. Your job is to:
1. Fix minor grammar/spelling errors if any
2. Keep the EXACT same meaning and intent
3. Do NOT change the subject or topic
4. Do NOT make assumptions about what the user meant
5. If the query is already clear, return it unchanged

IMPORTANT: Preserve the original language and meaning. Only make minimal improvements.

Original query: "${query}"

Refined query:`;

      const result = await this.generativeModel.generateContent(prompt);
      const response = await result.response;
      const refinedQuery = response.text().trim();
      
      console.log(`[GEMINI] Original Query: '${query}' | Refined Query: '${refinedQuery}'`);
      return refinedQuery;

    } catch (error) {
      console.error('Error refining query with Gemini:', error);
      // Return the original query as a fallback
      return query;
    }
  }

  async detectLanguage(text) {
    try {
      const prompt = `Detect the primary language of this text. Return only the ISO 639-1 language code (2 letters) and nothing else. 

Examples:
- English text → en
- Hindi text (Devanagari or romanized/Hinglish) → hi  
- Spanish text → es
- French text → fr
- German text → de
- Mixed language but primarily Hindi → hi

Text to analyze: "${text}"

Language code:`;

      const result = await this.generativeModel.generateContent(prompt);
      const response = await result.response;
      const languageCode = response.text().trim().toLowerCase();
      
      // Validate the response is a proper language code
      const validCodes = ['en', 'hi', 'es', 'fr', 'de'];
      const detectedLang = validCodes.includes(languageCode) ? languageCode : 'en';
      
      console.log(`[GEMINI-LANG] Detected language: '${detectedLang}' for text: '${text}'`);
      return detectedLang;

    } catch (error) {
      console.error('Error detecting language with Gemini:', error);
      // Fallback to simple pattern-based detection
      return this.detectLanguageFallback(text);
    }
  }

  // Fallback language detection method
  detectLanguageFallback(text) {
    const hindiPattern = /[\u0900-\u097F]/;
    const hinglishWords = /\b(kon|kaun|kya|kaise|kahan|kab|kyun|hai|hain|hoon|ho|tha|thi|the|aur|ya|ke|ki|ka|se|me|par|tak|wala|wali|vale|ji|bhi|nahi|nahin|haan|achha|theek|sahi)\b/i;
    const spanishPattern = /[ñáéíóúü]/i;
    const frenchPattern = /[àâäéèêëïîôöùûüÿç]/i;
    const germanPattern = /[äöüß]/i;
    
    if (hindiPattern.test(text)) return 'hi';
    if (hinglishWords.test(text)) return 'hi';
    if (spanishPattern.test(text)) return 'es';
    if (frenchPattern.test(text)) return 'fr';
    if (germanPattern.test(text)) return 'de';
    return 'en';
  }

  async translateResponse(text, targetLanguage) {
    // Skip translation if target is English or if text is empty
    if (targetLanguage === 'en' || !text || typeof text !== 'string') {
      return text;
    }

    try {
      const languageNames = {
        'hi': 'Hindi',
        'es': 'Spanish', 
        'fr': 'French',
        'de': 'German'
      };

      const targetLanguageName = languageNames[targetLanguage] || 'English';
      
      const prompt = `Translate the following text to ${targetLanguageName}. Maintain the same tone and formatting. If there are technical terms or proper nouns, keep them in English but provide the translation in parentheses if helpful.\n\nText to translate: "${text}"\n\nTranslation:`;

      const result = await this.generativeModel.generateContent(prompt);
      const response = await result.response;
      const translatedText = response.text().trim();
      
      console.log(`[TRANSLATION] Translated to ${targetLanguageName}: ${translatedText.substring(0, 100)}...`);
      return translatedText;

    } catch (error) {
      console.error('Error translating response with Gemini:', error);
      // Return original text as fallback
      return text;
    }
  }

  async generateEmbedding(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid input text');
    }
    // Add retries for resilience
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const result = await this.embeddingModel.embedContent(text);
        const embedding = result.embedding.values;
        // console.log('Embedding generated successfully:', embedding.slice(0, 5));
        return embedding;
      } catch (error) {
        console.error(`Attempt ${i + 1} failed for generating embedding:`, error.message);
        if (i === MAX_RETRIES - 1) {
          console.error('All retries failed for generating embedding.');
          return null;
        }
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    return null; // Should not be reached
  }
}

module.exports = new GeminiService();
