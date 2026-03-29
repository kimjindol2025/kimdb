/**
 * 🤖 KIMDB AI API - 5000명 AI 관리 API
 * REST 엔드포인트로 AI 조회/관리/상호작용
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AIAgent, PersonalityType } from './ai-schema.js';
import { aiGenerator } from './ai-generator.js';

// 메모리 저장소 (실제로는 KIMDB에 저장)
let aiDatabase: Map<string, AIAgent> = new Map();
let isInitialized = false;

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
export async function registerAIRoutes(fastify: FastifyInstance) {
  // AI 시스템 초기화
  fastify.get('/ai/init', async (request, reply) => {
    if (isInitialized) {
      return reply.code(200).send({
        success: true,
        message: 'AI system already initialized',
        count: aiDatabase.size
      });
    }

    console.log('🤖 Initializing AI system...');
    const startTime = Date.now();

    try {
      const allAIs = await aiGenerator.generateAllAIs();
      
      // 메모리에 저장
      aiDatabase.clear();
      for (const ai of allAIs) {
        aiDatabase.set(ai.id, ai);
      }

      isInitialized = true;
      const elapsed = Date.now() - startTime;

      console.log(`✅ AI system initialized in ${elapsed}ms`);

      return reply.code(200).send({
        success: true,
        message: 'AI system initialized successfully',
        count: allAIs.length,
        initTime: elapsed,
        teams: {
          CODE1: allAIs.filter(ai => ai.codeTeam === 'CODE1').length,
          CODE2: allAIs.filter(ai => ai.codeTeam === 'CODE2').length,
          CODE3: allAIs.filter(ai => ai.codeTeam === 'CODE3').length,
          CODE4: allAIs.filter(ai => ai.codeTeam === 'CODE4').length
        }
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  // AI 목록 조회 (필터링 지원)
  fastify.get<{ Querystring: AIQueryParams }>('/ai', async (request, reply) => {
    const { team, personality, status, experience, skill, limit = 50, offset = 0 } = request.query;

    let filteredAIs = Array.from(aiDatabase.values());

    // 필터 적용
    if (team) {
      filteredAIs = filteredAIs.filter(ai => ai.codeTeam === team);
    }
    if (personality) {
      filteredAIs = filteredAIs.filter(ai => ai.personality.type === personality);
    }
    if (status) {
      filteredAIs = filteredAIs.filter(ai => ai.status.current === status);
    }
    if (experience) {
      filteredAIs = filteredAIs.filter(ai => ai.skills.experience === experience);
    }
    if (skill) {
      filteredAIs = filteredAIs.filter(ai => ai.skills.specialties.includes(skill));
    }

    // 페이지네이션
    const total = filteredAIs.length;
    const paginatedAIs = filteredAIs.slice(offset, offset + limit);

    return reply.send({
      success: true,
      data: paginatedAIs,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  });

  // 특정 AI 상세 조회
  fastify.get<{ Params: { id: string } }>('/ai/:id', async (request, reply) => {
    const { id } = request.params;
    const ai = aiDatabase.get(id);

    if (!ai) {
      return reply.code(404).send({
        success: false,
        error: 'AI not found'
      });
    }

    return reply.send({
      success: true,
      data: ai
    });
  });

  // AI와 채팅
  fastify.post<{ 
    Params: { id: string },
    Body: AIChatRequest 
  }>('/ai/:id/chat', async (request, reply) => {
    const { id } = request.params;
    const { message, context, userId } = request.body;
    const ai = aiDatabase.get(id);

    if (!ai) {
      return reply.code(404).send({
        success: false,
        error: 'AI not found'
      });
    }

    if (ai.status.current !== 'active' && ai.status.current !== 'idle') {
      return reply.code(400).send({
        success: false,
        error: `AI is currently ${ai.status.current}`
      });
    }

    const startTime = Date.now();

    // AI 응답 생성 (성격 기반)
    const response = generateAIResponse(ai, message, context);
    
    // 상태 업데이트
    ai.lastActive = new Date();
    ai.status.performance.responseTime = Date.now() - startTime;

    const chatResponse: AIChatResponse = {
      response,
      aiId: ai.id,
      aiName: ai.name,
      personality: ai.personality.type,
      responseTime: Date.now() - startTime,
      timestamp: new Date()
    };

    return reply.send({
      success: true,
      data: chatResponse
    });
  });

  // AI에게 작업 할당
  fastify.post<{
    Params: { id: string },
    Body: AITaskRequest
  }>('/ai/:id/task', async (request, reply) => {
    const { id } = request.params;
    const taskRequest = request.body;
    const ai = aiDatabase.get(id);

    if (!ai) {
      return reply.code(404).send({
        success: false,
        error: 'AI not found'
      });
    }

    if (ai.status.current === 'busy') {
      return reply.code(400).send({
        success: false,
        error: 'AI is currently busy with another task'
      });
    }

    // 작업 시작
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    ai.status.current = 'busy';
    ai.status.currentTask = {
      id: taskId,
      type: taskRequest.type,
      startedAt: new Date(),
      progress: 0
    };
    ai.totalTasks++;

    // 예상 완료 시간 계산 (성격과 스킬 기반)
    const estimatedDuration = calculateTaskDuration(ai, taskRequest);

    return reply.send({
      success: true,
      data: {
        taskId,
        aiId: ai.id,
        aiName: ai.name,
        estimatedDuration,
        status: 'started'
      }
    });
  });

  // AI 상태 업데이트
  fastify.put<{
    Params: { id: string },
    Body: { status: 'active' | 'idle' | 'maintenance' | 'offline' }
  }>('/ai/:id/status', async (request, reply) => {
    const { id } = request.params;
    const { status } = request.body;
    const ai = aiDatabase.get(id);

    if (!ai) {
      return reply.code(404).send({
        success: false,
        error: 'AI not found'
      });
    }

    ai.status.current = status;
    ai.lastActive = new Date();

    return reply.send({
      success: true,
      data: {
        aiId: ai.id,
        status: ai.status.current,
        updatedAt: ai.lastActive
      }
    });
  });

  // AI 통계
  fastify.get('/ai/stats', async (request, reply) => {
    const allAIs = Array.from(aiDatabase.values());
    
    if (allAIs.length === 0) {
      return reply.send({
        success: true,
        data: {
          total: 0,
          message: 'No AIs found. Run /ai/init to initialize the system.'
        }
      });
    }

    const stats: AIStatsResponse = {
      total: allAIs.length,
      byTeam: {},
      byPersonality: {} as Record<PersonalityType, number>,
      byStatus: {},
      byExperience: {},
      averageSkills: {
        technical: {},
        soft: {}
      }
    };

    // 통계 계산
    for (const ai of allAIs) {
      // 팀별
      stats.byTeam[ai.codeTeam] = (stats.byTeam[ai.codeTeam] || 0) + 1;
      
      // 성격별
      stats.byPersonality[ai.personality.type] = (stats.byPersonality[ai.personality.type] || 0) + 1;
      
      // 상태별
      stats.byStatus[ai.status.current] = (stats.byStatus[ai.status.current] || 0) + 1;
      
      // 경험별
      stats.byExperience[ai.skills.experience] = (stats.byExperience[ai.skills.experience] || 0) + 1;
    }

    return reply.send({
      success: true,
      data: stats
    });
  });

  // 팀별 AI 조회
  fastify.get<{ Params: { team: string } }>('/ai/team/:team', async (request, reply) => {
    const { team } = request.params;
    
    if (!['CODE1', 'CODE2', 'CODE3', 'CODE4'].includes(team)) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid team. Must be CODE1, CODE2, CODE3, or CODE4'
      });
    }

    const teamAIs = Array.from(aiDatabase.values())
      .filter(ai => ai.codeTeam === team)
      .sort((a, b) => a.name.localeCompare(b.name));

    return reply.send({
      success: true,
      data: teamAIs,
      count: teamAIs.length
    });
  });

  // AI 검색 (이름, 태그, 전문분야)
  fastify.get<{ Querystring: { q: string; limit?: number } }>('/ai/search', async (request, reply) => {
    const { q, limit = 20 } = request.query;
    
    if (!q || q.length < 2) {
      return reply.code(400).send({
        success: false,
        error: 'Query must be at least 2 characters long'
      });
    }

    const query = q.toLowerCase();
    const matchingAIs = Array.from(aiDatabase.values())
      .filter(ai => 
        ai.name.toLowerCase().includes(query) ||
        ai.personality.tags.some(tag => tag.toLowerCase().includes(query)) ||
        ai.skills.specialties.some(spec => spec.toLowerCase().includes(query))
      )
      .slice(0, limit);

    return reply.send({
      success: true,
      data: matchingAIs,
      count: matchingAIs.length
    });
  });
}

// === 유틸리티 함수들 ===

/**
 * AI 응답 생성 (성격 기반)
 */
function generateAIResponse(ai: AIAgent, message: string, context?: string): string {
  const personality = ai.personality;
  const style = personality.responseStyle;
  
  // 기본 응답 템플릿
  const responses = [
    `안녕하세요! 저는 ${ai.name}입니다.`,
    `${message}에 대해 말씀드리자면,`,
    `제 전문분야는 ${ai.skills.specialties.join(', ')}입니다.`,
    `${ai.codeTeam} 팀에서 활동하고 있어요.`
  ];

  let response = responses[Math.floor(Math.random() * responses.length)];

  // 성격별 응답 스타일 적용
  if (personality.type === 'ANALYZER') {
    response = `분석해보면, ${message}의 경우 체계적인 접근이 필요합니다. 데이터를 기반으로 판단하는 것이 중요하겠네요.`;
  } else if (personality.type === 'CREATOR') {
    response = `와! 정말 흥미로운 아이디어네요! 🎨 ${message}를 더 창의적으로 접근해보면 어떨까요?`;
  } else if (personality.type === 'LEADER') {
    response = `${message}에 대해 리더십 관점에서 말씀드리면, 전략적으로 접근해야 합니다. 팀을 이끌어본 경험으로 보면...`;
  } else if (personality.type === 'SUPPORTER') {
    response = `도움이 필요하시군요! 😊 ${message}에 대해 제가 최선을 다해 지원해드리겠습니다. 함께 해결해봐요!`;
  }

  // 이모지 추가 (스타일에 따라)
  if (style.emoji && Math.random() > 0.5) {
    const emojis = ['✨', '🚀', '💡', '⚡', '🎯', '👍', '🔥'];
    response += ` ${emojis[Math.floor(Math.random() * emojis.length)]}`;
  }

  // 격식 조정
  if (style.formality === 'formal') {
    response = response.replace(/요!/g, '습니다.').replace(/어요/g, '습니다');
  }

  return response;
}

/**
 * 작업 소요시간 계산
 */
function calculateTaskDuration(ai: AIAgent, task: AITaskRequest): number {
  const baseTime = 3600; // 1시간 (초)
  
  // 경험도에 따른 조정
  const experienceMultiplier = {
    junior: 1.5,
    mid: 1.0,
    senior: 0.7,
    expert: 0.5
  };
  
  // 우선순위에 따른 조정
  const priorityMultiplier = {
    low: 0.8,
    medium: 1.0,
    high: 1.2,
    urgent: 1.5
  };
  
  const adjustedTime = baseTime * 
    experienceMultiplier[ai.skills.experience] * 
    priorityMultiplier[task.priority] *
    (0.8 + Math.random() * 0.4); // 20% 랜덤 변동
  
  return Math.round(adjustedTime);
}