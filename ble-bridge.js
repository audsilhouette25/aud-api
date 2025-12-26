// aud-api/ble-bridge.js
// 라즈베리파이 게이트웨이에서 UID 수신 → Socket.IO로 브라우저에 브로드캐스트
//
// 구조:
//   [ESP32 BLE 비콘] → [라즈베리파이 gateway.js] → [Render 서버 /gw] → [브라우저 nfc 이벤트]

const debug = (...a) => console.log('[ble]', ...a);

/**
 * BLE 브리지 초기화 (게이트웨이 전용)
 */
function startBleBridge(io, opts = {}) {
  const { log = true } = opts;
  if (log) debug("bridge ready (Raspberry Pi gateway mode)");
}

/**
 * 게이트웨이 namespace: 외부 게이트웨이가 UID를 전송하면 브라우저로 재방송
 */
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
      // 메인 namespace로도 전송
      io.emit('nfc', { id: payload.uid, ts: Date.now(), device: 'gateway' });
    });
  });
}

module.exports = { startBleBridge, attachBleNamespaces };
