const success = (res, data, message = 'Success', code = 200) => {
  return res.status(code).json({ success: true, message, data });
};

const error = (res, message = 'Error', code = 400, errors = null) => {
  return res.status(code).json({ success: false, message, errors });
};

module.exports = { success, error };