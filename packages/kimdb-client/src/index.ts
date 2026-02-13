/**
 * KimDB Client - High-performance document database client
 * @module @kimdb/client
 */

export interface KimDBConfig {
  baseUrl: string;
  token?: string;
  apiKey?: string;
  timeout?: number;
  retries?: number;
}

export interface DocumentQuery {
  limit?: number;
  skip?: number;
  sort?: string;
}

export interface SQLQuery {
  sql: string;
  params?: (string | number | boolean | null)[];
  collection: string;
}

export interface Document {
  id: string;
  data: Record<string, unknown>;
  _version: number;
  _created?: string;
  _updated?: string;
}

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface CollectionResponse {
  success: boolean;
  collection: string;
  count: number;
  data: Document[];
}

export interface SQLResponse {
  success: boolean;
  rows: Record<string, unknown>[];
  count: number;
}

export interface MetricsResponse {
  success: boolean;
  version: string;
  serverId: string;
  uptime_seconds: number;
  requests: {
    total: number;
    success: number;
    error: number;
  };
  websocket: {
    connections: number;
    peak: number;
    messages: {
      sent: number;
      received: number;
    };
    broadcasts: number;
  };
  sync: {
    operations: number;
    conflicts: number;
  };
  cache: {
    hits: number;
    misses: number;
    evictions: number;
  };
  memory: {
    cachedDocs: number;
    presenceManagers: number;
    undoManagers: number;
    heapUsed: string;
  };
}

/**
 * KimDB REST Client
 * Provides synchronous REST API access to KimDB
 */
export class KimDBClient {
  private baseUrl: string;
  private token?: string;
  private apiKey?: string;
  private timeout: number;
  private retries: number;

  constructor(config: KimDBConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000;
    this.retries = config.retries || 3;
  }

  /**
   * Make HTTP request with error handling and retries
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        };

        if (this.token) {
          headers.Authorization = `Bearer ${this.token}`;
        } else if (this.apiKey) {
          headers['X-API-Key'] = this.apiKey;
        }

        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeout),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(error.error || `HTTP ${response.status}`);
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.retries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError || new Error('Unknown error');
  }

  /**
   * Health check
   */
  async health(): Promise<{ status: string; version: string; uptime: number }> {
    return this.request('GET', '/health');
  }

  /**
   * Get metrics
   */
  async metrics(): Promise<MetricsResponse> {
    return this.request('GET', '/api/metrics');
  }

  /**
   * List all collections
   */
  async listCollections(): Promise<string[]> {
    const response = await this.request<{ success: boolean; collections: string[] }>(
      'GET',
      '/api/collections'
    );
    return response.collections;
  }

  /**
   * Get all documents in a collection
   */
  async getCollection(
    collection: string,
    query?: DocumentQuery
  ): Promise<CollectionResponse> {
    const params = new URLSearchParams();
    if (query?.limit) params.append('limit', String(query.limit));
    if (query?.skip) params.append('skip', String(query.skip));
    if (query?.sort) params.append('sort', query.sort);

    const path = `/api/c/${collection}${params.toString() ? `?${params}` : ''}`;
    return this.request('GET', path);
  }

  /**
   * Get a specific document
   */
  async getDocument(collection: string, id: string): Promise<Document> {
    const response = await this.request<{ success: boolean; id: string; data: Record<string, unknown>; _version: number }>(
      'GET',
      `/api/c/${collection}/${id}`
    );
    return {
      id: response.id,
      data: response.data,
      _version: response._version,
    };
  }

  /**
   * Execute SQL query
   */
  async query(sqlQuery: SQLQuery): Promise<SQLResponse> {
    return this.request('POST', '/api/sql', sqlQuery);
  }

  /**
   * Helper: Query users by age
   */
  async queryUsersByAge(minAge: number): Promise<Record<string, unknown>[]> {
    const response = await this.query({
      sql: 'SELECT * FROM users WHERE age > ? ORDER BY name',
      params: [minAge],
      collection: 'users',
    });
    return response.rows;
  }

  /**
   * Helper: Count documents
   */
  async count(collection: string, whereClause?: string): Promise<number> {
    const sql = whereClause ? `SELECT COUNT(*) as total FROM ${collection} WHERE ${whereClause}` : `SELECT COUNT(*) as total FROM ${collection}`;
    const response = await this.query({ sql, collection });
    return (response.rows[0]?.total as number) || 0;
  }

  /**
   * Helper: Group by aggregation
   */
  async groupBy(collection: string, field: string): Promise<{ [key: string]: number }> {
    const response = await this.query({
      sql: `SELECT ${field}, COUNT(*) as count FROM ${collection} GROUP BY ${field}`,
      collection,
    });

    const result: { [key: string]: number } = {};
    response.rows.forEach((row) => {
      result[String(row[field])] = (row.count as number) || 0;
    });
    return result;
  }
}

export default KimDBClient;
