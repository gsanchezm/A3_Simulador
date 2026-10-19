const express = require('express');
const { createPool, initializeDatabase } = require('./server/database');
const { createApp } = require('./server/app');

const db = createPool();
const app = express();
let initialization;

app.use(async (_req, _res, next) => {
  try {
    if (!initialization) {
      initialization = initializeDatabase(db, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
        .catch(error => {
          initialization = undefined;
          throw error;
        });
    }
    await initialization;
    next();
  } catch (error) {
    next(error);
  }
});

app.use(createApp(db, process.env.REPORT_SIGNING_KEY));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'No se pudo iniciar la base de datos' });
});

module.exports = app;
