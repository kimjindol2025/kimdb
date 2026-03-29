/**
 * 🤖 KIMDB AI System - 5000명 AI 스키마
 * 완전 자체 구현 AI 모드 시스템
 */
export interface AIAgent {
    id: string;
    name: string;
    codeTeam: 'CODE1' | 'CODE2' | 'CODE3' | 'CODE4';
    port: number;
    personality: AIPersonality;
    skills: AISkills;
    status: AIStatus;
    createdAt: Date;
    lastActive: Date;
    totalTasks: number;
    successRate: number;
}
export interface AIPersonality {
    traits: {
        creativity: number;
        logic: number;
        social: number;
        energy: number;
        stability: number;
    };
    type: PersonalityType;
    tags: string[];
    responseStyle: {
        formality: 'casual' | 'formal' | 'friendly';
        emoji: boolean;
        verbosity: 'concise' | 'detailed' | 'verbose';
        tone: 'professional' | 'enthusiastic' | 'calm' | 'playful';
    };
}
export type PersonalityType = 'ANALYZER' | 'CREATOR' | 'LEADER' | 'SUPPORTER' | 'EXPLORER' | 'GUARDIAN' | 'PERFORMER' | 'MEDIATOR';
export interface AISkills {
    technical: {
        programming: number;
        database: number;
        security: number;
        frontend: number;
        backend: number;
        devops: number;
    };
    soft: {
        communication: number;
        problemSolving: number;
        teamwork: number;
        leadership: number;
        adaptability: number;
        learning: number;
    };
    specialties: string[];
    experience: 'junior' | 'mid' | 'senior' | 'expert';
}
export interface AIStatus {
    current: 'active' | 'idle' | 'busy' | 'maintenance' | 'offline';
    currentTask?: {
        id: string;
        type: string;
        startedAt: Date;
        progress: number;
    };
    performance: {
        cpuUsage: number;
        memoryUsage: number;
        responseTime: number;
        uptime: number;
    };
    health: {
        score: number;
        lastCheck: Date;
        issues: string[];
    };
}
export interface AITeamConfig {
    teamCode: 'CODE1' | 'CODE2' | 'CODE3' | 'CODE4';
    name: string;
    description: string;
    portRange: {
        start: number;
        end: number;
    };
    maxMembers: number;
    focus: string[];
    leadership: {
        leaderId?: string;
        style: 'democratic' | 'autocratic' | 'collaborative';
    };
}
export declare const AI_TEAM_CONFIGS: AITeamConfig[];
export declare const PERSONALITY_TEMPLATES: Record<PersonalityType, Partial<AIPersonality>>;
export declare const TEAM_PERSONALITY_WEIGHTS: Record<string, Record<PersonalityType, number>>;
//# sourceMappingURL=ai-schema.d.ts.map