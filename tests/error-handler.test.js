const test = require('node:test');
const assert = require('node:assert/strict');
const errorHandler = require('../server/error-handler');

function handle(error) {
  const response = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    errorHandler(error, {}, response, () => {});
  } finally {
    console.error = originalError;
  }
  return response;
}

test('malformed JSON receives a client error without exposing parser details', () => {
  const response = handle({ type: 'entity.parse.failed', message: 'private parser detail' });
  assert.equal(response.statusCode, 400);
  assert.doesNotMatch(response.payload.error, /private parser detail/);
});

test('oversized uploads preserve the 413 response', () => {
  const response = handle({ code: 'LIMIT_FILE_SIZE' });
  assert.equal(response.statusCode, 413);
  assert.match(response.payload.error, /10 MB/);
});

test('unsupported uploads preserve the validation response', () => {
  const response = handle({ message: 'Tipo de archivo no permitido.' });
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.error, 'Tipo de archivo no permitido.');
});

test('unexpected errors remain generic server failures', () => {
  const response = handle(new Error('database connection detail'));
  assert.equal(response.statusCode, 500);
  assert.doesNotMatch(response.payload.error, /database connection detail/);
});
