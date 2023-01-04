const { request, gql } = require('graphql-request');
const sdk = require('@defillama/sdk');
const superagent = require('superagent');
const utils = require('../utils');
const { zenBullAbi } = require('./abi');

const getCrabVaultDetailsAbi = "function getCrabVaultDetails() external view returns (uint256,uint256)";

const poolsFunction = async () => {
    const API_URLS = {
        ethereum: 'https://api.thegraph.com/subgraphs/name/opynfinance/squeeth'
    };
    const currentTimestamp = new Date().getTime() / 1000;
    // get eth usd price
    const key = 'ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const ethPriceUSD = (
        await superagent.post('https://coins.llama.fi/prices').send({
        coins: [key],
        })
    ).body.coins[key].price;


    /**************** Crab strategy APY and TVL ****************/
    // crab strategy vault in squeeth
    const crabVaultQuery = gql`
        query Vault($vaultID: ID! = 286) {
            vault(id: $vaultID) {
            id
            shortAmount
            collateralAmount
            NftCollateralId
            owner {
                id
            }
            operator
            }
        }
    `;
    const crabVaultQueryData = await Promise.all(
        Object.entries(API_URLS).map(async ([chain, url]) => [
            chain,
            (await request(url, crabVaultQuery)).vault,
        ])
    );

    const crabTvl = crabVaultQueryData[0][1].collateralAmount * ethPriceUSD / 1e18;
    
    const crabStartTimestamp = "1658966400";
    let crabApyData = (await utils.getData(
        `https://data-dot-mm-bot-prod.uc.r.appspot.com/metrics/crabv2?start_timestamp=${crabStartTimestamp}&end_timestamp=${currentTimestamp}`
    )).data;
    crabApyData = crabApyData[crabApyData.length - 1]

    const historicalUsdcReturns = crabApyData.crabPnL * 100
    const crabNumberOfDays = (Number(currentTimestamp) - Number(crabStartTimestamp)) / (60 * 60 * 24);
    const annualizedUsdcReturns = (Math.pow(1 + historicalUsdcReturns / 100, 365 / crabNumberOfDays) - 1) * 100;

    const chain = "ethereum"
    const usdc = "0x7EA2be2df7BA6E54B1A9C70676f668455E329d29"
    const usdcPool = {
        pool: `${usdc}-${chain}`,
        chain: chain,
        project: 'opyn-squeeth',
        symbol: 'USDC',
        tvlUsd: crabTvl,
        apy: annualizedUsdcReturns,
    };


    /**************** Zen Bull strategy APY and TVL ****************/
    // get eth usd price
    const squeethKey = 'ethereum:0xf1b99e3e573a1a9c5e6b2ce818b617f0e664e86b';
    const squeethPriceUSD = (
        await superagent.post('https://coins.llama.fi/prices').send({
        coins: [squeethKey],
        })
    ).body.coins[squeethKey].price;

    const zenBullAddress = "0xb46Fb07b0c80DBC3F97cae3BFe168AcaD46dF507";
    const [ethInCrab, squeethInCrab] = (await sdk.api.abi.call({
        target: zenBullAddress,
        abi: zenBullAbi.find(({ name }) => name === 'getCrabVaultDetails'),
        chain: "ethereum"
    })).output;
    const bullCrabBalance = (await sdk.api.abi.call({
        target: zenBullAddress,
        abi: zenBullAbi.find(({ name }) => name === 'getCrabBalance'),
        chain: "ethereum"
    })).output;
    const crab = "0x3B960E47784150F5a63777201ee2B15253D713e8";
    const crabTotalSupply = (await sdk.api.erc20.totalSupply({
        target: crab,
        chain: "ethereum"
      })
    ).output
    // euler dToken and eToken
    const usdcDToken = "0x84721A3dB22EB852233AEAE74f9bC8477F8bcc42"
    const wethEToken = "0x1b808F49ADD4b8C6b5117d9681cF7312Fcf0dC1D"
    const bullDtokenBalance = (await sdk.api.erc20.balanceOf({
        target: usdcDToken,
        owner: zenBullAddress,
        chain: "ethereum"
      })
    ).output
    const bullEtokenBalance = (await sdk.api.erc20.balanceOf({
        target: wethEToken,
        owner: zenBullAddress,
        chain: "ethereum"
      })
    ).output

    const crabUsdPrice = ((ethInCrab * ethPriceUSD / 1e18) - (squeethInCrab * squeethPriceUSD / 1e18)) / (crabTotalSupply / 1e18);    
    const zenBullTvl = (bullEtokenBalance * ethPriceUSD / 1e18) + (bullCrabBalance * crabUsdPrice / 1e18) - (bullDtokenBalance / 1e6);

    const zenBullStartTimestamp = "1671500159";
    let zenBullApyData = (await utils.getData(
        `https://data-dot-mm-bot-prod.uc.r.appspot.com/metrics/zenbull/pnl/${zenBullStartTimestamp}/${currentTimestamp}`
    )).data;
    zenBullApyData = zenBullApyData[zenBullApyData.length - 1]

    const historicalWethReturns = zenBullApyData.bullEthPnl
    const zenBullNumberOfDays = (Number(currentTimestamp) - Number(zenBullStartTimestamp)) / (60 * 60 * 24);
    const annualizedWethReturns = (Math.pow(1 + historicalWethReturns / 100, 365 / zenBullNumberOfDays) - 1) * 100;

    const zenBullChain = "ethereum"
    const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
    const wethPool = {
        pool: `${weth}-${zenBullChain}`,
        chain: zenBullChain,
        project: 'opyn-squeeth',
        symbol: 'WETH',
        tvlUsd: zenBullTvl,
        apy: annualizedWethReturns,
    }

    return [usdcPool, wethPool];
};

module.exports = {
    timetravel: false,
    apy: poolsFunction,
    url: 'https://squeeth.opyn.co/strategies/',
};
