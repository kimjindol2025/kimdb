/**
 * 🤖 KIMDB AI System - 5000명 AI 스키마
 * 완전 자체 구현 AI 모드 시스템
 */
// AI 팀 설정 (간소화된 버전)
export const AI_TEAM_CONFIGS = [
    {
        teamCode: 'CODE1',
        name: 'Frontend Masters',
        description: 'UI/UX 및 프론트엔드 개발 전문팀',
        portRange: { start: 30001, end: 30500 },
        maxMembers: 500,
        focus: ['React', 'Vue', 'UI/UX', '반응형디자인', 'TypeScript'],
        leadership: { style: 'collaborative' }
    },
    {
        teamCode: 'CODE2',
        name: 'Backend Engineers',
        description: '백엔드 및 인프라 구축 전문팀',
        portRange: { start: 30501, end: 31000 },
        maxMembers: 500,
        focus: ['Node.js', 'Python', 'Database', 'API', 'DevOps'],
        leadership: { style: 'democratic' }
    },
    {
        teamCode: 'CODE3',
        name: 'Central Command',
        description: '전략 수립 및 총괄 지휘팀',
        portRange: { start: 31001, end: 33500 },
        maxMembers: 2500,
        focus: ['Architecture', 'Strategy', 'Management', 'Integration'],
        leadership: { style: 'autocratic' }
    },
    {
        teamCode: 'CODE4',
        name: 'Security Guardians',
        description: '보안 및 모니터링 전문팀',
        portRange: { start: 33501, end: 35000 },
        maxMembers: 1500,
        focus: ['Security', 'Monitoring', 'Testing', 'Compliance'],
        leadership: { style: 'democratic' }
    }
];
// 성격별 기본 설정
export const PERSONALITY_TEMPLATES = {
    ANALYZER: {
        traits: { creativity: 30, logic: 95, social: 40, energy: 60, stability: 85 },
        tags: ['분석가', '논리적', '체계적', '신중한'],
        responseStyle: { formality: 'formal', emoji: false, verbosity: 'detailed', tone: 'professional' }
    },
    CREATOR: {
        traits: { creativity: 95, logic: 70, social: 75, energy: 85, stability: 50 },
        tags: ['창조자', '혁신적', '상상력', '실험적'],
        responseStyle: { formality: 'casual', emoji: true, verbosity: 'verbose', tone: 'enthusiastic' }
    },
    LEADER: {
        traits: { creativity: 70, logic: 80, social: 90, energy: 90, stability: 80 },
        tags: ['리더', '결정적', '주도적', '카리스마'],
        responseStyle: { formality: 'formal', emoji: false, verbosity: 'concise', tone: 'professional' }
    },
    SUPPORTER: {
        traits: { creativity: 60, logic: 70, social: 95, energy: 70, stability: 90 },
        tags: ['서포터', '협력적', '친근한', '도움이 되는'],
        responseStyle: { formality: 'friendly', emoji: true, verbosity: 'detailed', tone: 'calm' }
    },
    EXPLORER: {
        traits: { creativity: 85, logic: 75, social: 80, energy: 95, stability: 40 },
        tags: ['탐험가', '호기심', '모험적', '실험적'],
        responseStyle: { formality: 'casual', emoji: true, verbosity: 'verbose', tone: 'enthusiastic' }
    },
    GUARDIAN: {
        traits: { creativity: 45, logic: 85, social: 60, energy: 60, stability: 95 },
        tags: ['수호자', '신중한', '보호적', '안전한'],
        responseStyle: { formality: 'formal', emoji: false, verbosity: 'detailed', tone: 'calm' }
    },
    PERFORMER: {
        traits: { creativity: 90, logic: 65, social: 95, energy: 90, stability: 60 },
        tags: ['연기자', '표현적', '활발한', '매력적'],
        responseStyle: { formality: 'casual', emoji: true, verbosity: 'verbose', tone: 'playful' }
    },
    MEDIATOR: {
        traits: { creativity: 75, logic: 80, social: 85, energy: 70, stability: 85 },
        tags: ['중재자', '균형적', '평화적', '조화로운'],
        responseStyle: { formality: 'friendly', emoji: true, verbosity: 'detailed', tone: 'calm' }
    }
};
// 팀별 성격 분포 (가중치)
export const TEAM_PERSONALITY_WEIGHTS = {
    CODE1: {
        CREATOR: 0.3,
        PERFORMER: 0.25,
        EXPLORER: 0.2,
        SUPPORTER: 0.15,
        MEDIATOR: 0.1,
        ANALYZER: 0.0,
        LEADER: 0.0,
        GUARDIAN: 0.0
    },
    CODE2: {
        ANALYZER: 0.35,
        GUARDIAN: 0.25,
        SUPPORTER: 0.2,
        LEADER: 0.1,
        MEDIATOR: 0.1,
        CREATOR: 0.0,
        PERFORMER: 0.0,
        EXPLORER: 0.0
    },
    CODE3: {
        LEADER: 0.4,
        ANALYZER: 0.25,
        MEDIATOR: 0.2,
        CREATOR: 0.1,
        GUARDIAN: 0.05,
        SUPPORTER: 0.0,
        PERFORMER: 0.0,
        EXPLORER: 0.0
    },
    CODE4: {
        GUARDIAN: 0.4,
        ANALYZER: 0.3,
        SUPPORTER: 0.15,
        LEADER: 0.1,
        MEDIATOR: 0.05,
        CREATOR: 0.0,
        PERFORMER: 0.0,
        EXPLORER: 0.0
    }
};
//# sourceMappingURL=ai-schema.js.map