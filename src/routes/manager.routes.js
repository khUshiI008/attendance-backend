const router    = require('express').Router();
const auth      = require('../middleware/auth');
const role      = require('../middleware/roleCheck');
const leaveCtrl = require('../controllers/leave.controller');
const dashCtrl  = require('../controllers/dashboard.controller');
const db        = require('../config/db');
const { success, error } = require('../utils/response');
const moment    = require('moment');

const MGR_ROLES = ['manager', 'head_manager', 'hr', 'admin', 'super_admin'];

router.get('/dashboard', auth, role(...MGR_ROLES), dashCtrl.managerDashboard);

// Store attendance
router.get('/attendance', auth, role(...MGR_ROLES), async (req, res) => {
  const { date } = req.query;
  const d = date || moment().format('YYYY-MM-DD');
  const [rows] = await db.execute(
    `SELECT a.*, u.name, u.employee_code, u.designation FROM attendances a
     JOIN users u ON u.id = a.user_id
     WHERE a.store_id = ? AND a.date = ? ORDER BY a.check_in_time ASC`,
    [req.user.store_id, d]
  );
  return success(res, { records: rows, date: d });
});

// Employees in store
router.get('/employees', auth, role(...MGR_ROLES), async (req, res) => {
  const [rows] = await db.execute(
    `SELECT id, name, email, employee_code, designation, phone, avatar, status
     FROM users WHERE store_id = ? AND status = 'active' ORDER BY name`,
    [req.user.store_id]
  );
  return success(res, { employees: rows });
});

// Leaves
router.get('/leaves/pending', auth, role(...MGR_ROLES), leaveCtrl.storePendingLeaves);
router.put('/leaves/:id', auth, role(...MGR_ROLES), leaveCtrl.updateLeaveStatus);

module.exports = router;