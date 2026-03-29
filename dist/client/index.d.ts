/**
 * kimdb Client
 *
 * 브라우저/Node.js 클라이언트
 */
import { CRDTDocument, UndoManager } from '../crdt/index.js';
export interface KimDBClientOptions {
    url: string;
    apiKey?: string;
    autoReconnect?: boolean;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
    batchSize?: number;
    batchTimeout?: number;
}
export interface ConnectionState {
    connected: boolean;
    clientId: string | null;
    serverId: string | null;
    reconnectAttempts: number;
}
type MessageHandler = (msg: unknown) => void;
export declare class KimDBClient {
    private options;
    private ws;
    private state;
    private subscriptions;
    private docSubscriptions;
    private messageHandlers;
    private batcher;
    private undoManagers;
    private presenceManager;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (error: Error) => void;
    onSync?: (collection: string, event: string, data: unknown) => void;
    constructor(options: KimDBClientOptions);
    connect(): Promise<void>;
    disconnect(): void;
    private send;
    private sendBatch;
    private handleMessage;
    on(type: string, handler: MessageHandler): void;
    off(type: string, handler: MessageHandler): void;
    subscribe(collection: string): void;
    unsubscribe(collection: string): void;
    openDocument(collection: string, docId: string): Promise<CRDTDocument>;
    closeDocument(collection: string, docId: string): void;
    set(collection: string, docId: string, path: string | string[], value: unknown): void;
    get(collection: string, docId: string, path: string | string[]): unknown;
    getUndoManager(collection: string, docId: string): UndoManager;
    undo(collection: string, docId: string): void;
    redo(collection: string, docId: string): void;
    joinPresence(collection: string, docId: string, user: {
        name: string;
        color?: string;
    }): Promise<void>;
    leavePresence(collection: string, docId: string): void;
    updatePresence(cursor: {
        position: number;
        selection?: {
            start: number;
            end: number;
        } | null;
    }): void;
    private get httpUrl();
    private httpFetch;
    /** REST: 컬렉션 문서 목록 조회 */
    list(collection: string): Promise<{
        docs: Array<{
            id: string;
            data: unknown;
            _version: number;
        }>;
    }>;
    /** REST: 단일 문서 조회 */
    getDoc(collection: string, id: string): Promise<{
        id: string;
        data: unknown;
        _version: number;
    }>;
    /** REST: 문서 생성 (ID 자동 생성) */
    create(collection: string, data: unknown): Promise<{
        success: boolean;
        id: string;
        _version: number;
    }>;
    /** REST: 문서 저장 (upsert) */
    save(collection: string, id: string, data: unknown): Promise<{
        success: boolean;
        id: string;
        _version: number;
    }>;
    /** REST: 문서 부분 업데이트 */
    update(collection: string, id: string, data: unknown): Promise<{
        success: boolean;
        id: string;
        _version: number;
    }>;
    /** REST: 문서 삭제 */
    remove(collection: string, id: string): Promise<{
        success: boolean;
    }>;
    get isConnected(): boolean;
    get clientId(): string | null;
    get serverId(): string | null;
}
export default KimDBClient;
//# sourceMappingURL=index.d.ts.map