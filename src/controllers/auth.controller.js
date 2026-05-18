const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../config/db');
const { success, error } = require('../utils/response');

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return error(res, 'Email and password required', 422);

    // Include face_photo in SELECT so app knows if face is registered
    const [rows] = await db.execute(
      'SELECT id, name, email, password, role, store_id, status, avatar, face_photo, employee_code, designation, phone FROM users WHERE email = ? AND status = "active" LIMIT 1',
      [email.trim()]
    );
    if (!rows.length) return error(res, 'Invalid credentials', 401);

    const user  = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return error(res, 'Invalid credentials', 401);

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || '30d' }
    );

    let store = null;
    if (user.store_id) {
      const [storeRows] = await db.execute(
        'SELECT id, name, store_code, latitude, longitude, radius FROM stores WHERE id = ?',
        [user.store_id]
      );
      store = storeRows[0] || null;
    }

    const base = process.env.BASE_URL || '';
    return success(res, {
      token,
      user: {
        id:                  user.id,
        name:                user.name,
        email:               user.email,
        role:                user.role,
        store_id:            user.store_id,
        employee_code:       user.employee_code,
        designation:         user.designation,
        phone:               user.phone,
        avatar:              user.avatar ? `${base}/storage/${user.avatar}` : null,
        has_face_registered: !!user.face_photo,  // boolean — app uses this to show warning
      },
      store,
    }, 'Login successful');
  } catch (err) {
    console.error('login error:', err);
    return error(res, 'Server error', 500);
  }
};

exports.me = async (req, res) => {
  try {
    const user = req.user;
    let store  = null;
    if (user.store_id) {
      const [rows] = await db.execute(
        'SELECT id, name, store_code, latitude, longitude, radius FROM stores WHERE id = ?',
        [user.store_id]
      );
      store = rows[0] || null;
    }
    const base = process.env.BASE_URL || '';
    return success(res, {
      user: {
        ...user,
        avatar:              user.avatar ? `${base}/storage/${user.avatar}` : null,
        has_face_registered: !!user.face_photo,
      },
      store,
    });
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};
