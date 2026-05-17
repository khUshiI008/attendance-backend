const router   = require('express').Router();
const auth     = require('../middleware/auth');
const role     = require('../middleware/roleCheck');
const userCtrl = require('../controllers/user.controller');
const db       = require('../config/db');
const { success, error } = require('../utils/response');

const ADMIN_ROLES = ['admin', 'super_admin', 'hr', 'head_manager'];

// Users CRUD
router.get('/users', auth, role(...ADMIN_ROLES), userCtrl.listUsers);
router.post('/users', auth, role(...ADMIN_ROLES), userCtrl.createUser);
router.put('/users/:id', auth, role(...ADMIN_ROLES), async (req, res) => {
  const { name, email, phone, role: userRole, store_id, designation, employee_code, status } = req.body;
  await db.execute(
    `UPDATE users SET name=?, email=?, phone=?, role=?, store_id=?, designation=?, employee_code=?, status=?, updated_at=NOW()
     WHERE id=?`,
    [name, email, phone, userRole, store_id, designation, employee_code, status, req.params.id]
  );
  return success(res, null, 'User updated');
});

// Stores
router.get('/stores', auth, role(...ADMIN_ROLES), async (req, res) => {
  const [rows] = await db.execute('SELECT * FROM stores ORDER BY name');
  return success(res, { stores: rows });
});
router.post('/stores', auth, role('admin', 'super_admin'), async (req, res) => {
  const { name, store_code, brand, address, latitude, longitude, radius, phone, email } = req.body;
  await db.execute(
    `INSERT INTO stores (name, store_code, brand, address, latitude, longitude, radius, phone, email, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())`,
    [name, store_code, brand, address, latitude, longitude, radius || 100, phone, email]
  );
  return success(res, null, 'Store created', 201);
});
router.put('/stores/:id', auth, role('admin', 'super_admin'), async (req, res) => {
  const { name, store_code, brand, address, latitude, longitude, radius, phone, email, status } = req.body;
  await db.execute(
    `UPDATE stores SET name=?, store_code=?, brand=?, address=?, latitude=?, longitude=?, radius=?, phone=?, email=?, status=?, updated_at=NOW()
     WHERE id=?`,
    [name, store_code, brand, address, latitude, longitude, radius, phone, email, status, req.params.id]
  );
  return success(res, null, 'Store updated');
});

module.exports = router;