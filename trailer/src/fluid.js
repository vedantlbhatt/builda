'use strict';
/**
 * The fluid is the app's (mobile/src/motion/fluid.ts): the phone's ink field and the trailer's
 * wipes and plumes run the same solver. Loaded as TypeScript, as the springs are (house.js).
 */
const path = require('path');

module.exports = require(path.join(__dirname, '..', '..', 'mobile', 'src', 'motion', 'fluid.ts'));
