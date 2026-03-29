import Fastify from 'fastify';
import { join } from 'path';
import fetch from 'node-fetch';
const fastify = Fastify({
    logger: {
        level: 'info',
        transport: {
            target: 'pino-pretty'
        }
    }
});
await fastify.register(import('@fastify/static'), {
    root: join(process.cwd(), 'public'),
    prefix: '/'
});
const DB_SERVER = 'http://localhost:4000';
console.log('🌐 Web Server 초기화...');
const fetchFromDB = async (endpoint) => {
    try {
        const response = await fetch(`${DB_SERVER}${endpoint}`);
        return await response.json();
    }
    catch (error) {
        console.error(`DB 서버 통신 오류: ${endpoint}`, error);
        return { success: false, error: 'Database server connection failed' };
    }
};
const postToDB = async (endpoint, data) => {
    try {
        const response = await fetch(`${DB_SERVER}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        return await response.json();
    }
    catch (error) {
        console.error(`DB 서버 POST 오류: ${endpoint}`, error);
        return { success: false, error: 'Database server connection failed' };
    }
};
fastify.get('/', async (request, reply) => {
    return reply.redirect('/index.html');
});
fastify.get('/health', async () => {
    const dbStatus = await fetchFromDB('/health');
    return {
        status: 'healthy',
        service: 'KIMDB Web Server',
        databaseServer: dbStatus.success ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    };
});
fastify.get('/ai/init', async (request, reply) => {
    const stats = await fetchFromDB('/db/ai/stats');
    if (stats.success && stats.data.total > 0) {
        return {
            success: true,
            message: `${stats.data.total} AI agents already initialized`,
            count: stats.data.total,
            initTime: 0,
            teams: stats.data.byTeam
        };
    }
    else {
        return reply.code(500).send({
            success: false,
            error: 'Database server not available'
        });
    }
});
fastify.get('/ai/stats', async (request, reply) => {
    const result = await fetchFromDB('/db/ai/stats');
    return result;
});
fastify.get('/ai', async (request, reply) => {
    const queryString = new URLSearchParams(request.query).toString();
    const result = await fetchFromDB(`/db/ai?${queryString}`);
    return result;
});
fastify.get('/ai/:id', async (request, reply) => {
    const { id } = request.params;
    const result = await fetchFromDB(`/db/ai/${id}`);
    if (!result.success) {
        return reply.code(404).send(result);
    }
    return result;
});
fastify.post('/ai/:id/chat', async (request, reply) => {
    const { id } = request.params;
    const { message } = request.body;
    const aiResult = await fetchFromDB(`/db/ai/${id}`);
    if (!aiResult.success) {
        return reply.code(404).send({
            success: false,
            error: 'AI not found'
        });
    }
    const ai = aiResult.data;
    if (ai.status !== 'active' && ai.status !== 'idle') {
        return reply.code(400).send({
            success: false,
            error: `AI is currently ${ai.status}`
        });
    }
    const startTime = Date.now();
    let response = `안녕하세요! 저는 ${ai.name}입니다.`;
    if (ai.personality === 'ANALYZER') {
        response = `분석해보면, "${message}"에 대해 체계적으로 접근해야 합니다.`;
    }
    else if (ai.personality === 'CREATOR') {
        response = `와! 정말 창의적인 아이디어네요! 🎨 "${message}"를 더 발전시켜보면 어떨까요?`;
    }
    else if (ai.personality === 'LEADER') {
        response = `리더 관점에서 "${message}"에 대해 전략적으로 접근해봅시다.`;
    }
    else if (ai.personality === 'SUPPORTER') {
        response = `"${message}"에 대해 최선을 다해 도움드리겠습니다! 😊`;
    }
    else if (ai.personality === 'GUARDIAN') {
        response = `신중하게 보호하면서 "${message}"에 대해 안전하게 진행해야 합니다.`;
    }
    else if (ai.personality === 'EXPLORER') {
        response = `호기심을 가지고 "${message}"를 실험해봅시다! 🚀`;
    }
    else if (ai.personality === 'PERFORMER') {
        response = `활발하게 "${message}"를 표현해보겠습니다! 🎭`;
    }
    else if (ai.personality === 'MEDIATOR') {
        response = `균형잡힌 관점에서 "${message}"에 대해 조화롭게 접근해봅시다.`;
    }
    const responseTime = Date.now() - startTime;
    await postToDB(`/db/ai/${id}/interaction`, {
        message,
        response,
        responseTime
    });
    return {
        success: true,
        data: {
            response,
            aiId: ai.id,
            aiName: ai.name,
            personality: ai.personality,
            responseTime,
            timestamp: new Date()
        }
    };
});
fastify.get('/ai/search', async (request, reply) => {
    const queryString = new URLSearchParams(request.query).toString();
    const result = await fetchFromDB(`/db/ai/search?${queryString}`);
    return result;
});
fastify.get('/ai/team/:team', async (request, reply) => {
    const { team } = request.params;
    const result = await fetchFromDB(`/db/ai/team/${team}`);
    return result;
});
fastify.get('/ai/random', async (request, reply) => {
    const allAIs = await fetchFromDB('/db/ai?limit=5000');
    if (!allAIs.success || allAIs.data.length === 0) {
        return {
            success: false,
            message: 'No AI agents available'
        };
    }
    const randomAI = allAIs.data[Math.floor(Math.random() * allAIs.data.length)];
    return {
        success: true,
        data: randomAI
    };
});
fastify.put('/ai/:id/status', async (request, reply) => {
    const { id } = request.params;
    const { status } = request.body;
    return {
        success: true,
        data: {
            aiId: id,
            status: status,
            updatedAt: new Date()
        }
    };
});
fastify.get('/api/knowledge', async (request, reply) => {
    const result = await fetchFromDB('/db/knowledge');
    return result;
});
fastify.get('/api/collaboration', async (request, reply) => {
    const result = await fetchFromDB('/db/collaboration');
    return result;
});
fastify.get('/api/files', async (request, reply) => {
    const queryString = new URLSearchParams(request.query).toString();
    const result = await fetchFromDB(`/db/files?${queryString}`);
    return result;
});
fastify.get('/api/metadata', async (request, reply) => {
    const result = await fetchFromDB('/db/metadata');
    return result;
});
fastify.get('/api/statistics', async (request, reply) => {
    const queryString = new URLSearchParams(request.query).toString();
    const result = await fetchFromDB(`/db/statistics?${queryString}`);
    return result;
});
fastify.get('/api/db-status', async (request, reply) => {
    const result = await fetchFromDB('/db/status');
    return result;
});
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
const start = async () => {
    try {
        await fastify.listen({ port: 3000, host: '0.0.0.0' });
        console.log('\n🌐 KIMDB Web Server Started!');
        console.log('=====================================');
        console.log('📡 Web Interface: http://localhost:3000');
        console.log('🗄️ Database Server: http://localhost:4000');
        console.log('🤖 AI API: http://localhost:3000/ai/*');
        console.log('📊 DB API: http://localhost:3000/api/*');
        console.log('❤️ Health: http://localhost:3000/health');
        console.log('=====================================\n');
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
//# sourceMappingURL=web-server.js.map