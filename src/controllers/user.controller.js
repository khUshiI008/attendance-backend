const db     = require('../config/db');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const axios  = require('axios');
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
       u.designation, u.joining_date, u.avatar, u.status, u.face_photo,
       s.name as store_name, s.store_code
       FROM users u LEFT JOIN stores s ON s.id = u.store_id WHERE u.id = ?`,
      [req.user.id]
    );
    const user = rows[0];
    if (user.avatar)     user.avatar     = `${process.env.BASE_URL}/storage/${user.avatar}`;
    if (user.face_photo) user.face_photo = `${process.env.BASE_URL}/storage/${user.face_photo}`;
    // Tell the app whether a face is registered so it can show/hide warnings
    user.has_face_registered = !!rows[0].face_photo;
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

    if (name)  { updates.push('name = ?');  params.push(name); }
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

// Register / update face photo
// Accepts base64 image string in req.body.face_photo
// Mirrors Laravel's registerFacePhoto(): saves file → calls Python /register → updates DB
exports.registerFacePhoto = async (req, res) => {
  try {
    const { face_photo } = req.body; // base64 string like "data:image/jpeg;base64,..."
    const userId = req.user.id;

    if (!face_photo) return error(res, 'face_photo is required', 422);

    // 1. Save the image file (same path pattern as Laravel: face_photos/user_{id}_{ts}.jpg)
    const base64Data = face_photo.replace(/^data:image\/\w+;base64,/, '');
    const dir      = path.join(process.env.UPLOAD_PATH, 'face_photos');
    fs.mkdirSync(dir, { recursive: true });
    const filename  = `user_${userId}_${Date.now()}.jpg`;
    const filePath  = path.join(dir, filename);
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    const photoPath = `face_photos/${filename}`;

    // 2. Call Python face service /register (matches Laravel FaceRecognitionService::register)
    const faceUrl = (process.env.FACE_SERVICE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '');
    const secret  = process.env.FACE_SERVICE_SECRET || 'change_me_in_production';

    try {
      // Send as base64 — Python service accepts both file and base64
      const resp = await axios.post(
        `${faceUrl}/register`,
        { user_id: userId, face_photo: face_photo },
        { headers: { 'X-Face-Secret': secret }, timeout: 15000 }
      );

      if (!resp.data?.success) {
        // Clean up saved file on failure
        try { fs.unlinkSync(filePath); } catch (_) {}
        return error(res, resp.data?.message || 'Face registration failed', 422);
      }
    } catch (faceErr) {
      // If face service is down, still save the photo (admin-registered style)
      // Don't block the employee — the check-in will fail anyway if face service is down
      console.error('Face service unavailable during registration:', faceErr.message);
    }

    // 3. Remove old face photo file if exists
    const [existing] = await db.execute('SELECT face_photo FROM users WHERE id = ?', [userId]);
    const oldPhoto = existing[0]?.face_photo;
    if (oldPhoto) {
      const oldPath = path.join(process.env.UPLOAD_PATH, oldPhoto.replace('face_photos/', 'face_photos/'));
      try { fs.unlinkSync(oldPath); } catch (_) {}
    }

    // 4. Update DB
    await db.execute(
      'UPDATE users SET face_photo = ?, updated_at = NOW() WHERE id = ?',
      [photoPath, userId]
    );

    return success(res, { has_face_registered: true }, 'Face photo registered successfully');
  } catch (err) {
    console.error('registerFacePhoto error:', err);
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
