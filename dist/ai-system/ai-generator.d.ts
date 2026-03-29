/**
 * 🤖 KIMDB AI Generator - 5000명 AI 생성기
 * 성격, 포트, 능력치를 가진 AI 대량 생성
 */
import { AIAgent } from './ai-schema.js';
export declare class AIGenerator {
    private usedPorts;
    private createdCount;
    /**
     * 5000명 AI 전체 생성
     */
    generateAllAIs(): Promise<AIAgent[]>;
    /**
     * 팀별 AI 생성
     */
    private generateTeamAIs;
    /**
     * 단일 AI 생성
     */
    private generateSingleAI;
    /**
     * 포트 할당
     */
    private allocatePort;
    /**
     * 가중치 기반 성격 타입 선택
     */
    private selectWeightedPersonality;
    /**
     * AI 이름 생성
     */
    private generateAIName;
    /**
     * 성격 생성
     */
    private generatePersonality;
    /**
     * 능력치 생성
     */
    private generateSkills;
    /**
     * 팀별 기본 스킬
     */
    private getTeamBaseSkills;
    /**
     * 성격별 스킬 보너스
     */
    private getPersonalitySkillBonus;
    /**
     * 초기 상태 생성
     */
    private generateInitialStatus;
    private varyTrait;
    private combineSkillValues;
    private generateSpecialties;
    private generateExperienceLevel;
    private randomChoice;
    private shuffleArray;
}
export declare const aiGenerator: AIGenerator;
//# sourceMappingURL=ai-generator.d.ts.map