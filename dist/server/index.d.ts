/**
 * kimdb Server
 *
 * 메인 서버 진입점
 */
import { type Config } from './config.js';
declare const VERSION = "7.0.0";
export declare class KimDBServer {
    private config;
    private db;
    private fastify;
    private clients;
    private subscriptions;
    private docSubscriptions;
    private crdtDocs;
    private presenceManagers;
    private clientPresence;
    private clientUndoManagers;
    private metrics;
    private cleanupTimer?;
    private checkpointTimer?;
    constructor(config?: Partial<Config>);
    private generateClientId;
    private getCRDTDoc;
    private saveCRDTToDB;
    private getPresenceManager;
    private getClientUndoManager;
    private localBroadcast;
    private localBroadcastToDoc;
    private broadcastOp;
    private requireAuth;
    private handleClientDisconnect;
    private runCleanup;
    start(): Promise<void>;
    private registerRoutes;
    private registerWebSocket;
    private handleWebSocketMessage;
    private executeSQL;
    stop(): Promise<void>;
}
export { VERSION };
export default KimDBServer;
//# sourceMappingURL=index.d.ts.map