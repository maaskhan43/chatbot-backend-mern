const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    
    if (!mongoUri) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    console.log('🔄 Connecting to MongoDB Atlas...');
    const conn = await mongoose.connect(mongoUri);
    console.log(`✅ MongoDB Atlas Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
    
    // Create default admin if none exists
    await createDefaultAdmin();
    
  } catch (error) {
    console.error('❌ MongoDB Atlas connection error:', error.message);
    process.exit(1);
  }
};

// Create default admin for testing
const createDefaultAdmin = async () => {
  try {
    const Admin = require('../models/Admin');
    
    // Check if any admin exists
    const adminCount = await Admin.countDocuments();
    
    if (adminCount === 0) {
      const defaultAdmin = new Admin({
        email: 'admin@gemini-chatbot.com',
        password: 'admin123',
        name: 'Default Admin',
        role: 'super-admin'
      });
      
      await defaultAdmin.save();
      console.log('✅ Default admin created:');
      console.log('   Email: admin@gemini-chatbot.com');
      console.log('   Password: admin123');
      console.log('   Please change these credentials in production!');
    }
  } catch (error) {
    console.error('Error creating default admin:', error);
  }
};

module.exports = connectDB;