const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../config/db');
const { success, error } = require('../utils/response');

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return error(res, 'Email and password required');

    const [rows] = await db.execute(
      'SELECT * FROM users WHERE email = ? AND status = "active" LIMIT 1',
      [email.trim()]
    );
    if (!rows.length) return error(res, 'Invalid credentials', 401);

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return error(res, 'Invalid credentials', 401);

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES }
    );

    // Get store info if assigned
    let store = null;
    if (user.store_id) {
      const [storeRows] = await db.execute(
        'SELECT id, name, store_code, latitude, longitude, radius FROM stores WHERE id = ?',
        [user.store_id]
      );
      store = storeRows[0] || null;
    }

    return success(res, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        store_id: user.store_id,
        employee_code: user.employee_code,
        designation: user.designation,
        avatar: user.avatar ? `${process.env.BASE_URL}/storage/${user.avatar}` : null,
        phone: user.phone,
      },
      store,
    }, 'Login successful');
  } catch (err) {
    console.error(err);
    return error(res, 'Server error', 500);
  }
};

exports.me = async (req, res) => {
  const user = req.user;
  let store = null;
  if (user.store_id) {
    const [rows] = await db.execute(
      'SELECT id, name, store_code, latitude, longitude, radius FROM stores WHERE id = ?',
      [user.store_id]
    );
    store = rows[0] || null;
  }
  return success(res, { user, store });
};