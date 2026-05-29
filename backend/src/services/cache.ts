import Redis from "ioredis";

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

    async set<T>(key: string, value: T, ttlSeconds = 5): Promise<void> {
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
            console.log("✅ Redis cache connected");
        });

        this.redis.on("error", (err) => {
            console.warn("⚠️  Redis cache error:", err.message);
            this.connected = false;
        });

        this.redis.on("close", () => {
            this.connected = false;
            console.warn("⚠️  Redis cache disconnected");
        });
    }

    async get<T>(key: string): Promise<T | null> {
        try {
            const value = await this.redis.get(key);
            if (!value) return null;
            return JSON.parse(value);
        } catch (err) {
            console.warn(`[cache] failed to get key ${key}:`, err);
            return null;
        }
    }

    async set<T>(key: string, value: T, ttlSeconds = 5): Promise<void> {
        try {
            await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
        } catch (err) {
            console.warn(`[cache] failed to set key ${key}:`, err);
        }
    }

    async del(pattern: string): Promise<number> {
        try {
            const keys = await this.redis.keys(`*${pattern}*`);
            if (keys.length === 0) return 0;
            return await this.redis.del(...keys);
        } catch (err) {
            console.warn(`[cache] failed to delete pattern ${pattern}:`, err);
            return 0;
        }
    }

    async clear(): Promise<void> {
        try {
            await this.redis.flushdb();
        } catch (err) {
            console.warn("[cache] failed to clear cache:", err);
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
        console.log("🔴 Initializing Redis cache...");
        cacheInstance = new RedisCache(redisUrl);
    } else {
        console.log("💾 Using in-memory cache (set REDIS_URL for multi-instance deployments)");
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
        initCache();
    }
    return cacheInstance!;
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
