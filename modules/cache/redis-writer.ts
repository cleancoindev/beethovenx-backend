import { env } from '../../app/env';
import { createClient } from 'redis';

export const redisWriter = createClient({ url: `redis://${env.REDIS_WRITE_URL}:${env.REDIS_PORT}` });
