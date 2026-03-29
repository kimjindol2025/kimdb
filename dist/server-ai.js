import Fastify from 'fastify';
import { registerAIRoutes } from './ai-system/ai-api.js';
const fastify = Fastify({
    logger: {
        level: 'info',
        transport: {
            target: 'pino-pretty'
        }
    }
});
fastify.get('/health', async () => {
    return {
        status: 'healthy',
        service: 'KIMDB with AI System',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        features: [
            '5000 AI Agents',
            'Personality System',
            'Dynamic Port Allocation',
            'Team-based Organization',
            'Real-time Chat',
            'Task Management',
            'Advanced Analytics'
        ]
    };
});
fastify.get('/', async () => {
    return {
        welcome: '🔥 KIMDB AI System',
        description: '5000명의 AI와 함께하는 완전한 데이터베이스 시스템',
        endpoints: {
            ai_init: 'GET /ai/init - AI 시스템 초기화',
            ai_list: 'GET /ai - AI 목록 조회 (필터링 지원)',
            ai_detail: 'GET /ai/:id - 특정 AI 상세 정보',
            ai_chat: 'POST /ai/:id/chat - AI와 채팅',
            ai_task: 'POST /ai/:id/task - AI에게 작업 할당',
            ai_stats: 'GET /ai/stats - AI 통계',
            ai_team: 'GET /ai/team/:team - 팀별 AI 조회',
            ai_search: 'GET /ai/search?q=검색어 - AI 검색'
        },
        quickStart: [
            '1. GET /ai/init - AI 시스템 초기화 (5000명 생성)',
            '2. GET /ai/stats - 전체 통계 확인',
            '3. GET /ai/team/CODE1 - CODE1 팀 AI들 보기',
            '4. POST /ai/ai_0001/chat - AI와 대화하기'
        ]
    };
});
fastify.get('/stats', async () => {
    return {
        server: 'KIMDB AI Enhanced',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        node_version: process.version,
        ai_features: {
            total_agents: 5000,
            teams: 4,
            personality_types: 8,
            port_range: '20001-25000',
            skills: ['Technical', 'Soft Skills', 'Specialties']
        }
    };
});
await fastify.register(registerAIRoutes);
const data = new Map();
fastify.post('/api/data/:key', async (request, reply) => {
    const { key } = request.params;
    const body = request.body;
    data.set(key, {
        data: body,
        timestamp: new Date(),
        key
    });
    reply.code(201).send({
        success: true,
        key,
        message: 'Data stored successfully'
    });
});
fastify.get('/api/data/:key', async (request, reply) => {
    const { key } = request.params;
    const item = data.get(key);
    if (item) {
        reply.send({
            success: true,
            ...item
        });
    }
    else {
        reply.code(404).send({
            success: false,
            error: 'Key not found'
        });
    }
});
fastify.get('/api/data', async () => {
    return {
        success: true,
        count: data.size,
        keys: Array.from(data.keys())
    };
});
fastify.get('/docs', async () => {
    return {
        title: '🤖 KIMDB AI API Documentation',
        version: '2.0.0',
        overview: {
            description: '5000명의 AI 에이전트를 관리하는 완전한 데이터베이스 시스템',
            features: [
                '개별 AI 성격 시스템 (8가지 타입)',
                '팀 기반 조직 (CODE1-4)',
                '동적 포트 할당 (20001-25000)',
                '실시간 채팅 및 작업 관리',
                '고급 필터링 및 검색',
                '실시간 통계 및 분석'
            ]
        },
        endpoints: {
            'AI Management': {
                'GET /ai/init': '5000명 AI 시스템 초기화',
                'GET /ai': 'AI 목록 조회 (team, personality, status 필터)',
                'GET /ai/:id': '특정 AI 상세 정보',
                'PUT /ai/:id/status': 'AI 상태 변경'
            },
            'AI Interaction': {
                'POST /ai/:id/chat': 'AI와 채팅 (성격 기반 응답)',
                'POST /ai/:id/task': 'AI에게 작업 할당',
                'GET /ai/search?q=': 'AI 검색 (이름, 태그, 전문분야)'
            },
            'Analytics': {
                'GET /ai/stats': '전체 AI 통계',
                'GET /ai/team/:team': '팀별 AI 조회 (CODE1-4)'
            }
        },
        examples: {
            'AI 초기화': {
                method: 'GET',
                url: '/ai/init',
                description: '5000명 AI 생성 (약 10-30초 소요)'
            },
            'AI와 채팅': {
                method: 'POST',
                url: '/ai/ai_0001/chat',
                body: {
                    message: '안녕하세요! 프로젝트 도움이 필요해요',
                    context: 'React 프로젝트 개발 중'
                }
            },
            '작업 할당': {
                method: 'POST',
                url: '/ai/ai_0001/task',
                body: {
                    type: 'development',
                    description: 'React 컴포넌트 개발',
                    priority: 'high'
                }
            },
            'AI 검색': {
                method: 'GET',
                url: '/ai/search?q=React&limit=10',
                description: 'React 전문 AI 검색'
            }
        },
        aiSystem: {
            personalityTypes: [
                'ANALYZER - 분석가 (논리적, 체계적)',
                'CREATOR - 창조자 (창의적, 혁신적)',
                'LEADER - 리더 (주도적, 결정적)',
                'SUPPORTER - 서포터 (협력적, 친근한)',
                'EXPLORER - 탐험가 (호기심, 실험적)',
                'GUARDIAN - 수호자 (신중함, 보호적)',
                'PERFORMER - 연기자 (표현적, 활발함)',
                'MEDIATOR - 중재자 (균형적, 평화적)'
            ],
            teams: [
                'CODE1 - Frontend Masters (1250명)',
                'CODE2 - Backend Engineers (1250명)',
                'CODE3 - Central Command (1750명)',
                'CODE4 - Security Guardians (1250명)'
            ],
            portAllocation: 'AI마다 고유 포트 (20001-25000)',
            skillSystem: 'Technical Skills + Soft Skills + Specialties'
        }
    };
});
const start = async () => {
    try {
        await fastify.listen({
            port: 3000,
            host: '0.0.0.0'
        });
        console.log('\n🔥 KIMDB AI Enhanced Server Started!');
        console.log('==========================================');
        console.log('📡 Main API: http://localhost:3000');
        console.log('📊 Health: http://localhost:3000/health');
        console.log('📈 Stats: http://localhost:3000/stats');
        console.log('📖 Docs: http://localhost:3000/docs');
        console.log('🤖 AI Init: http://localhost:3000/ai/init');
        console.log('📊 AI Stats: http://localhost:3000/ai/stats');
        console.log('==========================================');
        console.log('');
        console.log('🚀 Quick Start:');
        console.log('1. curl http://localhost:3000/ai/init');
        console.log('2. curl http://localhost:3000/ai/stats');
        console.log('3. curl http://localhost:3000/ai/team/CODE1');
        console.log('==========================================\n');
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
//# sourceMappingURL=server-ai.js.map