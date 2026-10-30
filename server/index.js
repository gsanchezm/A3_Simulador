const { createPool, initializeDatabase } = require('./database');
const { createApp, parseTrustProxy } = require('./app');

async function main() {
  const db = createPool();
  try {
    if (!process.env.REPORT_SIGNING_KEY || process.env.REPORT_SIGNING_KEY.length < 32) {
      throw new Error('Configura REPORT_SIGNING_KEY con al menos 32 caracteres');
    }
    await initializeDatabase(db, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    const app = createApp(db, process.env.REPORT_SIGNING_KEY, { trustProxy: parseTrustProxy(process.env.TRUST_PROXY) });
    const port = Number(process.env.PORT || 3000);
    app.listen(port, '0.0.0.0', () => console.log(`Simulador disponible en el puerto ${port}`));
  } catch (error) {
    await db.end();
    throw error;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
