// aud-api/ble-bridge.js
// 게이트웨이 방식으로 외부에서 UID 수신 → Socket.IO로 브로드캐스트
// (Web Bluetooth는 클라이언트에서 직접 처리)

const debug = (...a) => console.log('[ble]', ...a);

/**
 * BLE 브리지 (현재는 no-op, 게이트웨이 namespace만 제공)
 */
function startBleBridge(io, opts = {}) {
  const { log = true } = opts;
  if (log) debug("bridge ready (Web Bluetooth handles client-side BLE)");
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
