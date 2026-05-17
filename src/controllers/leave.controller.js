const db = require('../config/db');
const moment = require('moment');
const { success, error } = require('../utils/response');

// Apply for leave
exports.applyLeave = async (req, res) => {
  try {
    const { date, date_to, type, reason } = req.body;
    const userId = req.user.id;
    const storeId = req.user.store_id;

    if (!date || !reason) return error(res, 'Date and reason are required');

    await db.execute(
      `INSERT INTO leave_requests (user_id, store_id, date, date_to, type, reason, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
      [userId, storeId, date, date_to || null, type || 'full_day', reason]
    );

    return success(res, null, 'Leave request submitted successfully');
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};

// My leaves
exports.myLeaves = async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM leave_requests WHERE user_id = ?';
    const params = [req.user.id];
    if (status) { query += ' AND status = ?'; params.push(status); }
    query += ' ORDER BY created_at DESC';

    const [rows] = await db.execute(query, params);
    return success(res, { leaves: rows });
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};

// Manager: get store's pending leaves
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
    return error(res, 'Server error', 500);
  }
};

// Manager: approve/reject leave
exports.updateLeaveStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;

    if (!['approved', 'rejected'].includes(status)) return error(res, 'Invalid status');

    await db.execute(
      `UPDATE leave_requests SET status = ?, rejection_reason = ?, approved_by = ?, approved_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [status, rejection_reason || null, req.user.id, id]
    );

    return success(res, null, `Leave ${status} successfully`);
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};