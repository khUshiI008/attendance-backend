const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../config/db');
const { success, error } = require('../utils/response');

// All logged-in users can get stores list (for dropdowns)
router.get('/stores', auth, async (req, res) => {
  const [rows] = await db.execute("SELECT id, name, store_code FROM stores WHERE status = 'active' ORDER BY name");
  return success(res, { stores: rows });
});

module.exports = router;