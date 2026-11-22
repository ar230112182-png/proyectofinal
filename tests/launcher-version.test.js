const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');

test('launcher rejects an older server instead of treating it as ready', { skip: process.platform !== 'win32' }, async () => {
  const launcher = fs.readFileSync(path.join(__dirname, '..', 'iniciar.bat'), 'utf8');
  const check = launcher.slice(launcher.lastIndexOf('\n:check_server_version\r\n') + 1);
  assert.ok(check.startsWith(':check_server_version'));
  assert.equal((launcher.match(/call :check_server_version/g) || []).length, 2);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-version-'));
  const script = path.join(directory, 'check.bat');
  fs.writeFileSync(script, `@echo off\r\nset "APP_PORT=%~1"\r\ncall :check_server_version\r\nexit /b %errorlevel%\r\n${check}`);
  let status = 401;
  const server = http.createServer((_request, response) => {
    response.writeHead(status);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const run = () => new Promise((resolve, reject) => {
    execFile(process.env.ComSpec, ['/d', '/c', script, String(server.address().port)], (error) => {
      if (!error) return resolve(0);
      if (typeof error.code === 'number') return resolve(error.code);
      return reject(error);
    });
  });
  try {
    assert.equal(await run(), 0);
    status = 404;
    assert.equal(await run(), 1);
    status = 500;
    assert.equal(await run(), 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.unlinkSync(script);
    fs.rmdirSync(directory);
  }
});
