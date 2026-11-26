const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('property dimension migration is idempotent and uses bounded numeric columns', {
  skip: process.env.TEST_PROPERTY_DB !== '1',
}, async () => {
  require('dotenv').config();
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must point to the confirmed test database');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'bd', 'migrations', '015_property_dimensions.sql'),
    'utf8',
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(migration);
    await client.query(migration);
    const { rows } = await client.query(`
      SELECT column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'propiedades'
        AND column_name IN ('frente_metros', 'fondo_metros')
      ORDER BY column_name
    `);
    assert.deepEqual(rows, [
      { column_name: 'fondo_metros', data_type: 'numeric', numeric_precision: 10, numeric_scale: 2 },
      { column_name: 'frente_metros', data_type: 'numeric', numeric_precision: 10, numeric_scale: 2 },
    ]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
