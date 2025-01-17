import { loadRestRoutes } from './app/loadRestRoutes';
import { env } from './app/env';
import createExpressApp from 'express';
import { corsMiddleware } from './app/middleware/corsMiddleware';
import { contextMiddleware } from './app/middleware/contextMiddleware';
import { accountMiddleware } from './app/middleware/accountMiddleware';
import * as http from 'http';
import { ApolloServer } from 'apollo-server-express';
import {
    ApolloServerPluginDrainHttpServer,
    ApolloServerPluginLandingPageGraphQLPlayground,
    ApolloServerPluginUsageReporting,
} from 'apollo-server-core';
import { schema } from './graphql_schema_generated';
import { resolvers } from './app/resolvers';
import { scheduleWorkerTasks } from './app/scheduleWorkerTasks';
import { redis } from './modules/cache/redis';
import { scheduleMainTasks } from './app/scheduleMainTasks';
import helmet from 'helmet';
import GraphQLJSON from 'graphql-type-json';
import { balancerService } from './modules/balancer/balancer.service';

async function startServer() {
    //need to open the redis connection prior to adding the rate limit middleware
    await redis.connect();

    const app = createExpressApp();
    app.get('/balancer/pools', async (req, res) => {
        const pools = await balancerService.getPools();

        const mapped = pools.map((pool) => ({
            ...pool,
            __typename: 'GqlBalancerPool',
            tokens: (pool.tokens || []).map((token) => ({
                ...token,
                __typename: 'GqlBalancerPoolToken',
            })),
        }));
        res.send(mapped);
    });

    app.use(helmet.dnsPrefetchControl());
    app.use(helmet.expectCt());
    app.use(helmet.frameguard());
    app.use(helmet.hidePoweredBy());
    app.use(helmet.hsts());
    app.use(helmet.ieNoOpen());
    app.use(helmet.noSniff());
    app.use(helmet.originAgentCluster());
    app.use(helmet.permittedCrossDomainPolicies());
    app.use(helmet.referrerPolicy());
    app.use(helmet.xssFilter());

    app.use(corsMiddleware);
    app.use(contextMiddleware);
    app.use(accountMiddleware);

    //startWorker(app);
    loadRestRoutes(app);

    const httpServer = http.createServer(app);

    const plugins = [
        ApolloServerPluginDrainHttpServer({ httpServer }),
        ApolloServerPluginLandingPageGraphQLPlayground({
            settings: { 'schema.polling.interval': 20000 },
        }),
    ];
    if (env.NODE_ENV === 'production') {
        plugins.push(
            ApolloServerPluginUsageReporting({
                sendVariableValues: { all: true },
                sendHeaders: { all: true },
            }),
        );
    }
    const server = new ApolloServer({
        resolvers: {
            JSON: GraphQLJSON,
            ...resolvers,
        },
        typeDefs: schema,
        introspection: true,
        plugins,
        context: ({ req }) => req.context,
    });
    await server.start();
    server.applyMiddleware({ app });

    await new Promise<void>((resolve) => httpServer.listen({ port: env.PORT }, resolve));
    console.log(`🚀 Server ready at http://localhost:${env.PORT}${server.graphqlPath}`);

    if (process.env.WORKER === 'true') {
        try {
            scheduleWorkerTasks();
        } catch (e) {
            console.log(`Fatal error happened during cron scheduling.`, e);
        }
    } else {
        scheduleMainTasks();
    }
}

//
startServer().finally(async () => {
    //await prisma.$disconnect();
    //await redis.disconnect();
});
