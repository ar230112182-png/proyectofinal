require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function migrate() {
  const migrationPath = path.join(__dirname, '..', 'bd', 'migrations', '003_contracts.sql');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  await pool.query(migration);
  console.log('Migracion 003_contracts.sql aplicada correctamente.');
}

migrate()
  .catch((error) => {
    console.error('No se pudo aplicar la migracion de contratos:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
