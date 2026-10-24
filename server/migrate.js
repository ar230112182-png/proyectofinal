require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function migrate() {
  const migrationDirectory = path.join(__dirname, '..', 'bd', 'migrations');
  const migrations = fs.readdirSync(migrationDirectory)
    .filter((file) => /^\d{3}_/.test(file) && file.endsWith('.sql'))
    .sort();
  for (const file of migrations) {
    await pool.query(fs.readFileSync(path.join(migrationDirectory, file), 'utf8'));
    console.log(`Migracion ${file} aplicada correctamente.`);
  }
}

migrate()
  .catch((error) => {
    console.error('No se pudieron aplicar las migraciones:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
