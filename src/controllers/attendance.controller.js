const db      = require('../config/db');
const multer  = require('multer');
const path    = require('path');
const moment  = require('moment');
const { success, error } = require('../utils/response');
const { isWithinRadius } = require('../utils/geoFence');

// Multer config — store selfies same path as Laravel
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(process.env.UPLOAD_PATH, 'selfies')),
  filename: (req, file, cb) => {
    const type = req.body.type === 'checkout' ? 'checkout' : 'checkin';
    cb(null, `${type}_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
exports.upload = upload;

// Check In
exports.checkIn = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const userId = req.user.id;
    const storeId = req.user.store_id;
    const today = moment().format('YYYY-MM-DD');

    if (!storeId) return error(res, 'No store assigned to your account');
    if (!latitude || !longitude) return error(res, 'Location is required');

    // Check already checked in today
    const [existing] = await db.execute(
      'SELECT id, check_in_time FROM attendances WHERE user_id = ? AND date = ?',
      [userId, today]
    );
    if (existing.length) return error(res, 'Already checked in today');

    // Get store geo
    const [stores] = await db.execute(
      'SELECT latitude, longitude, radius FROM stores WHERE id = ?', [storeId]
    );
    const store = stores[0];
    if (!store) return error(res, 'Store not found');

    const geo = isWithinRadius(
      parseFloat(latitude), parseFloat(longitude),
      parseFloat(store.latitude), parseFloat(store.longitude),
      store.radius
    );
    if (!geo.allowed) {
      return error(res, `You are ${geo.distance}m away from store. Max allowed: ${store.radius}m`);
    }

    // Determine status (late/present based on shift)
    const [shiftRows] = await db.execute(
      `SELECT s.start_time, s.grace_minutes FROM shifts s
       JOIN employee_shifts es ON es.shift_id = s.id
       WHERE es.user_id = ? AND es.status = 'active' LIMIT 1`,
      [userId]
    );
    let status = 'present';
    if (shiftRows.length) {
      const shift = shiftRows[0];
      const shiftStart = moment(`${today} ${shift.start_time}`);
      const graceCutoff = shiftStart.clone().add(shift.grace_minutes, 'minutes');
      if (moment().isAfter(graceCutoff)) status = 'late';
    }

    const selfiePath = req.file ? `selfies/${req.file.filename}` : null;
    const now = moment().format('HH:mm:ss');

    const [result] = await db.execute(
      `INSERT INTO attendances (user_id, store_id, date, check_in_time, check_in_lat, check_in_lng, check_in_selfie, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [userId, storeId, today, now, latitude, longitude, selfiePath, status]
    );

    return success(res, {
      attendance_id: result.insertId,
      check_in_time: now,
      status,
      date: today,
    }, 'Checked in successfully');
  } catch (err) {
    console.error(err);
    return error(res, 'Server error', 500);
  }
};

// Check Out
exports.checkOut = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const userId = req.user.id;
    const today = moment().format('YYYY-MM-DD');

    const [rows] = await db.execute(
      'SELECT id, check_in_time FROM attendances WHERE user_id = ? AND date = ? AND check_out_time IS NULL',
      [userId, today]
    );
    if (!rows.length) return error(res, 'No active check-in found for today');

    const attendance = rows[0];
    const now = moment();
    const checkIn = moment(`${today} ${attendance.check_in_time}`);
    const totalMinutes = now.diff(checkIn, 'minutes');
    const nowStr = now.format('HH:mm:ss');
    const selfiePath = req.file ? `selfies/${req.file.filename}` : null;

    await db.execute(
      `UPDATE attendances SET check_out_time = ?, check_out_lat = ?, check_out_lng = ?,
       check_out_selfie = ?, total_minutes = ?, updated_at = NOW()
       WHERE id = ?`,
      [nowStr, latitude, longitude, selfiePath, totalMinutes, attendance.id]
    );

    return success(res, {
      check_out_time: nowStr,
      total_minutes: totalMinutes,
      total_hours: (totalMinutes / 60).toFixed(2),
    }, 'Checked out successfully');
  } catch (err) {
    console.error(err);
    return error(res, 'Server error', 500);
  }
};

// Today's Status
exports.todayStatus = async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    const [rows] = await db.execute(
      `SELECT a.*, s.name as store_name FROM attendances a
       LEFT JOIN stores s ON s.id = a.store_id
       WHERE a.user_id = ? AND a.date = ? LIMIT 1`,
      [req.user.id, today]
    );

    const attendance = rows[0] || null;
    let activeBreak = null;
    if (attendance) {
      const [breaks] = await db.execute(
        'SELECT * FROM breaks WHERE attendance_id = ? AND end_time IS NULL LIMIT 1',
        [attendance.id]
      );
      activeBreak = breaks[0] || null;
    }

    return success(res, { attendance, activeBreak, date: today });
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};

// Attendance history
exports.myHistory = async (req, res) => {
  try {
    const { month, year } = req.query;
    const m = month || moment().month() + 1;
    const y = year || moment().year();

    const [rows] = await db.execute(
      `SELECT a.*, s.name as store_name FROM attendances a
       LEFT JOIN stores s ON s.id = a.store_id
       WHERE a.user_id = ? AND MONTH(a.date) = ? AND YEAR(a.date) = ?
       ORDER BY a.date DESC`,
      [req.user.id, m, y]
    );

    return success(res, { records: rows, month: m, year: y });
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};

// Start Break
exports.startBreak = async (req, res) => {
  try {
    const { type, reason } = req.body; // type: lunch | short_break
    const today = moment().format('YYYY-MM-DD');

    const [attRows] = await db.execute(
      'SELECT id FROM attendances WHERE user_id = ? AND date = ? AND check_out_time IS NULL',
      [req.user.id, today]
    );
    if (!attRows.length) return error(res, 'No active attendance found');

    const [activeBreak] = await db.execute(
      'SELECT id FROM breaks WHERE attendance_id = ? AND end_time IS NULL',
      [attRows[0].id]
    );
    if (activeBreak.length) return error(res, 'Already on a break');

    // Get allowed duration from shift
    const [shiftRows] = await db.execute(
      `SELECT s.lunch_duration, s.short_break_duration FROM shifts s
       JOIN employee_shifts es ON es.shift_id = s.id
       WHERE es.user_id = ? AND es.status = 'active' LIMIT 1`,
      [req.user.id]
    );
    const allowed = shiftRows.length
      ? (type === 'lunch' ? shiftRows[0].lunch_duration : shiftRows[0].short_break_duration)
      : 30;

    await db.execute(
      `INSERT INTO breaks (user_id, attendance_id, type, reason, start_time, allowed_duration, created_at, updated_at)
       VALUES (?, ?, ?, ?, NOW(), ?, NOW(), NOW())`,
      [req.user.id, attRows[0].id, type, reason || null, allowed]
    );

    return success(res, { break_started: moment().format('HH:mm:ss'), type, allowed_minutes: allowed }, 'Break started');
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};

// End Break
exports.endBreak = async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    const [attRows] = await db.execute(
      'SELECT id FROM attendances WHERE user_id = ? AND date = ?',
      [req.user.id, today]
    );
    if (!attRows.length) return error(res, 'No attendance found');

    const [breakRows] = await db.execute(
      'SELECT id, start_time, allowed_duration FROM breaks WHERE attendance_id = ? AND end_time IS NULL',
      [attRows[0].id]
    );
    if (!breakRows.length) return error(res, 'No active break');

    const brk = breakRows[0];
    const actual = moment().diff(moment(brk.start_time), 'minutes');

    await db.execute(
      'UPDATE breaks SET end_time = NOW(), actual_duration = ?, updated_at = NOW() WHERE id = ?',
      [actual, brk.id]
    );

    const overBy = actual - brk.allowed_duration;
    return success(res, {
      actual_minutes: actual,
      allowed_minutes: brk.allowed_duration,
      over_by: overBy > 0 ? overBy : 0,
    }, 'Break ended');
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};