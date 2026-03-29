/**
 * kimdb Simple REST Client v1.0.0
 *
 * 간단한 get/set API
 * kimdb 서버의 REST + SQL API 사용
 *
 * 사용법:
 *   const db = new KimDB('https://db.dclub.kr');
 *   await db.set('users', 'user123', { name: '김철수' });
 *   const user = await db.get('users', 'user123');
 */

class KimDB {
  constructor(url, options = {}) {
    this.baseUrl = url.replace(/\/$/, '');
    this.apiKey = options.apiKey || '';
    this.timeout = options.timeout || 5000;
  }

  // 헤더 생성
  _headers() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    return headers;
  }

  // HTTP 요청
  async _request(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const options = {
      method,
      headers: this._headers()
    };

    if (body) options.body = JSON.stringify(body);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    options.signal = controller.signal;

    try {
      const res = await fetch(url, options);
      clearTimeout(timeoutId);

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`HTTP ${res.status}: ${error}`);
      }

      return res.json();
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw e;
    }
  }

  // SQL 쿼리 실행
  async _sql(collection, sql, params = []) {
    return this._request('POST', '/api/sql', { collection, sql, params });
  }

  // ===== 핵심 API =====

  /**
   * 데이터 저장 (INSERT or UPDATE)
   * @param {string} collection - 컬렉션 이름 (테이블)
   * @param {string} id - 문서 ID
   * @param {object} data - 저장할 데이터
   * @returns {Promise<{id, _version}>}
   */
  async set(collection, id, data) {
    // PUT API - upsert (insert or update)
    const result = await this._request('PUT', `/api/c/${collection}/${id}`, { data });
    return { id: result.id, _version: result._version };
  }

  /**
   * 데이터 조회
   * @param {string} collection - 컬렉션 이름
   * @param {string} id - 문서 ID
   * @returns {Promise<{id, data, _version} | null>}
   */
  async get(collection, id) {
    try {
      const result = await this._request('GET', `/api/c/${collection}/${id}`);
      if (result.success && result.id) {
        return { id: result.id, data: result.data, _version: result._version };
      }
      return null;
    } catch (e) {
      if (e.message.includes('404')) return null;
      throw e;
    }
  }

  /**
   * 데이터 삭제
   * @param {string} collection - 컬렉션 이름
   * @param {string} id - 문서 ID
   * @returns {Promise<{deleted: number}>}
   */
  async delete(collection, id) {
    // DELETE API - 소프트 삭제
    try {
      await this._request('DELETE', `/api/c/${collection}/${id}`);
      return { deleted: 1 };
    } catch (e) {
      if (e.message.includes('404')) return { deleted: 0 };
      throw e;
    }
  }

  /**
   * 컬렉션 전체 조회
   * @param {string} collection - 컬렉션 이름
   * @param {object} options - { limit, offset, orderBy, order }
   * @returns {Promise<Array>}
   */
  async list(collection, options = {}) {
    const result = await this._request('GET', `/api/c/${collection}`);
    let data = result.data || [];

    // 클라이언트 측 정렬/페이지네이션
    if (options.orderBy) {
      const dir = (options.order || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;
      data.sort((a, b) => {
        const aVal = a.data?.[options.orderBy] || a[options.orderBy];
        const bVal = b.data?.[options.orderBy] || b[options.orderBy];
        if (aVal < bVal) return -dir;
        if (aVal > bVal) return dir;
        return 0;
      });
    }

    if (options.offset) data = data.slice(options.offset);
    if (options.limit) data = data.slice(0, options.limit);

    return data;
  }

  /**
   * 데이터 생성 (ID 자동 생성)
   * @param {string} collection - 컬렉션 이름
   * @param {object} data - 저장할 데이터
   * @returns {Promise<{id, _version}>}
   */
  async create(collection, data) {
    // POST API - ID 자동 생성
    const result = await this._request('POST', `/api/c/${collection}`, { data });
    return { id: result.id, _version: result._version };
  }

  /**
   * 데이터 부분 업데이트 (PATCH)
   * @param {string} collection - 컬렉션 이름
   * @param {string} id - 문서 ID
   * @param {object} data - 업데이트할 필드
   * @returns {Promise<{id, _version}>}
   */
  async update(collection, id, data) {
    // PATCH API - 부분 업데이트
    const result = await this._request('PATCH', `/api/c/${collection}/${id}`, { data });
    return { id: result.id, _version: result._version };
  }

  // ===== SQL API =====

  /**
   * SQL 쿼리 실행 (SELECT)
   * @param {string} collection - 컬렉션 이름
   * @param {string} sql - SQL 쿼리
   * @param {Array} params - 바인딩 파라미터
   * @returns {Promise<Array>}
   */
  async query(collection, sql, params = []) {
    const result = await this._sql(collection, sql, params);
    return result.rows || [];
  }

  /**
   * SQL 실행 (INSERT/UPDATE/DELETE)
   * @param {string} collection - 컬렉션 이름
   * @param {string} sql - SQL 쿼리
   * @param {Array} params - 바인딩 파라미터
   * @returns {Promise<{success, row?, updated?, deleted?}>}
   */
  async execute(collection, sql, params = []) {
    return this._sql(collection, sql, params);
  }

  // ===== 유틸리티 =====

  /**
   * 서버 상태 확인
   * @returns {Promise<{status, version}>}
   */
  async health() {
    return this._request('GET', '/health');
  }

  /**
   * 컬렉션 존재 여부
   * @param {string} collection - 컬렉션 이름
   * @param {string} id - 문서 ID
   * @returns {Promise<boolean>}
   */
  async exists(collection, id) {
    const result = await this.get(collection, id);
    return result !== null;
  }

  /**
   * 여러 문서 조회
   * @param {string} collection - 컬렉션 이름
   * @param {Array<string>} ids - 문서 ID 배열
   * @returns {Promise<Array>}
   */
  async getMany(collection, ids) {
    const promises = ids.map(id => this.get(collection, id));
    const results = await Promise.all(promises);
    return results.filter(r => r !== null);
  }

  /**
   * 여러 문서 저장
   * @param {string} collection - 컬렉션 이름
   * @param {Array<{id, data}>} docs - 문서 배열
   * @returns {Promise<Array>}
   */
  async setMany(collection, docs) {
    const promises = docs.map(doc => this.set(collection, doc.id, doc.data));
    return Promise.all(promises);
  }

  /**
   * 검색 (WHERE 조건)
   * @param {string} collection - 컬렉션 이름
   * @param {string} field - 필드명 (예: name, email)
   * @param {string} op - 연산자 (=, !=, >, <, >=, <=, LIKE)
   * @param {any} value - 비교 값
   * @returns {Promise<Array>}
   */
  async find(collection, field, op, value) {
    const result = await this._sql(collection,
      `SELECT * FROM ${collection} WHERE ${field} ${op} ?`,
      [value]
    );
    return result.rows || [];
  }

  /**
   * 카운트
   * @param {string} collection - 컬렉션 이름
   * @returns {Promise<number>}
   */
  async count(collection) {
    const result = await this._sql(collection,
      `SELECT COUNT(*) as cnt FROM ${collection}`
    );
    return result.rows?.[0]?.cnt || 0;
  }

  /**
   * 컬렉션 목록
   * @returns {Promise<Array<string>>}
   */
  async collections() {
    const result = await this._request('GET', '/api/collections');
    return result.collections || [];
  }
}

// ===== 컬렉션 래퍼 =====
class Collection {
  constructor(db, name) {
    this.db = db;
    this.name = name;
  }

  set(id, data) { return this.db.set(this.name, id, data); }
  get(id) { return this.db.get(this.name, id); }
  delete(id) { return this.db.delete(this.name, id); }
  list(options) { return this.db.list(this.name, options); }
  create(data) { return this.db.create(this.name, data); }
  update(id, data) { return this.db.update(this.name, id, data); }
  find(field, op, value) { return this.db.find(this.name, field, op, value); }
  count() { return this.db.count(this.name); }
  exists(id) { return this.db.exists(this.name, id); }
  query(sql, params) { return this.db.query(this.name, sql, params); }
  execute(sql, params) { return this.db.execute(this.name, sql, params); }
}

// 컬렉션 프록시 추가
KimDB.prototype.collection = function(name) {
  return new Collection(this, name);
};

// ===== Export =====
export { KimDB, Collection };
export default KimDB;

// Browser global
if (typeof window !== 'undefined') {
  window.KimDB = KimDB;
}

// Node.js CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KimDB, Collection };
}
