/**
 * 🤖 KIMDB AI Simple System - 빠른 5000명 AI 등록
 */

export interface SimpleAI {
  id: string;                    // ai_0001 ~ ai_5000
  name: string;                  // AI 이름
  team: 'CODE1' | 'CODE2' | 'CODE3' | 'CODE4';
  port: number;                  // 가상 포트 (31000 + id)
  personality: string;           // 성격 타입
  skills: string[];              // 전문 분야
  status: 'active' | 'idle' | 'busy';
  createdAt: Date;
}

export class SimpleAIGenerator {
  generateAIs(count: number = 5000): SimpleAI[] {
    console.log(`🤖 Generating ${count} AI agents...`);
    
    const personalities = [
      'ANALYZER', 'CREATOR', 'LEADER', 'SUPPORTER', 
      'EXPLORER', 'GUARDIAN', 'PERFORMER', 'MEDIATOR'
    ];
    
    const skillsByTeam = {
      CODE1: ['React', 'Vue.js', 'CSS', 'UI/UX', 'TypeScript', 'Frontend'],
      CODE2: ['Node.js', 'Python', 'Database', 'API', 'Backend', 'DevOps'],
      CODE3: ['Architecture', 'Management', 'Strategy', 'Integration', 'Leadership'],
      CODE4: ['Security', 'Monitoring', 'Testing', 'Compliance', 'Protection']
    };

    const ais: SimpleAI[] = [];
    
    for (let i = 1; i <= count; i++) {
      const teamIndex = Math.floor((i - 1) / (count / 4));
      const teams = ['CODE1', 'CODE2', 'CODE3', 'CODE4'];
      const team = teams[Math.min(teamIndex, 3)] as any;
      
      const personality = personalities[Math.floor(Math.random() * personalities.length)];
      const teamSkills = skillsByTeam[team];
      const selectedSkills = teamSkills
        .sort(() => 0.5 - Math.random())
        .slice(0, 2 + Math.floor(Math.random() * 2)); // 2-3개 스킬

      const ai: SimpleAI = {
        id: `ai_${i.toString().padStart(4, '0')}`,
        name: `${personality}${team.replace('CODE', '')}_${i}`,
        team,
        port: 31000 + i,
        personality,
        skills: selectedSkills,
        status: Math.random() > 0.1 ? 'active' : 'idle',
        createdAt: new Date()
      };
      
      ais.push(ai);
    }
    
    console.log(`✅ Generated ${ais.length} AI agents successfully!`);
    return ais;
  }

  getTeamStats(ais: SimpleAI[]) {
    const stats = {
      total: ais.length,
      byTeam: {} as Record<string, number>,
      byPersonality: {} as Record<string, number>,
      byStatus: {} as Record<string, number>
    };

    ais.forEach(ai => {
      stats.byTeam[ai.team] = (stats.byTeam[ai.team] || 0) + 1;
      stats.byPersonality[ai.personality] = (stats.byPersonality[ai.personality] || 0) + 1;
      stats.byStatus[ai.status] = (stats.byStatus[ai.status] || 0) + 1;
    });

    return stats;
  }
}

export const simpleAIGenerator = new SimpleAIGenerator();