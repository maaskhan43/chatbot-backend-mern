const jwt = require('jsonwebtoken');

class JWTService {
  // Generate admin JWT token
  generateAdminToken(adminId, email, role) {
    const payload = {
      id: adminId,
      email: email,
      role: role,
      type: 'admin'
    };

    return jwt.sign(payload, process.env.JWT_ADMIN_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'  // 7 days for better persistence
    });
  }

  // Generate user JWT token (for chatbot users)
  generateUserToken(userId, email) {
    const payload = {
      id: userId,
      email: email,
      type: 'user'
    };

    return jwt.sign(payload, process.env.JWT_USER_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'  // 7 days for better persistence
    });
  }

  // Verify admin token
  verifyAdminToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_ADMIN_SECRET);
      if (decoded.type !== 'admin') {
        throw new Error('Invalid token type');
      }
      return decoded;
    } catch (error) {
      throw new Error('Invalid or expired admin token');
    }
  }

  // Verify user token
  verifyUserToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_USER_SECRET);
      if (decoded.type !== 'user') {
        throw new Error('Invalid token type');
      }
      return decoded;
    } catch (error) {
      throw new Error('Invalid or expired user token');
    }
  }

  // Extract token from Authorization header
  extractToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7);
  }
}

module.exports = new JWTService();