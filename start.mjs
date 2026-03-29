import KimDBServer from './dist/server/index.js';
const server = new KimDBServer();
process.on('SIGINT', async () => { await server.stop(); process.exit(0); });
process.on('SIGTERM', async () => { await server.stop(); process.exit(0); });
server.start().catch((e) => { console.error('[kimdb] Failed to start:', e); process.exit(1); });
