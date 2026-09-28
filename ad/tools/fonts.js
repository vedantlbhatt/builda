'use strict';
// fontkit needs real TTFs to build variable-font instances, so unpack the OFL fonts that
// @fontsource ships as WOFF2 into reel/fonts/.
const wawoff2 = require('wawoff2');
const fs = require('fs');
const path = require('path');
const nm = path.join(__dirname, '..', 'node_modules');
const out = path.join(__dirname, '..', 'fonts');
const FILES = {
  'mono.ttf': '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  'inter.ttf': '@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2',
};
(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const [name, src] of Object.entries(FILES)) {
    const ttf = await wawoff2.decompress(fs.readFileSync(path.join(nm, src)));
    fs.writeFileSync(path.join(out, name), Buffer.from(ttf));
    console.log('fonts/' + name);
  }
})();
