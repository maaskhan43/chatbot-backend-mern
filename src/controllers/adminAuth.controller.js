const Admin = require('../models/Admin');
const jwtService = require('../services/jwt.service');

class AdminAuthController {
  // Admin login
  async login(req, res) {
    try {
      console.log('🔐 Login attempt:', req.body);
      const { email, password } = req.body;

      // Validate input
      if (!email || !password) {
        console.log('❌ Missing email or password');
        return res.status(400).json({
          success: false,
          message: 'Email and password are required'
        });
      }

      // Find admin by email
      console.log('🔍 Looking for admin with email:', email.toLowerCase());
      const admin = await Admin.findOne({ email: email.toLowerCase() });
      console.log('👤 Admin found:', admin ? 'Yes' : 'No');
      
      if (!admin) {
        console.log('❌ Admin not found');
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Check if admin is active
      if (!admin.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated. Please contact support.'
        });
      }

      // Verify password
      console.log('🔑 Verifying password...');
      const isPasswordValid = await admin.comparePassword(password);
      console.log('✅ Password valid:', isPasswordValid);
      
      if (!isPasswordValid) {
        console.log('❌ Invalid password');
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Update last login
      console.log('📅 Updating last login...');
      admin.lastLogin = new Date();
      await admin.save();

      // Generate JWT token
      console.log('🎫 Generating JWT token...');
      const token = jwtService.generateAdminToken(admin._id, admin.email, admin.role);
      console.log('✅ Token generated successfully');

      // Return success response
      console.log('🎉 Login successful for:', admin.email);
      res.status(200).json({
        success: true,
        message: 'Login successful',
        admin: {
          id: admin._id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          lastLogin: admin.lastLogin
        },
        token: token
      });

    } catch (error) {
      console.error('Admin login error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get current admin profile
  async getProfile(req, res) {
    try {
      const admin = await Admin.findById(req.admin.id);
      
      if (!admin) {
        return res.status(404).json({
          success: false,
          message: 'Admin not found'
        });
      }

      res.status(200).json({
        success: true,
        admin: {
          id: admin._id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          lastLogin: admin.lastLogin,
          createdAt: admin.createdAt
        }
      });

    } catch (error) {
      console.error('Get admin profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Admin logout (optional - mainly for frontend state management)
  async logout(req, res) {
    try {
      // In a stateless JWT system, logout is mainly handled on the frontend
      // by removing the token. We can optionally log this action.
      
      res.status(200).json({
        success: true,
        message: 'Logout successful'
      });

    } catch (error) {
      console.error('Admin logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
}

module.exports = new AdminAuthController();
