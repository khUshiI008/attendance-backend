const db     = require('../config/db');
const moment = require('moment');
const { success, error } = require('../utils/response');

// Valid types — must match Laravel's LeaveRequest::TYPES exactly
const VALID_TYPES = ['week_off', 'full_day', 'half_day', 'early_leave'];

// Apply for leave
// Matches Laravel Employee\LeaveController::store() exactly
exports.applyLeave = async (req, res) => {
  try {
    const { date, date_to, type, reason } = req.body;
    const userId  = req.user.id;
    const storeId = req.user.store_id;

    if (!date) return error(res, 'Date is required', 422);
    if (!type || !VALID_TYPES.includes(type)) {
      return error(res, `Invalid leave type. Must be one of: ${VALID_TYPES.join(', ')}`, 422);
    }

    // reason is optional only for week_off (defaults to 'Week Off') — matches Laravel
    if (type !== 'week_off' && !reason) {
      return error(res, 'Reason is required', 422);
    }

    const isWeekOff    = type === 'week_off';
    let   status       = 'pending';
    let   weekOffAuto  = false;
    let   approvedAt   = null;

    if (isWeekOff) {
      // Mon–Thu (ISO weekday 1–4) → auto approved (matches Laravel LeaveRequest::isWeekOffAutoApproved)
      const dayIso = moment(date).isoWeekday(); // 1=Mon … 7=Sun
      if (dayIso >= 1 && dayIso <= 4) {
        status      = 'approved';
        weekOffAuto = true;
        approvedAt  = moment().format('YYYY-MM-DD HH:mm:ss');
      }
      // Fri–Sun → stays pending, manually approved
    }

    const finalReason = reason || (isWeekOff ? 'Week Off' : '');

    await db.execute(
      `INSERT INTO leave_requests
         (user_id, store_id, date, date_to, type, reason, status, week_off_auto, approved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [userId, storeId, date, date_to || null, type, finalReason, status, weekOffAuto ? 1 : 0, approvedAt]
    );

    const msg = (isWeekOff && weekOffAuto)
      ? 'Week off marked and auto-approved.'
      : 'Leave request submitted. Pending approval.';
    return success(res, { status, week_off_auto: weekOffAuto }, msg);
  } catch (err) {
    console.error('applyLeave error:', err);
    return error(res, 'Server error', 500);
  }
};

// My leaves
exports.myLeaves = async (req, res) => {
  try {
    const { status } = req.query;
    let query  = 'SELECT * FROM leave_requests WHERE user_id = ?';
    const params = [req.user.id];
    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC';

    const [rows] = await db.execute(query, params);
    return success(res, { leaves: rows });
  } catch (err) {
    console.error('myLeaves error:', err);
    return error(res, 'Server error', 500);
  }
};

// Manager: pending leaves for store
exports.storePendingLeaves = async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const [rows] = await db.execute(
      `SELECT lr.*, u.name as user_name, u.employee_code FROM leave_requests lr
       JOIN users u ON u.id = lr.user_id
       WHERE lr.store_id = ? AND lr.status = 'pending'
       ORDER BY lr.created_at DESC`,
      [storeId]
    );
    return success(res, { leaves: rows });
  } catch (err) {
    console.error('storePendingLeaves error:', err);
    return error(res, 'Server error', 500);
  }
};

// Manager: approve/reject leave
exports.updateLeaveStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;

    if (!['approved', 'rejected'].includes(status)) return error(res, 'Invalid status', 422);

    await db.execute(
      `UPDATE leave_requests
         SET status=?, rejection_reason=?, approved_by=?, approved_at=NOW(), updated_at=NOW()
       WHERE id=?`,
      [status, rejection_reason || null, req.user.id, id]
    );
    return success(res, null, `Leave ${status} successfully`);
  } catch (err) {
    console.error('updateLeaveStatus error:', err);
    return error(res, 'Server error', 500);
  }
};
