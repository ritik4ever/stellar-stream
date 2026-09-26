import Redis from "ioredis";
import { logger } from "../logger";

/**
 * Cache adapter interface for abstraction between in-memory and Redis implementations.
 */
export interface CacheAdapter {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    del(pattern: string): Promise<number>;
    clear(): Promise<void>;
    isConnected(): boolean;
}

/**
 * In-memory cache implementation (fallback when Redis is unavailable).
 */
class InMemoryCache implements CacheAdapter {
    private cache = new Map<string, { data: any; expiresAt: number }>();

    async get<T>(key: string): Promise<T | null> {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        return entry.data;
    }

    async set<T>(key: string, value: T, ttlSeconds = 30): Promise<void> {
        this.cache.set(key, {
            data: value,
            expiresAt: Date.now() + ttlSeconds * 1000,
        });
    }

    async del(pattern: string): Promise<number> {
        let deleted = 0;
        for (const key of this.cache.keys()) {
            if (key.includes(pattern)) {
                this.cache.delete(key);
                deleted++;
            }
        }
        return deleted;
    }

    async clear(): Promise<void> {
        this.cache.clear();
    }

    isConnected(): boolean {
        return true;
    }
}

/**
 * Redis cache implementation for multi-instance deployments.
 */
class RedisCache implements CacheAdapter {
    private redis: Redis;
    private connected = false;

    constructor(redisUrl: string) {
        this.redis = new Redis(redisUrl, {
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            maxRetriesPerRequest: 3,
            enableReadyCheck: false,
            enableOfflineQueue: false,
        });

        this.redis.on("connect", () => {
            this.connected = true;
            logger.info("redis cache connected");
        });

        this.redis.on("error", (err) => {
            logger.warn({ err }, "redis cache error");
            this.connected = false;
        });

        this.redis.on("close", () => {
            this.connected = false;
            logger.warn("redis cache disconnected");
        });
    }

    async get<T>(key: string): Promise<T | null> {
        try {
            const value = await this.redis.get(key);
            if (!value) return null;
            return JSON.parse(value);
        } catch (err) {
            logger.warn({ err, key }, "failed to get cache key");
            return null;
        }
    }

    async set<T>(key: string, value: T, ttlSeconds = 30): Promise<void> {
        try {
            await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
        } catch (err) {
            logger.warn({ err, key }, "failed to set cache key");
        }
    }

    async del(pattern: string): Promise<number> {
        try {
            const keys = await this.redis.keys(`*${pattern}*`,x);
            if (keys.length === 0) return 0;
            return await this.redis.del(...keys);
        } catch (err) {
            logger.warn({ err, pattern }, "failed to delete cache pattern");
            return 0;
        }
    }

    async clear(): Promise<void> {
        try {
            await this.redis.flushdb();
        } catch (err) {
            logger.warn({ err }, "failed to clear cache");
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    async disconnect(): Promise<void> {
        await this.redis.quit();
    }
}

let cacheInstance: CacheAdapter | null = null;

/**
 * Initializes the cache adapter based on REDIS_URL environment variable.
 * Uses Redis if REDIS_URL is configured, otherwise falls back to in-memory cache.
 * @returns {CacheAdapter} The initialized cache adapter
 */
export function initCache(): CacheAdapter {
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
        logger.info("initializing redis cache");
        cacheInstance = new RedisCache(redisUrl);
    } else {
        logger.info("using in-memory cache");
        cacheInstance = new InMemoryCache();
    }

    return cacheInstance;
}

/**
 * Gets the current cache adapter instance.
 * Must call initCache() first.
 * @returns {CacheAdapter} The cache adapter
 * @throws {Error} If cache has not been initialized
 */
export function getCache(): CacheAdapter {
    if (!cacheInstance) {
        throw new Error("Cache not initialized. Call initCache() first.");
    }
    return cacheInstance;
}

/**
 * Shuts down the cache adapter (mainly for Redis cleanup).
 * @returns {Promise<void>}
 */
export async function shutdownCache(): Promise<void> {
    if (cacheInstance instanceof RedisCache) {
        await cacheInstance.disconnect();
    }
}
