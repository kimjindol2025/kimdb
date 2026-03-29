/**
 * 🤖 KIMDB AI Simple System - 빠른 5000명 AI 등록
 */
export interface SimpleAI {
    id: string;
    name: string;
    team: 'CODE1' | 'CODE2' | 'CODE3' | 'CODE4';
    port: number;
    personality: string;
    skills: string[];
    status: 'active' | 'idle' | 'busy';
    createdAt: Date;
}
export declare class SimpleAIGenerator {
    generateAIs(count?: number): SimpleAI[];
    getTeamStats(ais: SimpleAI[]): {
        total: number;
        byTeam: Record<string, number>;
        byPersonality: Record<string, number>;
        byStatus: Record<string, number>;
    };
}
export declare const simpleAIGenerator: SimpleAIGenerator;
//# sourceMappingURL=ai-simple.d.ts.map