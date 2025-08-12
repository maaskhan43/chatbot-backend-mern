const jwtService = require('../services/jwt.service');
const Admin = require('../models/Admin');

// Middleware to authenticate admin requests
const authenticateAdmin = async (req, res, next) => {
  try {
    const token = jwtService.extractToken(req.headers.authorization);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }

    // Verify token
    const decoded = jwtService.verifyAdminToken(token);
    
    // Check if admin still exists and is active
    const admin = await Admin.findById(decoded.id);
    if (!admin || !admin.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Admin account not found or inactive'
      });
    }

    // Add admin info to request
    req.admin = {
      id: admin._id,
      email: admin.email,
      name: admin.name,
      role: admin.role
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message || 'Invalid authentication token'
    });
  }
};

// Middleware to authenticate user requests (for chatbot)
const authenticateUser = async (req, res, next) => {
  try {
    const token = jwtService.extractToken(req.headers.authorization);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }

    // Verify token
    const decoded = jwtService.verifyUserToken(token);
    
    // Add user info to request
    req.user = {
      id: decoded.id,
      email: decoded.email
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message || 'Invalid authentication token'
    });
  }
};

// Optional auth middleware (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const token = jwtService.extractToken(req.headers.authorization);
    
    if (token) {
      const decoded = jwtService.verifyUserToken(token);
      req.user = {
        id: decoded.id,
        email: decoded.email
      };
    }
    
    next();
  } catch (error) {
    // Continue without user info if token is invalid
    next();
  }
};

// Internal service authentication (for Python scraper)
const authenticateInternalService = (req, res, next) => {
  try {
    const internalHeader = req.headers['x-internal-service'];
    
    if (!internalHeader || internalHeader !== 'python-scraper') {
      return res.status(401).json({
        success: false,
        message: 'Internal service authentication required'
      });
    }
    
    // Mark request as internal
    req.isInternalService = true;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Internal service authentication failed'
    });
  }
};

// Alias for backward compatibility
const authenticateToken = authenticateAdmin;

module.exports = {
  authenticateAdmin,
  authenticateUser,
  authenticateToken,
  authenticateInternalService,
  optionalAuth
};