import { redisReader } from './redis-reader';

export const cacheReader = {
    async getObjectValue<T extends Object>(key: string): Promise<T | null> {
        const response = await redisReader.get(key);

        return response ? JSON.parse(response) : null;
    },

    async getValueKeyedOnObject<T extends Object>(keyPrefix: string, object: T) {
        return redisReader.get(`${keyPrefix}${JSON.stringify(object)}`);
    },

    async getValue(key: string) {
        return redisReader.get(key);
    },

    async getAllKeysMatchingPattern(pattern: string): Promise<string[]> {
        return redisReader.keys(pattern);
    },
};
