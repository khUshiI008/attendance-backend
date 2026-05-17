const { error } = require('../utils/response');

const roleCheck = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return error(res, 'Access denied', 403);
  }
  next();
};

module.exports = roleCheck;