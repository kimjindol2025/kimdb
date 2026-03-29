/**
 * 🤖 KIMDB AI System - 5000명 AI 스키마
 * 완전 자체 구현 AI 모드 시스템
 */

export interface AIAgent {
  id: string;                    // ai_001 ~ ai_5000
  name: string;                  // AI 이름
  codeTeam: 'CODE1' | 'CODE2' | 'CODE3' | 'CODE4';
  port: number;                  // 전용 포트 (20001~25000)
  
  // 성격 시스템
  personality: AIPersonality;
  
  // 능력치
  skills: AISkills;
  
  // 상태 정보
  status: AIStatus;
  
  // 메타데이터
  createdAt: Date;
  lastActive: Date;
  totalTasks: number;
  successRate: number;
}

export interface AIPersonality {
  // 핵심 성격 (5가지 차원)
  traits: {
    creativity: number;          // 창의성 (0-100)
    logic: number;              // 논리성 (0-100) 
    social: number;             // 사회성 (0-100)
    energy: number;             // 활동성 (0-100)
    stability: number;          // 안정성 (0-100)
  };
  
  // 성격 타입
  type: PersonalityType;
  
  // 특성 태그
  tags: string[];               // ['분석가', '창조자', '리더', '서포터']
  
  // 말투/응답 스타일
  responseStyle: {
    formality: 'casual' | 'formal' | 'friendly';
    emoji: boolean;
    verbosity: 'concise' | 'detailed' | 'verbose';
    tone: 'professional' | 'enthusiastic' | 'calm' | 'playful';
  };
}

export type PersonalityType = 
  | 'ANALYZER'     // 분석가 - 논리적, 체계적
  | 'CREATOR'      // 창조자 - 창의적, 혁신적  
  | 'LEADER'       // 리더 - 주도적, 결정적
  | 'SUPPORTER'    // 서포터 - 협력적, 안정적
  | 'EXPLORER'     // 탐험가 - 호기심, 실험적
  | 'GUARDIAN'     // 수호자 - 신중함, 보호적
  | 'PERFORMER'    // 연기자 - 표현적, 활발함
  | 'MEDIATOR';    // 중재자 - 균형적, 평화적

export interface AISkills {
  // 기술 스킬
  technical: {
    programming: number;         // 프로그래밍 (0-100)
    database: number;           // 데이터베이스 (0-100)
    security: number;           // 보안 (0-100)
    frontend: number;           // 프론트엔드 (0-100)
    backend: number;            // 백엔드 (0-100)
    devops: number;            // 데브옵스 (0-100)
  };
  
  // 소프트 스킬
  soft: {
    communication: number;       // 의사소통 (0-100)
    problemSolving: number;     // 문제해결 (0-100)
    teamwork: number;           // 팀워크 (0-100)
    leadership: number;         // 리더십 (0-100)
    adaptability: number;       // 적응력 (0-100)
    learning: number;           // 학습능력 (0-100)
  };
  
  // 전문 영역
  specialties: string[];        // ['React', 'Node.js', '보안분석', '데이터베이스설계']
  
  // 경험 레벨
  experience: 'junior' | 'mid' | 'senior' | 'expert';
}

export interface AIStatus {
  // 현재 상태
  current: 'active' | 'idle' | 'busy' | 'maintenance' | 'offline';
  
  // 현재 작업
  currentTask?: {
    id: string;
    type: string;
    startedAt: Date;
    progress: number;           // 0-100
  };
  
  // 성능 지표
  performance: {
    cpuUsage: number;          // 0-100
    memoryUsage: number;       // 0-100
    responseTime: number;      // ms
    uptime: number;            // 초
  };
  
  // 건강 상태
  health: {
    score: number;             // 0-100
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
  focus: string[];             // 주력 분야
  leadership: {
    leaderId?: string;         // 팀장 AI ID
    style: 'democratic' | 'autocratic' | 'collaborative';
  };
}

// AI 팀 설정 (간소화된 버전)
export const AI_TEAM_CONFIGS: AITeamConfig[] = [
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
export const PERSONALITY_TEMPLATES: Record<PersonalityType, Partial<AIPersonality>> = {
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
export const TEAM_PERSONALITY_WEIGHTS: Record<string, Record<PersonalityType, number>> = {
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