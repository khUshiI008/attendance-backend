const router  = require('express').Router();
const auth    = require('../middleware/auth');
const role    = require('../middleware/roleCheck');
const attCtrl = require('../controllers/attendance.controller');
const leaveCtrl = require('../controllers/leave.controller');
const userCtrl = require('../controllers/user.controller');
const dashCtrl = require('../controllers/dashboard.controller');

const EMPLOYEE_ROLES = ['employee', 'manager', 'head_manager', 'hr', 'admin', 'super_admin'];

// Dashboard
router.get('/dashboard', auth, role(...EMPLOYEE_ROLES), dashCtrl.employeeDashboard);

// Attendance
router.get('/attendance/today', auth, role(...EMPLOYEE_ROLES), attCtrl.todayStatus);
router.get('/attendance/history', auth, role(...EMPLOYEE_ROLES), attCtrl.myHistory);
router.post('/attendance/checkin', auth, role(...EMPLOYEE_ROLES), attCtrl.upload.single('selfie'), attCtrl.checkIn);
router.post('/attendance/checkout', auth, role(...EMPLOYEE_ROLES), attCtrl.upload.single('selfie'), attCtrl.checkOut);
router.post('/attendance/break/start', auth, role(...EMPLOYEE_ROLES), attCtrl.startBreak);
router.post('/attendance/break/end', auth, role(...EMPLOYEE_ROLES), attCtrl.endBreak);

// Leaves
router.get('/leaves', auth, role(...EMPLOYEE_ROLES), leaveCtrl.myLeaves);
router.post('/leaves', auth, role(...EMPLOYEE_ROLES), leaveCtrl.applyLeave);

// Profile
router.get('/profile', auth, role(...EMPLOYEE_ROLES), userCtrl.getProfile);
router.put('/profile', auth, role(...EMPLOYEE_ROLES), userCtrl.uploadAvatar.single('avatar'), userCtrl.updateProfile);
router.put('/profile/password', auth, role(...EMPLOYEE_ROLES), userCtrl.changePassword);

module.exports = router;