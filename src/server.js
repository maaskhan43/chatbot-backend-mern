const app = require('./app');
const connectDB = require('./config/database');

const PORT = process.env.PORT || 8080;

// Connect to database
connectDB();

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Gemini Chatbot Backend running on port ${PORT}`);
  console.log(`📊 Health check: ${BACKEND_URL}/health`);
  console.log(`🔐 Admin login: POST ${BACKEND_URL}/admin/auth/login`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});