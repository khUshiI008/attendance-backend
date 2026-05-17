const jwt = require('jsonwebtoken');
const db  = require('../config/db');

// Store connected users: userId -> socketId
const connectedUsers = new Map();

module.exports = (io) => {
  // Auth middleware for sockets
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('No token'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const [rows] = await db.execute('SELECT id, name, role, store_id FROM users WHERE id = ?', [decoded.id]);
      if (!rows.length) return next(new Error('User not found'));
      socket.user = rows[0];
      next();
    } catch (e) {
      next(new Error('Auth failed'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    connectedUsers.set(user.id, socket.id);

    // Join store room so managers can see real-time updates
    if (user.store_id) {
      socket.join(`store_${user.store_id}`);
    }
    socket.join(`user_${user.id}`);

    console.log(`✅ ${user.name} (${user.role}) connected`);

    // Manager marks attendance for an employee
    socket.on('manager:mark_attendance', async (data) => {
      // Broadcast to store room so all managers see it live
      io.to(`store_${user.store_id}`).emit('attendance:updated', {
        userId: data.user_id,
        status: data.status,
        timestamp: new Date().toISOString(),
      });
    });

    // Employee checks in — notify managers
    socket.on('employee:checked_in', (data) => {
      io.to(`store_${user.store_id}`).emit('store:employee_checked_in', {
        user_id: user.id,
        name: user.name,
        time: new Date().toISOString(),
        ...data,
      });
    });

    // Leave approved — notify employee
    socket.on('leave:status_changed', (data) => {
      const targetSocket = connectedUsers.get(data.employee_id);
      if (targetSocket) {
        io.to(`user_${data.employee_id}`).emit('leave:notification', {
          status: data.status,
          message: data.status === 'approved' ? 'Your leave has been approved!' : 'Your leave was rejected',
          leave_id: data.leave_id,
        });
      }
    });

    socket.on('disconnect', () => {
      connectedUsers.delete(user.id);
      console.log(`❌ ${user.name} disconnected`);
    });
  });
};