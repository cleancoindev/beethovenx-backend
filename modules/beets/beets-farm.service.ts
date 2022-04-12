import {
    GqlBalancePoolAprItem,
    GqlBeetsFarm,
    GqlBeetsFarmRewardToken,
    GqlBeetsFarmUser,
    GqlBeetsRewarder,
    GqlBeetsUserPendingAllFarmRewards,
    GqlBeetsUserPendingFarmRewards,
    GqlBeetsUserPendingRewardsToken,
} from '../../schema';
import { masterchefService } from '../masterchef-subgraph/masterchef.service';
import { oneDayInMinutes, secondsPerYear } from '../util/time';
import { Cache, CacheClass } from 'memory-cache';
import { cache } from '../cache/cache';
import { tokenPriceService } from '../token-price/token-price.service';
import { tokenService } from '../token/token.service';
import { masterChefContractService } from '../masterchef/master-chef-contract.service';
import { env } from '../../app/env';
import { formatFixed } from '@ethersproject/bignumber';
import _ from 'lodash';
import { getAddress } from '@ethersproject/address';
import { addressesMatch } from '../util/addresses';
import { BigNumber } from 'ethers';
import { blocksSubgraphService } from '../blocks-subgraph/blocks-subgraph.service';
import moment from 'moment-timezone';

const FARMS_CACHE_KEY = 'beetsFarms';
const FARM_USERS_CACHE_KEY = 'beetsFarmUsers';
const FARM_USERS_RELOAD_CACHE_KEY = 'beetsFarmUsers:reloading';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const FARM_EMISSIONS_PERCENT = 0.872;

export class BeetsFarmService {
    cache: CacheClass<string, any>;

    constructor() {
        this.cache = new Cache<string, any>();
    }

    public async getBeetsFarms(): Promise<GqlBeetsFarm[]> {
        const farms = await cache.getObjectValue<GqlBeetsFarm[]>(FARMS_CACHE_KEY);
        return farms ?? [];
    }

    public async cacheBeetsFarms(): Promise<GqlBeetsFarm[]> {
        const tokenPrices = await tokenPriceService.getTokenPrices();
        const farms = await masterchefService.getAllFarms({});
        const blocksPerDay = await blocksSubgraphService.getBlocksPerDay();
        const farmBeetsPerBlock = Number(parseInt(farms[0].masterChef.beetsPerBlock) / 1e18) * FARM_EMISSIONS_PERCENT;
        const beetsPerDay = blocksPerDay * farmBeetsPerBlock;
        const totalAllocPoint = parseInt(farms[0].masterChef.totalAllocPoint);

        const mapped: GqlBeetsFarm[] = farms.map((farm) => {
            const { allocPoint: farmAllocationPoints, rewarder, masterChef, ...remainingFarmData } = farm;
            const allocPoint = parseInt(farmAllocationPoints);
            const hasBeetsRewards = allocPoint > 0;
            const rewardTokens: GqlBeetsFarmRewardToken[] = [];

            if (allocPoint > 0) {
                const rewardPerDay = beetsPerDay * (allocPoint / totalAllocPoint);

                rewardTokens.push({
                    address: env.BEETS_ADDRESS,
                    symbol: 'BEETS',
                    decimals: 18,
                    isBeets: true,
                    tokenPrice: `${tokenPriceService.getPriceForToken(tokenPrices, env.BEETS_ADDRESS)}`,
                    rewardPerDay: `${rewardPerDay}`,
                    rewardPerSecond: `${rewardPerDay / 86400}`,
                });
            }

            if (rewarder?.rewardTokens) {
                for (let rewardToken of rewarder.rewardTokens) {
                    if (rewardToken.token !== ZERO_ADDRESS) {
                        const rewardPerSecond = formatFixed(
                            BigNumber.from(rewardToken.rewardPerSecond),
                            rewardToken.decimals,
                        );
                        rewardTokens.push({
                            address: rewardToken.token,
                            decimals: rewardToken.decimals,
                            symbol: rewardToken.symbol,
                            tokenPrice: `${tokenPriceService.getPriceForToken(tokenPrices, rewardToken.token)}`,
                            rewardPerSecond,
                            rewardPerDay: `${parseFloat(rewardPerSecond) * 86400}`,
                            isBeets: false,
                        });
                    }
                }
            }

            return {
                ...remainingFarmData,
                __typename: 'GqlBeetsFarm',
                allocPoint,
                masterChef: {
                    ...masterChef,
                    __typename: 'GqlBeetsMasterChef',
                    totalAllocPoint: parseInt(masterChef.totalAllocPoint),
                },
                rewardTokens,
                hasBeetsRewards,
                rewarder: rewarder
                    ? {
                          ...rewarder,
                          __typename: 'GqlBeetsRewarder',
                          rewardPerSecond: '0',
                          rewardToken: '',
                          tokens: rewardTokens
                              .filter((token) => !token.isBeets)
                              .map((token) => ({
                                  token: token.address,
                                  tokenPrice: parseFloat(token.tokenPrice),
                                  rewardPerSecond: token.rewardPerSecond,
                                  decimals: token.decimals,
                                  symbol: token.symbol,
                              })),
                      }
                    : null,
            };
        });

        await cache.putObjectValue(FARMS_CACHE_KEY, mapped, oneDayInMinutes);

        return mapped;
    }

    public async getBeetsFarmsForUser(userAddress: string): Promise<GqlBeetsFarmUser[]> {
        const farmUsers = await cache.getObjectValue<GqlBeetsFarmUser[]>(this.getFarmUserCacheKey(userAddress));
        return farmUsers ?? [];
    }

    public async getBeetsFarmUser(farmId: string, userAddress: string): Promise<GqlBeetsFarmUser | null> {
        // const farmUsers = await this.getBeetsFarmUsers();
        const farmUsers = await cache.getObjectValue<GqlBeetsFarmUser[]>(this.getFarmUserCacheKey(userAddress));
        if (!farmUsers) {
            return null;
        }
        const farmUser = farmUsers.find((farmUser) => farmUser.farmId === farmId.toLowerCase());

        return farmUser ?? null;
    }

    public async cacheBeetsFarmUsers(reload?: boolean): Promise<void> {
        // const existing = (await cache.getObjectValue<GqlBeetsFarmUser[]>(FARM_USERS_CACHE_KEY)) || [];

        // if (reload) {
        //     await cache.putValue(FARM_USERS_RELOAD_CACHE_KEY, 'true');
        // } else {
        //     const reloading = await cache.getValue(FARM_USERS_RELOAD_CACHE_KEY);

        //     if (reloading === 'true') {
        //         console.log('reloading, skipping cacheBeetsFarmUsers');
        //         return;
        //     }
        // }

        const currentUnixTime = moment.utc().unix();

        const farmUsers = await masterchefService.getAllFarmUsers({
            where: reload ? { amount_gt: '0' } : { timestamp_gte: `${currentUnixTime - 7200}` },
        });
        // const mapped: GqlBeetsFarmUser[] = farmUsers.map((farmUser) => ({
        //     ...farmUser,
        //     __typename: 'GqlBeetsFarmUser',
        //     farmId: farmUser.pool?.id || '',
        //     pair: farmUser?.pool?.pair || '',
        // }));

        // const ids = mapped.map((item) => item.id);

        // ?
        // const filtered = reload ? [] : existing.filter((item) => !ids.includes(item.id));

        const farmsByUser: Record<string, GqlBeetsFarmUser[]> = {};
        for (let user of farmUsers) {
            if (user.pool) {
                const mappedUser: GqlBeetsFarmUser = {
                    ...user,
                    farmId: user.pool.id,
                    pair: user.pool.pair,
                    __typename: 'GqlBeetsFarmUser',
                };
                const key = user.address.toLowerCase();
                if (!farmsByUser[key]) {
                    farmsByUser[key] = [mappedUser];
                } else {
                    farmsByUser[key].push(mappedUser);
                }
            }
        }

        for (let userAddress of Object.keys(farmsByUser)) {
            await cache.putObjectValue(this.getFarmUserCacheKey(userAddress), farmsByUser[userAddress], 10);
        }

        await cache.putValue(FARM_USERS_RELOAD_CACHE_KEY, 'false');
    }

    public calculateFarmApr(
        farm: GqlBeetsFarm,
        farmTvl: number,
        blocksPerYear: number,
        beetsPrice: number,
    ): { items: GqlBalancePoolAprItem[]; beetsApr: string; thirdPartyApr: string } {
        if (farmTvl <= 0) {
            return { items: [], beetsApr: '0', thirdPartyApr: '0' };
        }

        const beetsPerBlock = Number(parseInt(farm.masterChef.beetsPerBlock) / 1e18) * FARM_EMISSIONS_PERCENT;
        const beetsPerYear = beetsPerBlock * blocksPerYear;
        const farmBeetsPerYear = (farm.allocPoint / farm.masterChef.totalAllocPoint) * beetsPerYear;
        const beetsValuePerYear = beetsPrice * farmBeetsPerYear;
        const items: GqlBalancePoolAprItem[] = [];
        const beetsApr = beetsValuePerYear / farmTvl;
        let thirdPartyApr = 0;

        if (beetsApr > 0) {
            items.push({
                title: 'BEETS reward APR',
                apr: `${beetsApr}`,
            });
        }

        farm.rewardTokens
            .filter((rewardToken) => !rewardToken.isBeets)
            .forEach((rewardToken) => {
                const rewardTokenPerYear = parseFloat(rewardToken.rewardPerSecond) * secondsPerYear;
                const rewardTokenValuePerYear = parseFloat(rewardToken.tokenPrice) * rewardTokenPerYear;
                const rewardApr = rewardTokenValuePerYear / farmTvl > 0 ? rewardTokenValuePerYear / farmTvl : 0;

                thirdPartyApr += rewardApr;

                items.push({
                    title: `${rewardToken.symbol} reward APR`,
                    apr: `${rewardApr}`,
                });
            });

        return { items, thirdPartyApr: `${thirdPartyApr}`, beetsApr: `${beetsApr > 0 ? beetsApr : 0}` };
    }

    public async getUserPendingFarmRewards(userAddress: string): Promise<GqlBeetsUserPendingAllFarmRewards> {
        const tokenPrices = await tokenPriceService.getTokenPrices();
        const beetsPrice = tokenPriceService.getPriceForToken(tokenPrices, env.BEETS_ADDRESS);
        const allFarms = await this.getBeetsFarms();
        const userFarms = await this.getBeetsFarmsForUser(userAddress);
        const userFarmsWithBalance = userFarms.filter((userFarm) => parseFloat(userFarm.amount) > 0);
        const userFarmIds = userFarmsWithBalance.map((userFarm) => userFarm.farmId);
        const farmsWithRewarder = userFarmsWithBalance
            .map((userFarm) => allFarms.find((farm) => farm.id === userFarm.farmId && farm.rewarder))
            .filter((farm) => !!farm) as GqlBeetsFarm[];
        const rewardTokens = _.flatten(farmsWithRewarder.map((farm) => farm.rewarder?.tokens || []));
        const pendingBeetsForFarms = await masterChefContractService.getPendingBeetsForFarms(userFarmIds, userAddress);
        const pendingRewardsForFarms = await masterChefContractService.getPendingRewards(
            farmsWithRewarder,
            userAddress,
        );

        const farms: GqlBeetsUserPendingFarmRewards[] = [];

        for (const farmId of userFarmIds) {
            let tokens: GqlBeetsUserPendingRewardsToken[] = [];

            if (pendingBeetsForFarms[farmId]) {
                const balance = formatFixed(pendingBeetsForFarms[farmId], 18);

                tokens.push({
                    address: env.BEETS_ADDRESS,
                    symbol: 'BEETS',
                    balance,
                    balanceUSD: `${parseFloat(balance) * beetsPrice}`,
                });
            }

            if (pendingRewardsForFarms[farmId]) {
                tokens = [
                    ...tokens,
                    ..._.map(pendingRewardsForFarms[farmId], (balanceScaled, token) => {
                        const rewardToken = rewardTokens.find((tokenDefinition) =>
                            addressesMatch(tokenDefinition.token, token),
                        );
                        const tokenPrice = tokenPriceService.getPriceForToken(tokenPrices, token);
                        const balance = formatFixed(balanceScaled, rewardToken?.decimals);

                        return {
                            symbol: rewardToken?.symbol || '',
                            address: getAddress(token),
                            balance,
                            balanceUSD: `${parseFloat(balance) * tokenPrice}`,
                        };
                    }),
                ];
            }

            farms.push({
                farmId,
                tokens,
                balanceUSD: `${_.sumBy(tokens, (token) => parseFloat(token.balanceUSD))}`,
            });
        }

        const allTokens = _.flatten(farms.map((farm) => farm.tokens));
        const tokensGrouped = _.groupBy(allTokens, 'address');
        const tokens = _.map(tokensGrouped, (tokens) => ({
            ...tokens[0],
            balance: `${_.sumBy(tokens, (token) => parseFloat(token.balance))}`,
            balanceUSD: `${_.sumBy(tokens, (token) => parseFloat(token.balanceUSD))}`,
        }));

        return {
            tokens,
            totalBalanceUSD: `${_.sumBy(farms, (farm) => parseFloat(farm.balanceUSD))}`,
            numFarms: `${userFarmsWithBalance.length}`,
            farmIds: userFarmsWithBalance.map((userFarm) => userFarm.farmId),
            farms,
        };
    }

    private getFarmUserCacheKey(userAddress: string): string {
        return `${FARM_USERS_CACHE_KEY}:${userAddress.toLowerCase()}`;
    }
}

export const beetsFarmService = new BeetsFarmService();
