const jwt = require('jsonwebtoken');
const db  = require('../config/db');
const { error } = require('../utils/response');

const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return error(res, 'No token provided', 401);
    }
    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Include face_photo — needed by checkIn to verify face is registered
    const [rows] = await db.execute(
      'SELECT id, name, email, role, store_id, status, avatar, face_photo, employee_code, designation FROM users WHERE id = ?',
      [decoded.id]
    );
    if (!rows.length || rows[0].status !== 'active') {
      return error(res, 'User not found or inactive', 401);
    }
    req.user = rows[0];
    next();
  } catch (err) {
    return error(res, 'Invalid token', 401);
  }
};

module.exports = auth;
