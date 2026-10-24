(function exposeMassageFeedbackQr(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MassageFeedbackQr = api;
})(typeof window !== "undefined" ? window : globalThis, function createMassageFeedbackQr() {
  "use strict";

  const SIZE = 21;
  const DATA_CODEWORDS = 19;
  const ECC_CODEWORDS = 7;
  const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

  function appendBits(bits, value, length) {
    for (let shift = length - 1; shift >= 0; shift -= 1) {
      bits.push((value >>> shift) & 1);
    }
  }

  function multiplyInField(left, right) {
    let result = 0;
    while (right > 0) {
      if (right & 1) result ^= left;
      left <<= 1;
      if (left & 0x100) left ^= 0x11d;
      right >>>= 1;
    }
    return result;
  }

  function reedSolomonGenerator(degree) {
    let polynomial = [1];
    let root = 1;
    for (let index = 0; index < degree; index += 1) {
      const next = Array(polynomial.length + 1).fill(0);
      for (let coefficient = 0; coefficient < polynomial.length; coefficient += 1) {
        next[coefficient] ^= polynomial[coefficient];
        next[coefficient + 1] ^= multiplyInField(polynomial[coefficient], root);
      }
      polynomial = next;
      root = multiplyInField(root, 2);
    }
    return polynomial;
  }

  function errorCorrection(data, degree) {
    const generator = reedSolomonGenerator(degree);
    const remainder = Array(degree).fill(0);
    for (const value of data) {
      const factor = value ^ remainder[0];
      remainder.shift();
      remainder.push(0);
      for (let index = 0; index < degree; index += 1) {
        remainder[index] ^= multiplyInField(generator[index + 1], factor);
      }
    }
    return remainder;
  }

  function encodeData(text) {
    const normalized = String(text).trim().toUpperCase();
    if (!normalized || normalized.length > 25 || [...normalized].some(character => !ALPHANUMERIC.includes(character))) {
      throw new TypeError("QR text must contain 1–25 QR alphanumeric characters.");
    }

    const bits = [];
    appendBits(bits, 0b0010, 4);
    appendBits(bits, normalized.length, 9);
    for (let index = 0; index + 1 < normalized.length; index += 2) {
      const first = ALPHANUMERIC.indexOf(normalized[index]);
      const second = ALPHANUMERIC.indexOf(normalized[index + 1]);
      appendBits(bits, first * 45 + second, 11);
    }
    if (normalized.length % 2 === 1) {
      appendBits(bits, ALPHANUMERIC.indexOf(normalized.at(-1)), 6);
    }
    appendBits(bits, 0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);

    const data = [];
    for (let offset = 0; offset < bits.length; offset += 8) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | bits[offset + bit];
      data.push(byte);
    }
    for (let pad = 0; data.length < DATA_CODEWORDS; pad += 1) {
      data.push(pad % 2 === 0 ? 0xec : 0x11);
    }
    return [...data, ...errorCorrection(data, ECC_CODEWORDS)];
  }

  function createMatrix(text) {
    const codewords = encodeData(text);
    const matrix = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
    const functionModules = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));

    function setFunction(x, y, dark) {
      matrix[y][x] = dark;
      functionModules[y][x] = true;
    }

    function drawFinder(left, top) {
      for (let dy = -1; dy <= 7; dy += 1) {
        for (let dx = -1; dx <= 7; dx += 1) {
          const x = left + dx;
          const y = top + dy;
          if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) continue;
          const inFinder = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
          const dark = inFinder && (
            dx === 0 || dx === 6 || dy === 0 || dy === 6
            || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)
          );
          setFunction(x, y, dark);
        }
      }
    }

    for (let index = 8; index < SIZE - 8; index += 1) {
      setFunction(6, index, index % 2 === 0);
      setFunction(index, 6, index % 2 === 0);
    }
    drawFinder(0, 0);
    drawFinder(SIZE - 7, 0);
    drawFinder(0, SIZE - 7);

    function drawFormat() {
      // Error-correction level L is encoded as 01; use mask pattern 0.
      const formatData = (0b01 << 3);
      let remainder = formatData;
      for (let index = 0; index < 10; index += 1) {
        remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
      }
      const formatBits = ((formatData << 10) | remainder) ^ 0x5412;
      for (let index = 0; index <= 5; index += 1) {
        setFunction(8, index, ((formatBits >>> index) & 1) !== 0);
      }
      setFunction(8, 7, ((formatBits >>> 6) & 1) !== 0);
      setFunction(8, 8, ((formatBits >>> 7) & 1) !== 0);
      setFunction(7, 8, ((formatBits >>> 8) & 1) !== 0);
      for (let index = 9; index < 15; index += 1) {
        setFunction(14 - index, 8, ((formatBits >>> index) & 1) !== 0);
      }
      for (let index = 0; index < 8; index += 1) {
        setFunction(SIZE - 1 - index, 8, ((formatBits >>> index) & 1) !== 0);
      }
      for (let index = 8; index < 15; index += 1) {
        setFunction(8, SIZE - 15 + index, ((formatBits >>> index) & 1) !== 0);
      }
      setFunction(8, SIZE - 8, true);
    }
    drawFormat();

    let bitIndex = 0;
    for (let right = SIZE - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const upward = ((right + 1) & 2) === 0;
      for (let vertical = 0; vertical < SIZE; vertical += 1) {
        const y = upward ? SIZE - 1 - vertical : vertical;
        for (let offset = 0; offset < 2; offset += 1) {
          const x = right - offset;
          if (functionModules[y][x]) continue;
          const codewordBit = bitIndex < codewords.length * 8
            ? (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1
            : 0;
          matrix[y][x] = (codewordBit ^ (x + y) % 2) !== 0;
          bitIndex += 1;
        }
      }
    }

    return matrix;
  }

  function createSvg(text) {
    const normalized = String(text).trim().toUpperCase();
    const matrix = createMatrix(normalized);
    const quietZone = 4;
    const path = [];
    matrix.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) path.push(`M${x + quietZone} ${y + quietZone}h1v1h-1z`);
    }));
    const viewSize = SIZE + quietZone * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" role="img" aria-label="QR-kod för sessionskod ${normalized}" shape-rendering="crispEdges"><rect width="${viewSize}" height="${viewSize}" fill="#fff"/><path d="${path.join("")}" fill="#111"/></svg>`;
  }

  return Object.freeze({ createMatrix, createSvg });
});
