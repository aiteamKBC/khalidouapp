import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// These packages are compiled into the renderer by Vite. Keep their notices
// in the app even though their duplicate node_modules copies are not shipped.
const require = createRequire(import.meta.url);
const packages = ['react', 'react-dom', 'scheduler', 'sweetalert2'];
const notices = packages.map(name => {
  const manifest = require.resolve(`${name}/package.json`);
  const license = fs.readFileSync(path.join(path.dirname(manifest), 'LICENSE'), 'utf8');
  return `${name}\n${'='.repeat(name.length)}\n${license.trim()}\n`;
});

const destination = new URL('../public/renderer-licenses.txt', import.meta.url);
fs.writeFileSync(destination, `Licenses for libraries bundled in the renderer\n\n${notices.join('\n')}`);
