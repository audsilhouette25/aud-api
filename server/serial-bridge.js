// server/serial-bridge.js (silent, safe, rate-limited)
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

function isHexUid(s) {
  return /^[0-9A-F]{8,32}$/.test(s);
}

async function pickPortPath() {
  const env = process.env.SERIAL_PORT;
  const ports = await SerialPort.list();
  if (env) return env;
  const tty = ports.find(p => /tty\./i.test(p.path)); // macOS, 일부 리눅스
  const cu  = ports.find(p => /cu\./i.test(p.path));  // macOS
  const com = ports.find(p => /COM\d+/i.test(p.path)); // Windows
  return (tty?.path || cu?.path || com?.path || ports[0]?.path) || null;
}

// UID 기준 레이트리밋 (중복 폭주 방지)
const LAST_SEEN = new Map();
const RATE_WINDOW_MS = +(process.env.SERIAL_RATE_MS || 5000);
function accept(uid) {
  const now = Date.now();
  const prev = LAST_SEEN.get(uid) || 0;
  if (now - prev < RATE_WINDOW_MS) return false;
  LAST_SEEN.set(uid, now);
  return true;
}

module.exports = async function attachSerialBridge(io, opts = {}) {
  if (String(process.env.ENABLE_SERIAL || "1") === "0") {
    console.log("[serial] disabled via ENABLE_SERIAL=0");
    return;
  }

  const baudRate = +(process.env.SERIAL_BAUD || 115200);
  const portPath = opts.portPath || await pickPortPath();
  if (!portPath) {
    console.log("[serial] no serial port found");
    return;
  }

  let port;
  try {
    port = new SerialPort({ path: portPath, baudRate });
    console.log(`[serial] opened ${portPath} @ ${baudRate}`);
  } catch (e) {
    console.log("[serial] failed to open:", e?.message || e);
    return;
  }

  const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

  parser.on('data', (line) => {
    const uid = String(line).replace(/\r/g, '').trim().toUpperCase();
    if (!isHexUid(uid)) return;
    if (!accept(uid)) return;

    console.log("[serial] NFC UID:", uid);
    io.emit("nfc", { id: uid, ts: Date.now(), device: 'serial' });
  });

  // 조용한 실패: 에러/종료 시 아무 것도 하지 않음
  port.on('error', (e) => {
    console.log("[serial] error:", e?.message || e);
  });
  port.on('close', () => {
    console.log("[serial] port closed");
  });
};
