const { randomBytes } = require('crypto');

function uuidv7() {
  const now = BigInt(Date.now());

  // 48-bit millisecond timestamp
  const tsHex = now.toString(16).padStart(12, '0');

  const rand = randomBytes(10);

  // version nibble = 7, 12-bit rand_a
  const ver     = 0x7000;
  const randA   = ((rand[0] & 0x0f) << 8) | rand[1];
  const verHex  = (ver | randA).toString(16).padStart(4, '0');

  // RFC 4122 variant: 0b10xx xxxx
  rand[2] = (rand[2] & 0x3f) | 0x80;

  const varHex   = rand.slice(2, 4).toString('hex');
  const clockHex = rand.slice(4, 10).toString('hex');

  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-${verHex}-${varHex}-${clockHex}`;
}

module.exports = { uuidv7 };
