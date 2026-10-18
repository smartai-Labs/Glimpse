const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/manifest.json'), 'utf8'));
assert.equal(manifest.version, version);
assert.deepEqual(manifest, JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.json'), 'utf8')));
const files = ['overview/index.html', manifest.background.service_worker, ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(script => script.js)];
for (const file of files) {
  const resolved = path.resolve(root, 'dist', file);
  assert(resolved.startsWith(path.join(root, 'dist') + path.sep)); assert(fs.statSync(resolved).size > 0, file);
}
assert(!fs.existsSync(path.join(root, 'dist/node_modules')));
console.log('PASS: version ' + version + ', manifest and extension entry files.');
