/**
 * 🤖 KIMDB AI API - 5000명 AI 관리 API
 * REST 엔드포인트로 AI 조회/관리/상호작용
 */
import { FastifyInstance } from 'fastify';
import { PersonalityType } from './ai-schema.js';
export interface AIQueryParams {
    team?: 'CODE1' | 'CODE2' | 'CODE3' | 'CODE4';
    personality?: PersonalityType;
    status?: 'active' | 'idle' | 'busy' | 'maintenance' | 'offline';
    experience?: 'junior' | 'mid' | 'senior' | 'expert';
    skill?: string;
    limit?: number;
    offset?: number;
}
export interface AIChatRequest {
    message: string;
    context?: string;
    userId?: string;
}
export interface AIChatResponse {
    response: string;
    aiId: string;
    aiName: string;
    personality: string;
    responseTime: number;
    timestamp: Date;
}
export interface AITaskRequest {
    type: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    deadline?: Date;
    requirements?: string[];
}
export interface AIStatsResponse {
    total: number;
    byTeam: Record<string, number>;
    byPersonality: Record<PersonalityType, number>;
    byStatus: Record<string, number>;
    byExperience: Record<string, number>;
    averageSkills: {
        technical: Record<string, number>;
        soft: Record<string, number>;
    };
}
/**
 * AI 시스템 API 라우터 등록
 */
export declare function registerAIRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=ai-api.d.ts.map