const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const output = path.join(root, 'public');
fs.mkdirSync(output, { recursive: true });
for (const filename of ['index.html', 'app.js', 'styles.css']) {
  fs.copyFileSync(path.join(root, filename), path.join(output, filename));
}
fs.cpSync(path.join(root, 'data'), path.join(output, 'data'), { recursive: true, force: true });
console.log('Archivos públicos preparados en public/');
