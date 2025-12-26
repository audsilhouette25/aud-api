// aud-api/ble-bridge.js
// Noble로 BLE 광고 스캔 → Socket.IO로 'ble'/'nfc' 이벤트 브로드캐스트
const noble = require("@abandonware/noble");

const debug = (...a) => console.log('[ble]', ...a);

/** 'UID:' 서명(0x55,0x49,0x44,0x3A) 뒤의 HEX를 ASCII로 읽어내기 */
function extractUIDFromMfg(bytes) {
  if (!bytes || bytes.length < 6) return null;
  const sig = [0x55, 0x49, 0x44, 0x3A]; // 'U','I','D',':'
  for (let i = 0; i <= bytes.length - sig.length; i++) {
    if (bytes[i]===sig[0] && bytes[i+1]===sig[1] && bytes[i+2]===sig[2] && bytes[i+3]===sig[3]) {
      let out = "";
      for (let k = i + sig.length; k < bytes.length; k++) {
        const c = bytes[k];
        if ((c>=0x30&&c<=0x39)||(c>=0x41&&c<=0x46)||(c>=0x61&&c<=0x66)) {
          out += String.fromCharCode(c).toUpperCase();
        } else break;
      }
      return out || null;
    }
  }
  return null;
}

/** 'IDLE' 문자열 감지 */
function isIdleBeacon(bytes) {
  if (!bytes || bytes.length < 6) return false;
  const idleSig = [0x49, 0x44, 0x4C, 0x45]; // 'I','D','L','E'
  for (let i = 0; i <= bytes.length - idleSig.length; i++) {
    if (bytes[i]===idleSig[0] && bytes[i+1]===idleSig[1] && bytes[i+2]===idleSig[2] && bytes[i+3]===idleSig[3]) {
      return true;
    }
  }
  return false;
}

// UID 기준 레이트리밋 (중복 폭주 방지)
const LAST_SEEN = new Map();
const RATE_WINDOW_MS = 5000;
function acceptUID(uid) {
  const now = Date.now();
  const prev = LAST_SEEN.get(uid) || 0;
  if (now - prev < RATE_WINDOW_MS) return false;
  LAST_SEEN.set(uid, now);
  return true;
}

/**
 * BLE 브리지를 시작한다.
 * @param {import('socket.io').Server} io
 * @param {{companyIdLE?: number, log?: boolean}} [opts]
 */
function startBleBridge(io, opts = {}) {
  const { companyIdLE = 0xFFFF, log = true } = opts;

  if (String(process.env.ENABLE_BLE || "1") === "0") {
    if (log) debug("disabled via ENABLE_BLE=0");
    return;
  }

  noble.on("stateChange", async (st) => {
    if (log) debug("adapter state:", st);
    if (st === "poweredOn") {
      try {
        await noble.startScanningAsync([], true); // duplicates 허용
        if (log) debug("scanning started");
      } catch (e) {
        if (log) debug("startScanning error:", e?.message || e);
      }
    } else {
      try { noble.stopScanning(); } catch {}
    }
  });

  noble.on("discover", (peripheral) => {
    const mfg = peripheral.advertisement?.manufacturerData; // Buffer
    if (!mfg || !mfg.length) return;

    // CompanyID(LE, 처음 2바이트) 필터
    if (mfg.length < 2) return;
    const idLE = mfg[0] | (mfg[1] << 8);
    if (idLE !== companyIdLE) return;

    const bytes = Array.from(mfg);

    // IDLE 비콘은 무시
    if (isIdleBeacon(bytes)) return;

    // UID 추출
    const uid = extractUIDFromMfg(bytes);
    if (!uid) return;

    // 레이트리밋 체크
    if (!acceptUID(uid)) return;

    if (log) debug("UID:", uid, "from", peripheral.address || "unknown");

    // 클라이언트로 전송 (ble + nfc 둘 다)
    io.emit("ble", { bytes, uid });
    io.emit("nfc", { id: uid, ts: Date.now(), device: "ble" });
  });

  noble.on("warning", (msg) => {
    if (log) debug("warning:", msg);
  });

  if (log) debug("bridge initialized (companyId:", "0x" + companyIdLE.toString(16) + ")");
}

// 레거시 호환: 게이트웨이 namespace 방식도 유지
function attachBleNamespaces(io, { gatewayToken }) {
  const stream = io.of('/stream');
  stream.on('connection', (s) => {
    debug('browser connected /stream');
    s.emit('hello', { ok: true });
  });

  const gw = io.of('/gw');
  gw.use((socket, next) => {
    const token = socket.handshake?.auth?.token
      || socket.handshake?.query?.token
      || socket.handshake?.headers?.['x-gateway-token'];
    if (token !== gatewayToken) return next(new Error('unauthorized'));
    next();
  });
  gw.on('connection', (s) => {
    debug('gateway connected /gw');
    s.on('uid', (payload) => {
      if (!payload?.uid) return;
      stream.emit('uid', payload);
    });
  });
}

module.exports = { startBleBridge, attachBleNamespaces, extractUIDFromMfg };
