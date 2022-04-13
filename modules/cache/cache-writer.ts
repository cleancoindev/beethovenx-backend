import { redisWriter } from './redis-writer';

export const cacheWriter = {
    async putObjectValue<T extends Object>(key: string, object: T, timeoutInMinutes?: number): Promise<void> {
        //console.log('putObjectValue ' + key);
        if (timeoutInMinutes) {
            await redisWriter.setEx(key, timeoutInMinutes * 60, JSON.stringify(object));
        } else {
            await redisWriter.set(key, JSON.stringify(object));
        }
    },

    async getObjectValue<T extends Object>(key: string): Promise<T | null> {
        const response = await redisWriter.get(key);

        return response ? JSON.parse(response) : null;
    },

    async putValueKeyedOnObject<T extends Object>(
        keyPrefix: string,
        object: T,
        value: string,
        timeoutInMinutes: number,
    ): Promise<void> {
        //console.log('putValueKeyedOnObject', `${keyPrefix}${JSON.stringify(object)}`);
        await redisWriter.setEx(`${keyPrefix}${JSON.stringify(object)}`, Math.round(timeoutInMinutes * 60), value);
    },

    async getValueKeyedOnObject<T extends Object>(keyPrefix: string, object: T) {
        return redisWriter.get(`${keyPrefix}${JSON.stringify(object)}`);
    },

    async deleteKey(key: string): Promise<number> {
        return redisWriter.del(key);
    },

    async putValue(key: string, value: string, timeoutInMinutes?: number): Promise<void> {
        //console.log('putValue', key);
        if (timeoutInMinutes) {
            await redisWriter.setEx(key, Math.round(timeoutInMinutes * 60), value);
        } else {
            await redisWriter.set(key, value);
        }
    },

    async getValue(key: string) {
        return redisWriter.get(key);
    },

    async getAllKeysMatchingPattern(pattern: string): Promise<string[]> {
        return redisWriter.keys(pattern);
    },

    async deleteAllMatchingPattern(pattern: string) {
        const keys = await redisWriter.keys(pattern);

        console.log('keys', keys);

        for (const key of keys) {
            await redisWriter.del(key);
        }
    },
};
