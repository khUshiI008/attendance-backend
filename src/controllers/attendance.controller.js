const db      = require('../config/db');
const fs      = require('fs');
const path    = require('path');
const moment  = require('moment');
const axios   = require('axios');
const { success, error } = require('../utils/response');
const { isWithinRadius } = require('../utils/geoFence');

// ── Save base64 selfie — matches Laravel's saveSelfie() exactly ──────────────
function saveSelfie(base64, filename) {
  const data   = base64.replace(/^data:image\/\w+;base64,/, '');
  const dir    = path.join(process.env.UPLOAD_PATH, 'selfies');
  fs.mkdirSync(dir, { recursive: true });
  const fp     = path.join(dir, `${filename}.jpg`);
  fs.writeFileSync(fp, Buffer.from(data, 'base64'));
  return `selfies/${filename}.jpg`;
}

// ── Face verification — calls same Python service as Laravel ─────────────────
async function verifyFace(userId, base64selfie) {
  const faceUrl = (process.env.FACE_SERVICE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '');
  const secret  = process.env.FACE_SERVICE_SECRET || 'change_me_in_production';
  const resp = await axios.post(
    `${faceUrl}/verify`,
    { user_id: userId, selfie: base64selfie },
    { headers: { 'X-Face-Secret': secret }, timeout: 10000 }
  );
  return resp.data; // { match: bool, distance: float }
}

// ── Exact replica of Laravel User::getShiftForDate() ────────────────────────
// employee_shifts has NO status column — only user_id, shift_id, day_of_week, custom_date
// No shift assigned is valid — status just defaults to 'present'
async function getShiftForDate(userId, dateStr) {
  // Priority 1: custom_date (specific date override)
  const [byCustom] = await db.execute(
    `SELECT s.start_time, s.grace_minutes, s.lunch_duration,
            s.short_break_duration, s.short_break_count
     FROM shifts s
     JOIN employee_shifts es ON es.shift_id = s.id
     WHERE es.user_id = ?
       AND es.custom_date = ?
       AND es.day_of_week IS NULL
     LIMIT 1`,
    [userId, dateStr]
  );
  if (byCustom.length) return byCustom[0];

  // Priority 2: day_of_week (0=Sun … 6=Sat — moment().day() matches Carbon's dayOfWeek)
  const dayOfWeek = moment(dateStr).day();
  const [byDay] = await db.execute(
    `SELECT s.start_time, s.grace_minutes, s.lunch_duration,
            s.short_break_duration, s.short_break_count
     FROM shifts s
     JOIN employee_shifts es ON es.shift_id = s.id
     WHERE es.user_id = ?
       AND es.day_of_week = ?
       AND es.custom_date IS NULL
     LIMIT 1`,
    [userId, dayOfWeek]
  );
  return byDay[0] || null; // null = no shift assigned = valid, status defaults to 'present'
}

// ── Check In ─────────────────────────────────────────────────────────────────
// Matches Laravel AttendanceTrait::handleCheckIn() exactly
exports.checkIn = async (req, res) => {
  try {
    const { selfie, latitude, longitude } = req.body;
    const userId  = req.user.id;
    const storeId = req.user.store_id;
    const today   = moment().format('YYYY-MM-DD');

    if (!selfie)              return error(res, 'Selfie is required', 422);
    if (!latitude || !longitude) return error(res, 'Location is required', 422);

    // 1. Face photo must be registered (matches Laravel: if (!$user->face_photo))
    const [userRows] = await db.execute(
      'SELECT face_photo FROM users WHERE id = ?', [userId]
    );
    if (!userRows[0]?.face_photo) {
      return error(res, 'No face photo registered for this user. Please contact admin.', 422);
    }

    // 2. Face verification (matches Laravel: FaceRecognitionService::verify)
    try {
      const faceResult = await verifyFace(userId, selfie);
      if (faceResult.error) {
        return error(res, 'Face verification failed: ' + faceResult.error, 422);
      }
      if (!faceResult.match) {
        return error(res, 'Face not recognised. Attendance rejected.', 422);
      }
    } catch (e) {
      console.error('Face service error:', e.message);
      return error(res, 'Face recognition service unavailable.', 422);
    }

    // 3. Resolve store
    let store = null;
    if (storeId) {
      const [stores] = await db.execute(
        'SELECT id, latitude, longitude, radius FROM stores WHERE id = ?', [storeId]
      );
      store = stores[0] || null;
    }
    // head_manager can pass store_id in body (matches Laravel)
    if (!store && req.body.store_id) {
      const [stores] = await db.execute(
        'SELECT id, latitude, longitude, radius FROM stores WHERE id = ?', [req.body.store_id]
      );
      store = stores[0] || null;
    }
    if (!store) return error(res, 'No store assigned to your account. Please contact admin.', 422);

    // 4. Already checked in today
    const [existing] = await db.execute(
      'SELECT id FROM attendances WHERE user_id = ? AND date = ?', [userId, today]
    );
    if (existing.length) return error(res, 'Already checked in today.', 422);

    // 5. Geo-fence (head_manager is exempt — matches Laravel)
    if (req.user.role !== 'head_manager') {
      const geo = isWithinRadius(
        parseFloat(latitude), parseFloat(longitude),
        parseFloat(store.latitude), parseFloat(store.longitude),
        store.radius
      );
      if (!geo.allowed) {
        return error(res, `You are ${geo.distance}m away from store. Must be within ${store.radius}m.`, 422);
      }
    }

    // 6. Determine late/present from shift (matches Laravel AttendanceTrait)
    let status = 'present';
    const shift = await getShiftForDate(userId, today);
    if (shift) {
      const shiftStart  = moment(`${today} ${shift.start_time}`);
      const graceCutoff = shiftStart.clone().add(shift.grace_minutes ?? 5, 'minutes');
      if (moment().isAfter(graceCutoff)) status = 'late';
    }

    // 7. Save selfie (base64 → file, matches Laravel saveSelfie())
    const selfiePath = saveSelfie(selfie, `checkin_${userId}_${Date.now()}`);
    const now = moment().format('HH:mm:ss');

    await db.execute(
      `INSERT INTO attendances
         (user_id, store_id, date, check_in_time, check_in_selfie, check_in_lat, check_in_lng, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [userId, store.id, today, now, selfiePath, latitude, longitude, status]
    );

    return success(res, { check_in_time: now, status, date: today },
      `Checked in at ${moment().format('hh:mm A')}`);
  } catch (err) {
    console.error('checkIn error:', err);
    return error(res, 'Server error', 500);
  }
};

// ── Check Out ─────────────────────────────────────────────────────────────────
// Matches Laravel AttendanceTrait::handleCheckOut() exactly
exports.checkOut = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const userId = req.user.id;
    const today  = moment().format('YYYY-MM-DD');

    const [rows] = await db.execute(
      'SELECT id, check_in_time, check_out_time FROM attendances WHERE user_id = ? AND date = ?',
      [userId, today]
    );
    const att = rows[0];
    if (!att || att.check_out_time) {
      return error(res, 'No active check-in found.', 422);
    }

    // Auto-end any open break first (matches Laravel)
    const [openBreaks] = await db.execute(
      'SELECT id, start_time, allowed_duration FROM breaks WHERE attendance_id = ? AND end_time IS NULL LIMIT 1',
      [att.id]
    );
    if (openBreaks.length) {
      const ob = openBreaks[0];
      const dur = moment().diff(moment(ob.start_time), 'minutes');
      await db.execute(
        'UPDATE breaks SET end_time=NOW(), actual_duration=?, updated_at=NOW() WHERE id=?',
        [dur, ob.id]
      );
    }

    const now     = moment();
    const nowStr  = now.format('HH:mm:ss');
    const minutes = now.diff(moment(`${today} ${att.check_in_time}`), 'minutes');

    // Deduct break minutes (matches Laravel)
    const [breakSum] = await db.execute(
      'SELECT COALESCE(SUM(actual_duration), 0) as break_mins FROM breaks WHERE attendance_id = ? AND end_time IS NOT NULL',
      [att.id]
    );
    const breakMinutes = parseInt(breakSum[0].break_mins) || 0;
    const totalMinutes = Math.max(0, minutes - breakMinutes);

    await db.execute(
      `UPDATE attendances
         SET check_out_time=?, check_out_lat=?, check_out_lng=?, total_minutes=?, updated_at=NOW()
       WHERE id=?`,
      [nowStr, latitude, longitude, totalMinutes, att.id]
    );

    return success(res, {
      check_out_time: nowStr,
      total_minutes: totalMinutes,
      total_hours: (totalMinutes / 60).toFixed(2),
    }, `Checked out at ${now.format('hh:mm A')}`);
  } catch (err) {
    console.error('checkOut error:', err);
    return error(res, 'Server error', 500);
  }
};

// ── Today's Status ────────────────────────────────────────────────────────────
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
    console.error('todayStatus error:', err);
    return error(res, 'Server error', 500);
  }
};

// ── Attendance History ────────────────────────────────────────────────────────
exports.myHistory = async (req, res) => {
  try {
    const m = parseInt(req.query.month) || moment().month() + 1;
    const y = parseInt(req.query.year)  || moment().year();

    const [records] = await db.execute(
      `SELECT a.*, s.name as store_name FROM attendances a
       LEFT JOIN stores s ON s.id = a.store_id
       WHERE a.user_id = ? AND MONTH(a.date) = ? AND YEAR(a.date) = ?
       ORDER BY a.date DESC`,
      [req.user.id, m, y]
    );

    const [leaves] = await db.execute(
      `SELECT date, date_to, type, status, reason FROM leave_requests
       WHERE user_id = ? AND MONTH(date) = ? AND YEAR(date) = ?
         AND status IN ('approved', 'pending')`,
      [req.user.id, m, y]
    );

    return success(res, { records, leaves, month: m, year: y });
  } catch (err) {
    console.error('myHistory error:', err);
    return error(res, 'Server error', 500);
  }
};

// ── Single Day Detail (new endpoint for calendar tap) ────────────────────────
exports.dayDetail = async (req, res) => {
  try {
    const { date } = req.params;
    const [rows] = await db.execute(
      `SELECT a.*, s.name as store_name FROM attendances a
       LEFT JOIN stores s ON s.id = a.store_id
       WHERE a.user_id = ? AND a.date = ? LIMIT 1`,
      [req.user.id, date]
    );
    const att = rows[0] || null;
    let breaks = [];
    if (att) {
      [breaks] = await db.execute(
        'SELECT * FROM breaks WHERE attendance_id = ? ORDER BY start_time ASC',
        [att.id]
      );
      const base = process.env.BASE_URL || '';
      if (att.check_in_selfie)  att.check_in_selfie_url  = `${base}/storage/${att.check_in_selfie}`;
      if (att.check_out_selfie) att.check_out_selfie_url = `${base}/storage/${att.check_out_selfie}`;
    }
    return success(res, { attendance: att, breaks, date });
  } catch (err) {
    console.error('dayDetail error:', err);
    return error(res, 'Server error', 500);
  }
};

// ── Start Break ───────────────────────────────────────────────────────────────
// Matches Laravel AttendanceTrait::handleStartBreak() exactly
// Break types: 'lunch', 'short', 'early_leave'  (NOT 'short_break')
exports.startBreak = async (req, res) => {
  try {
    const { type, reason } = req.body;
    const today = moment().format('YYYY-MM-DD');

    const validTypes = ['lunch', 'short', 'early_leave'];
    if (!validTypes.includes(type)) {
      return error(res, 'Invalid break type. Must be: lunch, short, or early_leave', 422);
    }

    // early_leave requires reason (matches Laravel)
    if (type === 'early_leave' && !reason) {
      return error(res, 'Please enter a reason for early leave.', 422);
    }

    const [attRows] = await db.execute(
      'SELECT id, check_in_time FROM attendances WHERE user_id = ? AND date = ?',
      [req.user.id, today]
    );
    if (!attRows.length) return error(res, 'Not checked in.', 422);

    // Prevent duplicate active break (matches Laravel)
    const [activeBreak] = await db.execute(
      'SELECT id FROM breaks WHERE attendance_id = ? AND end_time IS NULL', [attRows[0].id]
    );
    if (activeBreak.length) {
      return error(res, 'You already have an active break. End it first.', 422);
    }

    const shift = await getShiftForDate(req.user.id, today);

    // Short break count enforcement (matches Laravel)
    if (type === 'short' && shift && shift.short_break_count > 0) {
      const [taken] = await db.execute(
        "SELECT COUNT(*) as cnt FROM breaks WHERE attendance_id = ? AND type = 'short'",
        [attRows[0].id]
      );
      // Laravel still allows the break but logs a violation — we match that here
      // (violation logging omitted — add BreakViolation insert if you implement that table in Node)
      if (taken[0].cnt >= shift.short_break_count) {
        // Allow but warn (matches Laravel behaviour)
        // Fall through — break is still created
      }
    }

    // Allowed duration (matches Laravel getLunchDuration / getShortBreakDuration)
    let allowedDuration = null;
    if (type === 'lunch') {
      allowedDuration = shift?.lunch_duration ?? 30;
    } else if (type === 'short') {
      allowedDuration = shift?.short_break_duration ?? 15;
    }
    // early_leave has no allowed_duration

    await db.execute(
      `INSERT INTO breaks (user_id, attendance_id, type, reason, start_time, allowed_duration, created_at, updated_at)
       VALUES (?, ?, ?, ?, NOW(), ?, NOW(), NOW())`,
      [req.user.id, attRows[0].id, type, reason || null, allowedDuration]
    );

    // Early leave → also checkout immediately (matches Laravel exactly)
    if (type === 'early_leave') {
      const now = moment();
      const breakMinutesSoFar = 0; // no prior ended breaks for this checkout
      const [bSum] = await db.execute(
        'SELECT COALESCE(SUM(actual_duration),0) as bm FROM breaks WHERE attendance_id=? AND end_time IS NOT NULL',
        [attRows[0].id]
      );
      const totalMins = Math.max(
        0,
        now.diff(moment(`${today} ${attRows[0].check_in_time}`), 'minutes') - (parseInt(bSum[0].bm) || 0)
      );
      await db.execute(
        `UPDATE attendances SET check_out_time=?, status='early_leave', notes=?, total_minutes=?, updated_at=NOW() WHERE id=?`,
        [now.format('HH:mm:ss'), reason, totalMins, attRows[0].id]
      );
      return success(res, {
        early_leave: true,
        check_out_time: now.format('HH:mm:ss'),
      }, `Early leave recorded at ${now.format('hh:mm A')}`);
    }

    return success(res, { type, allowed_minutes: allowedDuration }, 'Break started.');
  } catch (err) {
    console.error('startBreak error:', err);
    return error(res, 'Server error', 500);
  }
};

// ── End Break ─────────────────────────────────────────────────────────────────
// Matches Laravel AttendanceTrait::handleEndBreak() exactly
exports.endBreak = async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');

    const [attRows] = await db.execute(
      'SELECT id FROM attendances WHERE user_id = ? AND date = ?',
      [req.user.id, today]
    );
    if (!attRows.length) return error(res, 'Not checked in.', 422);

    // Latest open break (matches Laravel: ->latest()->first())
    const [breakRows] = await db.execute(
      'SELECT id, start_time, allowed_duration FROM breaks WHERE attendance_id = ? AND end_time IS NULL ORDER BY id DESC LIMIT 1',
      [attRows[0].id]
    );
    if (!breakRows.length) return error(res, 'No active break found.', 422);

    const brk    = breakRows[0];
    const actual = moment().diff(moment(brk.start_time), 'minutes');

    await db.execute(
      'UPDATE breaks SET end_time=NOW(), actual_duration=?, updated_at=NOW() WHERE id=?',
      [actual, brk.id]
    );

    return success(res, {
      actual_minutes: actual,
      allowed_minutes: brk.allowed_duration,
      over_by: Math.max(0, actual - (brk.allowed_duration || 0)),
    }, `Break ended. Duration: ${actual} min.`);
  } catch (err) {
    console.error('endBreak error:', err);
    return error(res, 'Server error', 500);
  }
};
