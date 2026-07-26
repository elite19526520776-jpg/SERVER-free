export * from './types.js';
export * from './api.js';
export * from './realtime.js';
export * from './utils.js';
export * from './address.js';

// P2P：跨平台部分（不含 node:net 适配，那部分在 @chat/shared/node）
export * from './p2p/socket.js';
export * from './p2p/identity.js';
export * from './p2p/handshake.js';
export * from './p2p/protocol.js';
export * from './p2p/pairing.js';
export * from './p2p/link.js';
