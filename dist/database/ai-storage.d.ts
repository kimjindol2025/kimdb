/**
 * 🗄️ KIMDB AI Storage - 5000명 AI 영구 저장
 * SQLite 기반 완전 자체 구현 저장소
 */
import { SimpleAI } from '../ai-system/ai-simple.js';
export interface StoredAI extends SimpleAI {
    storedAt: Date;
    version: number;
    lastInteraction?: Date;
    totalInteractions: number;
}
export interface AIInteraction {
    id: string;
    aiId: string;
    userId?: string;
    message: string;
    response: string;
    timestamp: Date;
    responseTime: number;
}
export interface AICollection {
    id: string;
    name: string;
    description: string;
    aiIds: string[];
    createdAt: Date;
    tags: string[];
}
export declare class AIDatabase {
    private db;
    private dbPath;
    constructor();
    /**
     * 데이터베이스 테이블 초기화
     */
    private initializeTables;
    /**
     * 5000명 AI를 데이터베이스에 저장
     */
    saveAIs(ais: SimpleAI[]): Promise<void>;
    /**
     * AI 조회 (필터 지원)
     */
    getAIs(options?: {
        team?: string;
        personality?: string;
        status?: string;
        limit?: number;
        offset?: number;
        skills?: string;
    }): Promise<StoredAI[]>;
    /**
     * 특정 AI 조회
     */
    getAI(id: string): Promise<StoredAI | null>;
    /**
     * AI 상호작용 저장
     */
    saveInteraction(interaction: {
        aiId: string;
        userId?: string;
        message: string;
        response: string;
        responseTime: number;
    }): Promise<string>;
    /**
     * AI 상호작용 기록 조회
     */
    getInteractions(aiId: string, limit?: number): Promise<AIInteraction[]>;
    /**
     * AI 컬렉션 생성 (그룹화)
     */
    createCollection(collection: {
        name: string;
        description?: string;
        aiIds: string[];
        tags?: string[];
    }): Promise<string>;
    /**
     * 통계 정보
     */
    getStats(): Promise<{
        totalAIs: number;
        byTeam: Record<string, number>;
        byPersonality: Record<string, number>;
        byStatus: Record<string, number>;
        totalInteractions: number;
        averageInteractionsPerAI: number;
        mostActiveAI?: {
            id: string;
            name: string;
            interactions: number;
        };
    }>;
    /**
     * AI 검색 (스킬, 이름, 성격 기반)
     */
    searchAIs(query: string, limit?: number): Promise<StoredAI[]>;
    /**
     * 데이터베이스 정보
     */
    getDatabaseInfo(): {
        path: string;
        size: number;
        tables: string[];
        pragma: any;
    };
    private getDatabaseSize;
    /**
     * 데이터베이스 연결 종료
     */
    close(): void;
}
export declare const aiDatabase: AIDatabase;
//# sourceMappingURL=ai-storage.d.ts.map