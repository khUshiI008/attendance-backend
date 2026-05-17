require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const authRoutes      = require('./src/routes/auth.routes');
const employeeRoutes  = require('./src/routes/employee.routes');
const managerRoutes   = require('./src/routes/manager.routes');
const adminRoutes     = require('./src/routes/admin.routes');
const sharedRoutes    = require('./src/routes/shared.routes');
const socketHandlers  = require('./src/socket/handlers');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static file serving — same uploads folder as Laravel
app.use('/storage', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth',     authRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/manager',  managerRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api',          sharedRoutes);

// Socket.io
socketHandlers(io);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Puma API running on port ${PORT}`);
});

module.exports = { app, io };