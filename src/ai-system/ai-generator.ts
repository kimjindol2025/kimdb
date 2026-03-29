/**
 * 🤖 KIMDB AI Generator - 5000명 AI 생성기
 * 성격, 포트, 능력치를 가진 AI 대량 생성
 */

import { randomUUID } from 'crypto';
import { 
  AIAgent, 
  AIPersonality, 
  AISkills, 
  AIStatus, 
  PersonalityType,
  AI_TEAM_CONFIGS,
  PERSONALITY_TEMPLATES,
  TEAM_PERSONALITY_WEIGHTS
} from './ai-schema.js';

export class AIGenerator {
  private usedPorts = new Set<number>();
  private createdCount = 0;

  /**
   * 5000명 AI 전체 생성
   */
  async generateAllAIs(): Promise<AIAgent[]> {
    const allAIs: AIAgent[] = [];
    
    console.log('🤖 Starting AI generation for 5000 agents...');
    
    for (const teamConfig of AI_TEAM_CONFIGS) {
      console.log(`\n👥 Generating ${teamConfig.maxMembers} AIs for ${teamConfig.name}...`);
      
      const teamAIs = await this.generateTeamAIs(teamConfig.teamCode, teamConfig.maxMembers);
      allAIs.push(...teamAIs);
      
      console.log(`✅ ${teamConfig.name}: ${teamAIs.length}명 생성 완료`);
    }
    
    console.log(`\n🎉 Total AI generated: ${allAIs.length}/5000`);
    return allAIs;
  }

  /**
   * 팀별 AI 생성
   */
  private async generateTeamAIs(teamCode: string, count: number): Promise<AIAgent[]> {
    const teamAIs: AIAgent[] = [];
    const teamConfig = AI_TEAM_CONFIGS.find(t => t.teamCode === teamCode)!;
    const personalityWeights = TEAM_PERSONALITY_WEIGHTS[teamCode];
    
    for (let i = 0; i < count; i++) {
      const ai = this.generateSingleAI(teamCode as any, teamConfig, personalityWeights);
      teamAIs.push(ai);
      
      // 진행률 표시
      if ((i + 1) % 100 === 0) {
        console.log(`  Progress: ${i + 1}/${count} (${Math.round((i + 1) / count * 100)}%)`);
      }
    }
    
    return teamAIs;
  }

  /**
   * 단일 AI 생성
   */
  private generateSingleAI(
    teamCode: 'CODE1' | 'CODE2' | 'CODE3' | 'CODE4',
    teamConfig: any,
    personalityWeights: Record<PersonalityType, number>
  ): AIAgent {
    this.createdCount++;
    
    // ID 생성
    const id = `ai_${this.createdCount.toString().padStart(4, '0')}`;
    
    // 포트 할당
    const port = this.allocatePort(teamConfig.portRange);
    
    // 성격 타입 선택 (가중치 기반)
    const personalityType = this.selectWeightedPersonality(personalityWeights);
    
    // AI 생성
    const ai: AIAgent = {
      id,
      name: this.generateAIName(personalityType, teamCode),
      codeTeam: teamCode,
      port,
      personality: this.generatePersonality(personalityType),
      skills: this.generateSkills(teamCode, personalityType),
      status: this.generateInitialStatus(),
      createdAt: new Date(),
      lastActive: new Date(),
      totalTasks: 0,
      successRate: 85 + Math.random() * 15 // 85-100%
    };
    
    return ai;
  }

  /**
   * 포트 할당
   */
  private allocatePort(portRange: { start: number; end: number }): number {
    let attempts = 0;
    while (attempts < 1000) {
      const port = portRange.start + Math.floor(Math.random() * (portRange.end - portRange.start + 1));
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
      attempts++;
    }
    throw new Error(`Cannot allocate port in range ${portRange.start}-${portRange.end}`);
  }

  /**
   * 가중치 기반 성격 타입 선택
   */
  private selectWeightedPersonality(weights: Record<PersonalityType, number>): PersonalityType {
    const random = Math.random();
    let cumulative = 0;
    
    for (const [type, weight] of Object.entries(weights)) {
      cumulative += weight;
      if (random <= cumulative) {
        return type as PersonalityType;
      }
    }
    
    // 기본값 (이론적으로 도달하면 안됨)
    return 'SUPPORTER';
  }

  /**
   * AI 이름 생성
   */
  private generateAIName(personalityType: PersonalityType, teamCode: string): string {
    const prefixes = {
      ANALYZER: ['분석', '논리', '체계', '정밀'],
      CREATOR: ['창조', '혁신', '상상', '발명'],
      LEADER: ['지휘', '통솔', '주도', '결단'],
      SUPPORTER: ['지원', '협력', '도움', '친화'],
      EXPLORER: ['탐험', '모험', '실험', '발견'],
      GUARDIAN: ['수호', '보호', '안전', '방어'],
      PERFORMER: ['표현', '연기', '매력', '활기'],
      MEDIATOR: ['중재', '조화', '균형', '평화']
    };
    
    const suffixes = {
      CODE1: ['디자이너', '크리에이터', '아티스트', '마스터'],
      CODE2: ['엔지니어', '아키텍트', '빌더', '개발자'],
      CODE3: ['커맨더', '전략가', '매니저', '리더'],
      CODE4: ['가디언', '워처', '프로텍터', '시큐어']
    };
    
    const prefix = this.randomChoice(prefixes[personalityType]);
    const suffix = this.randomChoice(suffixes[teamCode]);
    const number = Math.floor(Math.random() * 999) + 1;
    
    return `${prefix}${suffix}_${number}`;
  }

  /**
   * 성격 생성
   */
  private generatePersonality(type: PersonalityType): AIPersonality {
    const template = PERSONALITY_TEMPLATES[type];
    
    // 기본 템플릿에 랜덤 변화 추가
    const personality: AIPersonality = {
      traits: {
        creativity: this.varyTrait(template.traits!.creativity),
        logic: this.varyTrait(template.traits!.logic),
        social: this.varyTrait(template.traits!.social),
        energy: this.varyTrait(template.traits!.energy),
        stability: this.varyTrait(template.traits!.stability)
      },
      type,
      tags: [...template.tags!],
      responseStyle: { ...template.responseStyle! }
    };
    
    // 추가 태그 (랜덤)
    const additionalTags = ['효율적', '신뢰할만한', '열정적', '꼼꼼한', '유연한', '진취적'];
    if (Math.random() > 0.5) {
      personality.tags.push(this.randomChoice(additionalTags));
    }
    
    return personality;
  }

  /**
   * 능력치 생성
   */
  private generateSkills(teamCode: string, personalityType: PersonalityType): AISkills {
    const baseSkills = this.getTeamBaseSkills(teamCode);
    const personalityBonus = this.getPersonalitySkillBonus(personalityType);
    
    return {
      technical: {
        programming: this.combineSkillValues(baseSkills.technical.programming, personalityBonus.technical.programming),
        database: this.combineSkillValues(baseSkills.technical.database, personalityBonus.technical.database),
        security: this.combineSkillValues(baseSkills.technical.security, personalityBonus.technical.security),
        frontend: this.combineSkillValues(baseSkills.technical.frontend, personalityBonus.technical.frontend),
        backend: this.combineSkillValues(baseSkills.technical.backend, personalityBonus.technical.backend),
        devops: this.combineSkillValues(baseSkills.technical.devops, personalityBonus.technical.devops)
      },
      soft: {
        communication: this.combineSkillValues(baseSkills.soft.communication, personalityBonus.soft.communication),
        problemSolving: this.combineSkillValues(baseSkills.soft.problemSolving, personalityBonus.soft.problemSolving),
        teamwork: this.combineSkillValues(baseSkills.soft.teamwork, personalityBonus.soft.teamwork),
        leadership: this.combineSkillValues(baseSkills.soft.leadership, personalityBonus.soft.leadership),
        adaptability: this.combineSkillValues(baseSkills.soft.adaptability, personalityBonus.soft.adaptability),
        learning: this.combineSkillValues(baseSkills.soft.learning, personalityBonus.soft.learning)
      },
      specialties: this.generateSpecialties(teamCode, personalityType),
      experience: this.generateExperienceLevel()
    };
  }

  /**
   * 팀별 기본 스킬
   */
  private getTeamBaseSkills(teamCode: string): AISkills {
    const teamSkills = {
      CODE1: { // Frontend
        technical: { programming: 85, database: 40, security: 50, frontend: 90, backend: 30, devops: 40 },
        soft: { communication: 80, problemSolving: 75, teamwork: 85, leadership: 60, adaptability: 80, learning: 75 }
      },
      CODE2: { // Backend  
        technical: { programming: 90, database: 85, security: 70, frontend: 40, backend: 95, devops: 80 },
        soft: { communication: 70, problemSolving: 90, teamwork: 75, leadership: 65, adaptability: 75, learning: 80 }
      },
      CODE3: { // Central Command
        technical: { programming: 75, database: 70, security: 75, frontend: 60, backend: 70, devops: 70 },
        soft: { communication: 90, problemSolving: 85, teamwork: 80, leadership: 95, adaptability: 85, learning: 85 }
      },
      CODE4: { // Security
        technical: { programming: 80, database: 75, security: 95, frontend: 50, backend: 75, devops: 85 },
        soft: { communication: 75, problemSolving: 90, teamwork: 80, leadership: 70, adaptability: 70, learning: 75 }
      }
    };
    
    return teamSkills[teamCode] as AISkills;
  }

  /**
   * 성격별 스킬 보너스
   */
  private getPersonalitySkillBonus(personalityType: PersonalityType): AISkills {
    const bonuses = {
      ANALYZER: {
        technical: { programming: 10, database: 15, security: 10, frontend: 0, backend: 10, devops: 5 },
        soft: { communication: -5, problemSolving: 15, teamwork: 0, leadership: 0, adaptability: 0, learning: 10 }
      },
      CREATOR: {
        technical: { programming: 5, database: 0, security: 0, frontend: 15, backend: 0, devops: 0 },
        soft: { communication: 5, problemSolving: 10, teamwork: 5, leadership: 0, adaptability: 15, learning: 10 }
      },
      LEADER: {
        technical: { programming: 0, database: 0, security: 5, frontend: 0, backend: 0, devops: 10 },
        soft: { communication: 15, problemSolving: 5, teamwork: 10, leadership: 20, adaptability: 10, learning: 5 }
      },
      // ... 다른 성격 타입들
    };
    
    return bonuses[personalityType] || bonuses.ANALYZER;
  }

  /**
   * 초기 상태 생성
   */
  private generateInitialStatus(): AIStatus {
    return {
      current: 'active',
      performance: {
        cpuUsage: 10 + Math.random() * 20, // 10-30%
        memoryUsage: 20 + Math.random() * 30, // 20-50%
        responseTime: 50 + Math.random() * 100, // 50-150ms
        uptime: 0
      },
      health: {
        score: 90 + Math.random() * 10, // 90-100
        lastCheck: new Date(),
        issues: []
      }
    };
  }

  // === 유틸리티 메서드들 ===

  private varyTrait(baseValue: number): number {
    const variation = (Math.random() - 0.5) * 20; // ±10 변화
    return Math.max(0, Math.min(100, baseValue + variation));
  }

  private combineSkillValues(base: number, bonus: number): number {
    return Math.max(0, Math.min(100, base + bonus + (Math.random() - 0.5) * 10));
  }

  private generateSpecialties(teamCode: string, personalityType: PersonalityType): string[] {
    const teamSpecialties = {
      CODE1: ['React', 'Vue.js', 'TypeScript', 'CSS3', 'Webpack', 'Sass', 'UI/UX', '반응형디자인'],
      CODE2: ['Node.js', 'Python', 'PostgreSQL', 'MongoDB', 'Docker', 'Kubernetes', 'AWS', 'Redis'],
      CODE3: ['시스템설계', '프로젝트관리', '마이크로서비스', '데이터분석', '전략수립', 'DevOps'],
      CODE4: ['보안감사', 'SSL/TLS', '침투테스트', '모니터링', 'ELK스택', '컴플라이언스', 'OWASP']
    };
    
    const specialties = teamSpecialties[teamCode] || [];
    const selectedCount = 2 + Math.floor(Math.random() * 3); // 2-4개
    
    return this.shuffleArray([...specialties]).slice(0, selectedCount);
  }

  private generateExperienceLevel(): 'junior' | 'mid' | 'senior' | 'expert' {
    const rand = Math.random();
    if (rand < 0.3) return 'junior';
    if (rand < 0.6) return 'mid'; 
    if (rand < 0.85) return 'senior';
    return 'expert';
  }

  private randomChoice<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}

// 싱글톤 인스턴스
export const aiGenerator = new AIGenerator();