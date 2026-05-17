const db     = require('../config/db');
const moment = require('moment');
const { success, error } = require('../utils/response');

exports.employeeDashboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const today  = moment().format('YYYY-MM-DD');
    const month  = moment().month() + 1;
    const year   = moment().year();

    const [[todayAtt], [monthStats], [pendingLeaves]] = await Promise.all([
      db.execute('SELECT * FROM attendances WHERE user_id = ? AND date = ? LIMIT 1', [userId, today]),
      db.execute(
        `SELECT
          COUNT(*) as total_days,
          SUM(CASE WHEN status IN ('present','late','early_leave') THEN 1 ELSE 0 END) as present_days,
          SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_days,
          SUM(total_minutes) as total_minutes
         FROM attendances WHERE user_id = ? AND MONTH(date) = ? AND YEAR(date) = ?`,
        [userId, month, year]
      ),
      db.execute(
        "SELECT COUNT(*) as count FROM leave_requests WHERE user_id = ? AND status = 'pending'",
        [userId]
      ),
    ]);

    return success(res, {
      today: todayAtt[0] || null,
      month_stats: monthStats[0],
      pending_leaves: pendingLeaves[0].count,
    });
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};

exports.managerDashboard = async (req, res) => {
  try {
    const storeId = req.user.store_id;
    const today   = moment().format('YYYY-MM-DD');

    const [[todayStats], [pendingLeaves], [employees]] = await Promise.all([
      db.execute(
        `SELECT
          COUNT(*) as total_present,
          SUM(CASE WHEN check_out_time IS NULL THEN 1 ELSE 0 END) as still_in,
          SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_count
         FROM attendances WHERE store_id = ? AND date = ?`,
        [storeId, today]
      ),
      db.execute(
        "SELECT COUNT(*) as count FROM leave_requests WHERE store_id = ? AND status = 'pending'",
        [storeId]
      ),
      db.execute(
        "SELECT COUNT(*) as count FROM users WHERE store_id = ? AND status = 'active'",
        [storeId]
      ),
    ]);

    return success(res, {
      today: todayStats[0],
      pending_leaves: pendingLeaves[0].count,
      total_employees: employees[0].count,
    });
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};