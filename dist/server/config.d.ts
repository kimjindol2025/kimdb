/**
 * kimdb Server Configuration
 *
 * 환경변수 기반 설정 - 보안 강화
 */
import { z } from 'zod';
declare const ConfigSchema: z.ZodObject<{
    port: z.ZodDefault<z.ZodNumber>;
    host: z.ZodDefault<z.ZodString>;
    apiKey: z.ZodString;
    dataDir: z.ZodDefault<z.ZodString>;
    redis: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        host: z.ZodDefault<z.ZodString>;
        port: z.ZodDefault<z.ZodNumber>;
        password: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        port?: number;
        host?: string;
        enabled?: boolean;
        password?: string;
    }, {
        port?: number;
        host?: string;
        enabled?: boolean;
        password?: string;
    }>>;
    mariadb: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        host: z.ZodDefault<z.ZodString>;
        port: z.ZodDefault<z.ZodNumber>;
        user: z.ZodDefault<z.ZodString>;
        password: z.ZodOptional<z.ZodString>;
        database: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        port?: number;
        host?: string;
        enabled?: boolean;
        password?: string;
        user?: string;
        database?: string;
    }, {
        port?: number;
        host?: string;
        enabled?: boolean;
        password?: string;
        user?: string;
        database?: string;
    }>>;
    cache: z.ZodDefault<z.ZodObject<{
        maxDocs: z.ZodDefault<z.ZodNumber>;
        docTTL: z.ZodDefault<z.ZodNumber>;
        presenceTTL: z.ZodDefault<z.ZodNumber>;
        undoTTL: z.ZodDefault<z.ZodNumber>;
        cleanupInterval: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        maxDocs?: number;
        docTTL?: number;
        presenceTTL?: number;
        undoTTL?: number;
        cleanupInterval?: number;
    }, {
        maxDocs?: number;
        docTTL?: number;
        presenceTTL?: number;
        undoTTL?: number;
        cleanupInterval?: number;
    }>>;
    cors: z.ZodDefault<z.ZodObject<{
        origins: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        credentials: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        origins?: string[];
        credentials?: boolean;
    }, {
        origins?: string[];
        credentials?: boolean;
    }>>;
    serverId: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    port?: number;
    host?: string;
    apiKey?: string;
    dataDir?: string;
    redis?: {
        port?: number;
        host?: string;
        enabled?: boolean;
        password?: string;
    };
    mariadb?: {
        port?: number;
        host?: string;
        enabled?: boolean;
        password?: string;
        user?: string;
        database?: string;
    };
    cache?: {
        maxDocs?: number;
        docTTL?: number;
        presenceTTL?: number;
        undoTTL?: number;
        cleanupInterval?: number;
    };
    cors?: {
        origins?: string[];
        credentials?: boolean;
    };
    serverId?: string;
}, {
    port?: number;
    host?: string;
    apiKey?: string;
    dataDir?: string;
    redis?: {
        port?: number;
        host?: string;
        enabled?: boolean;
        password?: string;
    };
    mariadb?: {
        port?: number;
        host?: string;
        enabled?: boolean;
        password?: string;
        user?: string;
        database?: string;
    };
    cache?: {
        maxDocs?: number;
        docTTL?: number;
        presenceTTL?: number;
        undoTTL?: number;
        cleanupInterval?: number;
    };
    cors?: {
        origins?: string[];
        credentials?: boolean;
    };
    serverId?: string;
}>;
export type Config = z.infer<typeof ConfigSchema>;
/**
 * 환경변수에서 설정 로드
 */
export declare function loadConfig(): Config;
/**
 * 설정 로그 출력 (민감 정보 마스킹)
 */
export declare function logConfig(config: Config): void;
/**
 * .env.example 생성
 */
export declare function generateEnvExample(): string;
export {};
//# sourceMappingURL=config.d.ts.map