const db     = require('../config/db');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path   = require('path');
const { success, error } = require('../utils/response');

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(process.env.UPLOAD_PATH, 'avatars')),
  filename: (req, file, cb) => cb(null, `avatar_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`)
});
exports.uploadAvatar = multer({ storage: avatarStorage, limits: { fileSize: 3 * 1024 * 1024 } });

// Get profile
exports.getProfile = async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.store_id, u.employee_code,
       u.designation, u.joining_date, u.avatar, u.status,
       s.name as store_name, s.store_code
       FROM users u LEFT JOIN stores s ON s.id = u.store_id WHERE u.id = ?`,
      [req.user.id]
    );
    const user = rows[0];
    if (user.avatar) user.avatar = `${process.env.BASE_URL}/storage/${user.avatar}`;
    return success(res, { user });
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};

// Update profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone } = req.body;
    const updates = [];
    const params = [];

    if (name) { updates.push('name = ?'); params.push(name); }
    if (phone) { updates.push('phone = ?'); params.push(phone); }
    if (req.file) {
      updates.push('avatar = ?');
      params.push(`avatars/${req.file.filename}`);
    }
    if (!updates.length) return error(res, 'Nothing to update');
    updates.push('updated_at = NOW()');
    params.push(req.user.id);

    await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    return success(res, null, 'Profile updated successfully');
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const [rows] = await db.execute('SELECT password FROM users WHERE id = ?', [req.user.id]);
    const valid = await bcrypt.compare(current_password, rows[0].password);
    if (!valid) return error(res, 'Current password is incorrect');

    const hash = await bcrypt.hash(new_password, 12);
    await db.execute('UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?', [hash, req.user.id]);
    return success(res, null, 'Password changed successfully');
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};

// Admin: list all users
exports.listUsers = async (req, res) => {
  try {
    const { store_id, role, status } = req.query;
    let query = `SELECT u.id, u.name, u.email, u.role, u.store_id, u.employee_code,
      u.designation, u.phone, u.status, u.avatar, s.name as store_name
      FROM users u LEFT JOIN stores s ON s.id = u.store_id WHERE 1=1`;
    const params = [];
    if (store_id) { query += ' AND u.store_id = ?'; params.push(store_id); }
    if (role)     { query += ' AND u.role = ?';     params.push(role); }
    if (status)   { query += ' AND u.status = ?';   params.push(status); }
    query += ' ORDER BY u.name ASC';

    const [rows] = await db.execute(query, params);
    return success(res, { users: rows });
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};

// Admin: create user
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, store_id, phone, employee_code, designation, base_salary } = req.body;
    if (!name || !email || !password || !role) return error(res, 'Name, email, password and role are required');

    const [exists] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (exists.length) return error(res, 'Email already registered');

    const hash = await bcrypt.hash(password, 12);
    await db.execute(
      `INSERT INTO users (name, email, password, role, store_id, phone, employee_code, designation, base_salary, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())`,
      [name, email, hash, role, store_id || null, phone || null, employee_code || null, designation || null, base_salary || null]
    );
    return success(res, null, 'User created successfully', 201);
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};