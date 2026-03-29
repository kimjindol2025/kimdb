/**
 * kimdb - 고성능 데이터베이스 설정
 * 커넥션 풀링 + 성능 최적화
 */
import Database from 'better-sqlite3';
declare class DatabasePool {
    private pool;
    private inUse;
    private dbPath;
    private maxConnections;
    constructor(dbPath: string, maxConnections?: number);
    private initPool;
    private createConnection;
    acquire(): Database.Database;
    release(db: Database.Database): void;
    transaction<T>(fn: (db: Database.Database) => T): Promise<T>;
    query<T>(sql: string, params?: any[]): T[];
    get<T>(sql: string, params?: any[]): T | undefined;
    run(sql: string, params?: any[]): Database.RunResult;
    search(query: string, limit?: number): any[];
    stats(): {
        poolSize: number;
        inUse: number;
        available: number;
    };
    close(): void;
}
export declare const dbPool: DatabasePool;
export default dbPool;
//# sourceMappingURL=db.d.ts.map