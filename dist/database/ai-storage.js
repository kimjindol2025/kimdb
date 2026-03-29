/**
 * 🗄️ KIMDB AI Storage - 5000명 AI 영구 저장
 * SQLite 기반 완전 자체 구현 저장소
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { join } from 'path';
export class AIDatabase {
    db;
    dbPath;
    constructor() {
        this.dbPath = join(process.cwd(), 'kimdb_ai_data.db');
        this.db = new Database(this.dbPath);
        this.initializeTables();
        console.log(`📄 KIMDB AI Database initialized: ${this.dbPath}`);
    }
    /**
     * 데이터베이스 테이블 초기화
     */
    initializeTables() {
        // AI 에이전트 테이블
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        team TEXT NOT NULL,
        port INTEGER UNIQUE,
        personality TEXT NOT NULL,
        skills TEXT NOT NULL,  -- JSON array
        status TEXT NOT NULL,
        created_at DATETIME NOT NULL,
        stored_at DATETIME NOT NULL,
        version INTEGER DEFAULT 1,
        last_interaction DATETIME,
        total_interactions INTEGER DEFAULT 0
      )
    `);
        // AI 상호작용 로그 테이블
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_interactions (
        id TEXT PRIMARY KEY,
        ai_id TEXT NOT NULL,
        user_id TEXT,
        message TEXT NOT NULL,
        response TEXT NOT NULL,
        timestamp DATETIME NOT NULL,
        response_time INTEGER NOT NULL,
        FOREIGN KEY (ai_id) REFERENCES ai_agents(id)
      )
    `);
        // AI 컬렉션 테이블 (그룹화)
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        ai_ids TEXT NOT NULL,  -- JSON array
        created_at DATETIME NOT NULL,
        tags TEXT              -- JSON array
      )
    `);
        // 인덱스 생성
        this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ai_team ON ai_agents(team);
      CREATE INDEX IF NOT EXISTS idx_ai_personality ON ai_agents(personality);
      CREATE INDEX IF NOT EXISTS idx_ai_status ON ai_agents(status);
      CREATE INDEX IF NOT EXISTS idx_ai_port ON ai_agents(port);
      CREATE INDEX IF NOT EXISTS idx_interactions_ai_id ON ai_interactions(ai_id);
      CREATE INDEX IF NOT EXISTS idx_interactions_timestamp ON ai_interactions(timestamp);
    `);
        console.log('✅ Database tables and indexes initialized');
    }
    /**
     * 5000명 AI를 데이터베이스에 저장
     */
    async saveAIs(ais) {
        console.log(`💾 Saving ${ais.length} AI agents to database...`);
        const startTime = Date.now();
        const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO ai_agents (
        id, name, team, port, personality, skills, status,
        created_at, stored_at, version, total_interactions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        // 트랜잭션으로 일괄 처리
        const transaction = this.db.transaction((aiList) => {
            for (const ai of aiList) {
                insertStmt.run(ai.id, ai.name, ai.team, ai.port, ai.personality, JSON.stringify(ai.skills), ai.status, ai.createdAt.toISOString(), new Date().toISOString(), 1, 0);
            }
        });
        transaction(ais);
        const elapsed = Date.now() - startTime;
        console.log(`✅ ${ais.length} AI agents saved in ${elapsed}ms`);
    }
    /**
     * AI 조회 (필터 지원)
     */
    async getAIs(options = {}) {
        const { team, personality, status, limit = 100, offset = 0, skills } = options;
        let query = 'SELECT * FROM ai_agents WHERE 1=1';
        const params = [];
        if (team) {
            query += ' AND team = ?';
            params.push(team);
        }
        if (personality) {
            query += ' AND personality = ?';
            params.push(personality);
        }
        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }
        if (skills) {
            query += ' AND skills LIKE ?';
            params.push(`%${skills}%`);
        }
        query += ' ORDER BY id LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const stmt = this.db.prepare(query);
        const rows = stmt.all(...params);
        return rows.map(row => ({
            id: row.id,
            name: row.name,
            team: row.team,
            port: row.port,
            personality: row.personality,
            skills: JSON.parse(row.skills),
            status: row.status,
            createdAt: new Date(row.created_at),
            storedAt: new Date(row.stored_at),
            version: row.version,
            lastInteraction: row.last_interaction ? new Date(row.last_interaction) : undefined,
            totalInteractions: row.total_interactions
        }));
    }
    /**
     * 특정 AI 조회
     */
    async getAI(id) {
        const stmt = this.db.prepare('SELECT * FROM ai_agents WHERE id = ?');
        const row = stmt.get(id);
        if (!row)
            return null;
        return {
            id: row.id,
            name: row.name,
            team: row.team,
            port: row.port,
            personality: row.personality,
            skills: JSON.parse(row.skills),
            status: row.status,
            createdAt: new Date(row.created_at),
            storedAt: new Date(row.stored_at),
            version: row.version,
            lastInteraction: row.last_interaction ? new Date(row.last_interaction) : undefined,
            totalInteractions: row.total_interactions
        };
    }
    /**
     * AI 상호작용 저장
     */
    async saveInteraction(interaction) {
        const interactionId = randomUUID();
        const insertStmt = this.db.prepare(`
      INSERT INTO ai_interactions (id, ai_id, user_id, message, response, timestamp, response_time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        const updateStmt = this.db.prepare(`
      UPDATE ai_agents 
      SET last_interaction = ?, total_interactions = total_interactions + 1
      WHERE id = ?
    `);
        // 트랜잭션으로 상호작용 저장 + AI 정보 업데이트
        const transaction = this.db.transaction(() => {
            insertStmt.run(interactionId, interaction.aiId, interaction.userId || null, interaction.message, interaction.response, new Date().toISOString(), interaction.responseTime);
            updateStmt.run(new Date().toISOString(), interaction.aiId);
        });
        transaction();
        return interactionId;
    }
    /**
     * AI 상호작용 기록 조회
     */
    async getInteractions(aiId, limit = 10) {
        const stmt = this.db.prepare(`
      SELECT * FROM ai_interactions 
      WHERE ai_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `);
        const rows = stmt.all(aiId, limit);
        return rows.map(row => ({
            id: row.id,
            aiId: row.ai_id,
            userId: row.user_id,
            message: row.message,
            response: row.response,
            timestamp: new Date(row.timestamp),
            responseTime: row.response_time
        }));
    }
    /**
     * AI 컬렉션 생성 (그룹화)
     */
    async createCollection(collection) {
        const collectionId = randomUUID();
        const stmt = this.db.prepare(`
      INSERT INTO ai_collections (id, name, description, ai_ids, created_at, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        stmt.run(collectionId, collection.name, collection.description || '', JSON.stringify(collection.aiIds), new Date().toISOString(), JSON.stringify(collection.tags || []));
        console.log(`📁 Created AI collection: ${collection.name} (${collection.aiIds.length} AIs)`);
        return collectionId;
    }
    /**
     * 통계 정보
     */
    async getStats() {
        // 기본 통계
        const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM ai_agents');
        const totalAIs = totalStmt.get();
        // 팀별 통계
        const teamStmt = this.db.prepare('SELECT team, COUNT(*) as count FROM ai_agents GROUP BY team');
        const teamStats = teamStmt.all();
        // 성격별 통계
        const personalityStmt = this.db.prepare('SELECT personality, COUNT(*) as count FROM ai_agents GROUP BY personality');
        const personalityStats = personalityStmt.all();
        // 상태별 통계
        const statusStmt = this.db.prepare('SELECT status, COUNT(*) as count FROM ai_agents GROUP BY status');
        const statusStats = statusStmt.all();
        // 상호작용 통계
        const interactionStmt = this.db.prepare('SELECT COUNT(*) as count FROM ai_interactions');
        const totalInteractions = interactionStmt.get();
        // 가장 활발한 AI
        const mostActiveStmt = this.db.prepare(`
      SELECT id, name, total_interactions 
      FROM ai_agents 
      WHERE total_interactions > 0 
      ORDER BY total_interactions DESC 
      LIMIT 1
    `);
        const mostActive = mostActiveStmt.get();
        return {
            totalAIs: totalAIs.count,
            byTeam: Object.fromEntries(teamStats.map(row => [row.team, row.count])),
            byPersonality: Object.fromEntries(personalityStats.map(row => [row.personality, row.count])),
            byStatus: Object.fromEntries(statusStats.map(row => [row.status, row.count])),
            totalInteractions: totalInteractions.count,
            averageInteractionsPerAI: totalAIs.count > 0 ? totalInteractions.count / totalAIs.count : 0,
            mostActiveAI: mostActive ? {
                id: mostActive.id,
                name: mostActive.name,
                interactions: mostActive.total_interactions
            } : undefined
        };
    }
    /**
     * AI 검색 (스킬, 이름, 성격 기반)
     */
    async searchAIs(query, limit = 20) {
        const stmt = this.db.prepare(`
      SELECT * FROM ai_agents 
      WHERE name LIKE ? OR personality LIKE ? OR skills LIKE ?
      ORDER BY total_interactions DESC
      LIMIT ?
    `);
        const searchPattern = `%${query}%`;
        const rows = stmt.all(searchPattern, searchPattern, searchPattern, limit);
        return rows.map(row => ({
            id: row.id,
            name: row.name,
            team: row.team,
            port: row.port,
            personality: row.personality,
            skills: JSON.parse(row.skills),
            status: row.status,
            createdAt: new Date(row.created_at),
            storedAt: new Date(row.stored_at),
            version: row.version,
            lastInteraction: row.last_interaction ? new Date(row.last_interaction) : undefined,
            totalInteractions: row.total_interactions
        }));
    }
    /**
     * 데이터베이스 정보
     */
    getDatabaseInfo() {
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const pragma = this.db.pragma('database_list')[0];
        return {
            path: this.dbPath,
            size: this.getDatabaseSize(),
            tables: tables.map(t => t.name),
            pragma
        };
    }
    getDatabaseSize() {
        try {
            const fs = require('fs');
            const stats = fs.statSync(this.dbPath);
            return stats.size;
        }
        catch {
            return 0;
        }
    }
    /**
     * 데이터베이스 연결 종료
     */
    close() {
        this.db.close();
        console.log('🔒 KIMDB AI Database connection closed');
    }
}
// 싱글톤 인스턴스
export const aiDatabase = new AIDatabase();
//# sourceMappingURL=ai-storage.js.map