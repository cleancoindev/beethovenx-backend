import { GqlTokenPrice, Resolvers } from '../../schema';
import { tokenPriceService } from './token-price.service';
import _ from 'lodash';
import { isAdminRoute } from '../util/resolver-util';
import { isAddress } from 'ethers/lib/utils';

const resolvers: Resolvers = {
    Query: {
        tokenPriceGetCurrentPrices: async (parent, {}, context) => {
            return tokenPriceService.getFlattenedTokenPrices();
        },
        tokenPriceGetHistoricalPrices: async (parent, { addresses }, context) => {
            const tokenPrices = await tokenPriceService.getHistoricalTokenPrices();
            const filtered = _.pickBy(tokenPrices, (entries, address) => addresses.includes(address));

            return _.map(filtered, (entries, address) => ({
                address,
                prices: entries.map((entry) => ({
                    timestamp: `${entry.timestamp}`,
                    price: entry.price,
                })),
            }));
        },
    },
    Mutation: {
        reloadTokenPrices: async (parent, {}, context) => {
            isAdminRoute(context);

            await tokenPriceService.cacheTokenPrices();

            return true;
        },
    },
};

export default resolvers;
