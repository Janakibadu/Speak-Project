const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const { createLoginLimiters } = require('./middleware/rateLimit');
const { SESSION_HEADER } = require('./utils/session');
const teacherAuthRoutes = require('./routes/teacherAuth');
const classesRoutes = require('./routes/classes');
const studentsRoutes = require('./routes/students');
const studentAuthRoutes = require('./routes/studentAuth');
const contentRoutes = require('./routes/content');
const modulesRoutes = require('./routes/modules');
const mediaRoutes = require('./routes/media');
const assignmentsRoutes = require('./routes/assignments');
const attemptsRoutes = require('./routes/attempts');
const reportsRoutes = require('./routes/reports');

// Builds the Express app without listening, so tests can drive it with
// Supertest. Each call gets fresh rate-limit counters.
function buildApp() {
  const app = express();

  // Behind Plesk/Passenger's proxy: needed for the real client IP (NFR11).
  app.set('trust proxy', 1);

  app.use(cors({ exposedHeaders: [SESSION_HEADER] }));
  app.use(express.json());

  const limiters = createLoginLimiters();
  app.post('/api/teacher/login', limiters.teacherLoginByIp, limiters.teacherLoginByEmail);
  app.post('/api/student/login', limiters.studentLoginByIp);

  app.use('/api/teacher', teacherAuthRoutes);
  app.use('/api/classes', classesRoutes);
  app.use('/api/student', studentAuthRoutes);
  app.use('/api/content', contentRoutes);
  app.use('/api/modules', modulesRoutes);
  app.use('/api/media', mediaRoutes);
  app.use('/api/assignments', assignmentsRoutes);
  app.use('/api', attemptsRoutes); // exposes /api/attempts*, /api/responses
  app.use('/api', reportsRoutes); // exposes /api/progress, /api/results*
  app.use('/api', studentsRoutes); // exposes /api/classes/:classId/students, /api/students/:id/regenerate-code

  // Unknown API paths get a JSON 404, never the SPA's index.html (NFR14).
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // Hosted deployment (Plesk): serve the built React app from ./public and let
  // React Router handle deep links. Skipped when no build is present (local dev).
  const publicDir = path.join(__dirname, 'public');
  if (fs.existsSync(path.join(publicDir, 'index.html'))) {
    app.use(express.static(publicDir));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  }

  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}

module.exports = buildApp;
