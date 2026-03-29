import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { join } from 'path';
const fastify = Fastify({
    logger: {
        level: 'info',
        transport: {
            target: 'pino-pretty'
        }
    }
});
await fastify.register(import('@fastify/cors'), {
    origin: ['http://localhost:3000', 'http://localhost:4000'],
    credentials: true
});
const mainDB = new Database(join(process.cwd(), 'kimdb_ai_data.db'));
const sharedDB = new Database('/home/kimjin/바탕화면/kim/shared_database/shared_ai_knowledge.db');
console.log('🗄️ Database Server 초기화...');
fastify.get('/db/ai', async (request, reply) => {
    const query = request.query;
    const limit = parseInt(query.limit) || 50;
    const offset = parseInt(query.offset) || 0;
    const team = query.team;
    try {
        let sql = 'SELECT * FROM ai_agents WHERE 1=1';
        const params = [];
        if (team) {
            sql += ' AND team = ?';
            params.push(team);
        }
        sql += ' ORDER BY id LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const stmt = mainDB.prepare(sql);
        const ais = stmt.all(...params);
        const parsedAIs = ais.map((ai) => ({
            ...ai,
            skills: JSON.parse(ai.skills),
            createdAt: new Date(ai.created_at),
            storedAt: new Date(ai.stored_at)
        }));
        return {
            success: true,
            data: parsedAIs,
            pagination: {
                limit,
                offset,
                total: mainDB.prepare('SELECT COUNT(*) as count FROM ai_agents').get()
            }
        };
    }
    catch (error) {
        return reply.code(500).send({
            success: false,
            error: error.message
        });
    }
});
fastify.get('/db/ai/stats', async (request, reply) => {
    try {
        const totalCount = mainDB.prepare('SELECT COUNT(*) as count FROM ai_agents').get();
        const teamStats = mainDB.prepare('SELECT team, COUNT(*) as count FROM ai_agents GROUP BY team').all();
        const personalityStats = mainDB.prepare('SELECT personality, COUNT(*) as count FROM ai_agents GROUP BY personality').all();
        const statusStats = mainDB.prepare('SELECT status, COUNT(*) as count FROM ai_agents GROUP BY status').all();
        return {
            success: true,
            data: {
                total: totalCount.count,
                byTeam: Object.fromEntries(teamStats.map(row => [row.team, row.count])),
                byPersonality: Object.fromEntries(personalityStats.map(row => [row.personality, row.count])),
                byStatus: Object.fromEntries(statusStats.map(row => [row.status, row.count]))
            }
        };
    }
    catch (error) {
        return reply.code(500).send({
            success: false,
            error: error.message
        });
    }
});
fastify.get('/db/ai/:id', async (request, reply) => {
    const { id } = request.params;
    try {
        const stmt = mainDB.prepare('SELECT * FROM ai_agents WHERE id = ?');
        const ai = stmt.get(id);
        if (!ai) {
            return reply.code(404).send({
                success: false,
                error: 'AI not found'
            });
        }
        return {
            success: true,
            data: {
                ...ai,
                skills: JSON.parse(ai.skills),
                createdAt: new Date(ai.created_at),
                storedAt: new Date(ai.stored_at)
            }
        };
    }
    catch (error) {
        return reply.code(500).send({
            success: false,
            error: error.message
        });
    }
});
fastify.get('/db/ai/search', async (request, reply) => {
    const { q, limit = 20 } = request.query;
    if (!q || q.length < 2) {
        return reply.code(400).send({
            success: false,
            error: 'Query must be at least 2 characters'
        });
    }
    try {
        const stmt = mainDB.prepare(`
      SELECT * FROM ai_agents 
      WHERE name LIKE ? OR personality LIKE ? OR skills LIKE ?
      ORDER BY id LIMIT ?
    `);
        const searchPattern = `%${q}%`;
        const results = stmt.all(searchPattern, searchPattern, searchPattern, parseInt(limit));
        const parsedResults = results.map((ai) => ({
            ...ai,
            skills: JSON.parse(ai.skills),
            createdAt: new Date(ai.created_at),
            storedAt: new Date(ai.stored_at)
        }));
        return {
            success: true,
            data: parsedResults,
            count: parsedResults.length
        };
    }
    catch (error) {
        return reply.code(500).send({
            success: false,
            error: error.message
        });
    }
});
fastify.get('/db/ai/team/:team', async (request, reply) => {
    const { team } = request.params;
    if (!['CODE1', 'CODE2', 'CODE3', 'CODE4'].includes(team)) {
        return reply.code(400).send({
            success: false,
            error: 'Invalid team'
        });
    }
    try {
        const stmt = mainDB.prepare('SELECT * FROM ai_agents WHERE team = ? ORDER BY id');
        const teamAIs = stmt.all(team);
        const parsedAIs = teamAIs.map((ai) => ({
            ...ai,
            skills: JSON.parse(ai.skills),
            createdAt: new Date(ai.created_at),
            storedAt: new Date(ai.stored_at)
        }));
        return {
            success: true,
            data: parsedAIs,
            count: parsedAIs.length
        };
    }
    catch (error) {
        return reply.code(500).send({
            success: false,
            error: error.message
        });
    }
});
fastify.get('/db/knowledge', async (request, reply) => {
    try {
        const stmt = sharedDB.prepare('SELECT * FROM ai_knowledge ORDER BY created_at DESC');
        const knowledge = stmt.all();
        return {
            success: true,
            data: knowledge
        };
    }
    catch (error) {
        return reply.code(500).send({
            success: false,
            error: error.message
        });
    }
});
fastify.get('/db/collaboration', async (request, reply) => {
    try {
        const stmt = sharedDB.prepare('SELECT * FROM ai_collaboration WHERE status = ? ORDER BY created_at DESC');
        const projects = stmt.all('active');
        return {
            success: true,
            data: projects
        };
    }
    catch (error) {
        return reply.code(500).send({
            success: false,
            error: error.message
        });
    }
});
fastify.get('/db/files', async (request, reply) => {
    const { phase, type } = request.query;
    try {
        let sql = 'SELECT * FROM project_files WHERE 1=1';
        const params = [];
        if (phase) {
            sql += ' AND project_phase = ?';
            params.push(phase);
        }
        if (type) {
            sql += ' AND file_type = ?';
            params.push(type);
        }
        sql += ' ORDER BY created_at DESC';
        const stmt = sharedDB.prepare(sql);
        const files = stmt.all(...params);
        return {
            success: true,
            data: files
        };
    }
    catch (error) {
        return reply.code(500).send({
            success: false,
            error: error.message
        });
    }
});
fastify.get('/db/metadata', async (request, reply) => {
    try {
        const stmt = sharedDB.prepare('SELECT * FROM kimdb_metadata ORDER BY created_at DESC');
        const metadata = stmt.all();
        return {
            success: true,
            data: metadata
        };
    }
    catch (error) {
        return reply.code(500).send({
            success: false,
            error: error.message
        });
    }
});
fastify.get('/db/statistics', async (request, reply) => {
    const { type } = request.query;
    try {
        let sql = 'SELECT * FROM project_statistics';
        const params = [];
        if (type) {
            sql += ' WHERE metric_type = ?';
            params.push(type);
        }
        sql += ' ORDER BY measurement_time DESC';
        const stmt = sharedDB.prepare(sql);
        const stats = stmt.all(...params);
        return {
            success: true,
            data: stats
        };
    }
    catch (error) {
        return reply.code(500).send({
            success: false,
            error: error.message
        });
    }
});
fastify.post('/db/ai/:id/interaction', async (request, reply) => {
    const { id } = request.params;
    const { message, response, responseTime } = request.body;
    try {
        const aiExists = mainDB.prepare('SELECT id FROM ai_agents WHERE id = ?').get(id);
        if (!aiExists) {
            return reply.code(404).send({
                success: false,
                error: 'AI not found'
            });
        }
        const interactionId = `interaction_${Date.now()}`;
        const updateStmt = mainDB.prepare(`
      UPDATE ai_agents 
      SET last_interaction = ?, total_interactions = total_interactions + 1
      WHERE id = ?
    `);
        updateStmt.run(new Date().toISOString(), id);
        return {
            success: true,
            data: {
                interactionId,
                aiId: id,
                message,
                response,
                responseTime,
                timestamp: new Date()
            }
        };
    }
    catch (error) {
        return reply.code(500).send({
            success: false,
            error: error.message
        });
    }
});
fastify.get('/db/status', async (request, reply) => {
    try {
        const mainDBInfo = {
            path: 'kimdb_ai_data.db',
            tables: mainDB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
            size: 'Available'
        };
        const sharedDBInfo = {
            path: '/home/kimjin/바탕화면/kim/shared_database/shared_ai_knowledge.db',
            tables: sharedDB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
            size: 'Available'
        };
        return {
            success: true,
            data: {
                mainDatabase: mainDBInfo,
                sharedDatabase: sharedDBInfo,
                serverStatus: 'running',
                timestamp: new Date()
            }
        };
    }
    catch (error) {
        return reply.code(500).send({
            success: false,
            error: error.message
        });
    }
});
fastify.get('/health', async () => {
    return {
        status: 'healthy',
        service: 'KIMDB Database Server',
        databases: {
            main: 'connected',
            shared: 'connected'
        },
        timestamp: new Date().toISOString()
    };
});
const start = async () => {
    try {
        await fastify.listen({ port: 4000, host: '0.0.0.0' });
        console.log('\n🗄️ KIMDB Database Server Started!');
        console.log('=========================================');
        console.log('🔗 Database API: http://localhost:4000');
        console.log('📊 Status: http://localhost:4000/db/status');
        console.log('❤️ Health: http://localhost:4000/health');
        console.log('🤖 AI Data: http://localhost:4000/db/ai');
        console.log('🧠 Knowledge: http://localhost:4000/db/knowledge');
        console.log('=========================================\n');
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
process.on('SIGINT', () => {
    console.log('\n🔒 Closing database connections...');
    mainDB.close();
    sharedDB.close();
    process.exit(0);
});
start();
//# sourceMappingURL=database-server.js.map