// @ts-check
'use strict';
/**
 * A QR code's modules for the pairing screen, from the encoder `qrcode-terminal` vendors (the
 * same one Expo's own CLI prints its QR with). The page draws them; no QR library in the bundle.
 */
const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

/**
 * @param {string} text
 * @returns {boolean[][]}
 */
function qrModules(text) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(String(text));
  qr.make();
  const n = qr.getModuleCount();
  /** @type {boolean[][]} */
  const rows = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push(Boolean(qr.isDark(y, x)));
    rows.push(row);
  }
  return rows;
}

module.exports = { qrModules };
