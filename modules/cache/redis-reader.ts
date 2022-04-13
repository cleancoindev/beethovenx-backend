import { env } from '../../app/env';
import { createClient } from 'redis';

export const redisReader = createClient({ url: `redis://${env.REDIS_READ_URL}:${env.REDIS_PORT}` });
