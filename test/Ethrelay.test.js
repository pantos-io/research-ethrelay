const Web3 = require("web3");
const {BN, expectRevert, time, balance} = require('@openzeppelin/test-helpers');
const {createRLPHeader, calculateBlockHash, addToHex} = require('../utils/utils');
const expectEvent = require('./expectEvent');
const RLP = require('rlp');
const {bufArrToArr, arrToBufArr} = require('ethereumjs-util');

const { INFURA_ENDPOINT } = require("../constants");

const Ethrelay = artifacts.require('./EthrelayTestContract');
const Ethash = artifacts.require('./Ethash');
const {expect} = require('chai');

const EPOCH         = 470;
const GENESIS_BLOCK = 14119813;

expect(Math.floor(GENESIS_BLOCK / 30000), "genesis block not in epoch").to.equal(EPOCH);

const ZERO_HASH                 = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ZERO_ADDRESS              = '0x0000000000000000000000000000000000000000';
const LOCK_PERIOD               = time.duration.minutes(5);
const ALLOWED_FUTURE_BLOCK_TIME = time.duration.seconds(15);
const MAX_GAS_LIMIT             = 2n ** 63n - 1n;
const MIN_GAS_LIMIT             = 5000;
const GAS_LIMIT_BOUND_DIVISOR   = 1024n;
const GAS_PRICE_IN_WEI          = new BN(0);

contract('Ethrelay', async (accounts) => {

    let ethrelay;
    let ethash;
    let sourceWeb3;

    before(async () => {
        sourceWeb3 = new Web3(INFURA_ENDPOINT);
        ethash = await Ethash.new();
        const epochData = require("./epoch.json");

        console.log(`Submitting data for epoch ${EPOCH} to Ethash contract...`);
        await submitEpochData(ethash, EPOCH, epochData.FullSizeIn128Resolution, epochData.BranchDepth, epochData.MerkleNodes);
        console.log("Submitted epoch data.");

        // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
        await time.advanceBlock();
    });

    beforeEach(async () => {
        const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
        const genesisRlpHeader = createRLPHeader(genesisBlock);
        ethrelay = await Ethrelay.new(genesisRlpHeader, genesisBlock.totalDifficulty, ethash.address, {
            from: accounts[0],
            gasPrice: GAS_PRICE_IN_WEI
        });
    });


    describe('Ethrelay: DepositStake', function () {

        // Test Scenario 1:
        it("should throw error: transfer amount not equal to function parameter", async () => {
            const stake = new BN(1);
            await expectRevert(
                ethrelay.depositStake(stake, {
                    from: accounts[0],
                    value: stake.add(new BN(1)),
                    gasPrice: GAS_PRICE_IN_WEI
                }),
                "transfer amount not equal to function parameter");
        });

        // Test Scenario 2:
        it("should correctly add the provided stake to the client's balance", async () => {
            const stake = new BN(15);
            const balanceBeforeCall = await ethrelay.getStake({from: accounts[0]});

            await ethrelay.depositStake(stake, {from: accounts[0], value: stake});
            const balanceAfterCall = await ethrelay.getStake({from: accounts[0]});

            expect(balanceAfterCall).to.be.bignumber.equal(balanceBeforeCall.add(stake));

            // get back the provided amount of ether
            await withdrawStake(stake, accounts[0]);
        });

    });

    describe('Ethrelay: WithdrawStake', function () {

        // Test Scenario 1:
        it("should throw error: withdraw should be denied due to insufficient amount of overall stake", async () => {
            const stakeBeforeTest = await ethrelay.getStake({from: accounts[0]});
            const stakeToWithdraw = stakeBeforeTest.add(new BN(1));
            let gasUsed = new BN(0);
            const accountBalanceBeforeTestInWei = await getAccountBalanceInWei(accounts[0]);

            await expectRevert(ethrelay.withdrawStake(stakeToWithdraw, {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI
            }), 'amount higher than deposited stake');
        });

        // Test Scenario 2:
        it("should throw error: withdraw should be denied due to insufficient amount of unlocked stake", async () => {
            const stake = await ethrelay.getRequiredStakePerBlock();
            let gasUsed = new BN(0);
            const accountBalanceBeforeTestInWei = await getAccountBalanceInWei(accounts[0]);
            let ret = await ethrelay.depositStake(stake, {
                from: accounts[0],
                value: stake,
                gasPrice: GAS_PRICE_IN_WEI
            });
            gasUsed = gasUsed.add(new BN(ret.receipt.gasUsed));


            // submit header in order to lock the deposited stake
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            await submitBlockHeader(block1, accounts[0]);
            const submitTime = await time.latest();

            ret = await ethrelay.withdrawStake(stake, {from: accounts[0], gasPrice: GAS_PRICE_IN_WEI});
            expectEvent.inLogs(ret.logs, 'WithdrawStake', {client: accounts[0], withdrawnStake: new BN(0)});
            gasUsed = gasUsed.add(new BN(ret.receipt.gasUsed));

            const stakeAfterTest = await ethrelay.getStake({from: accounts[0]});
            expect(stakeAfterTest).to.be.bignumber.equal(stake);

            const submittedHeaders = await ethrelay.getBlockHashesSubmittedByClient({from: accounts[0]});
            expect(submittedHeaders.length).to.equal(1);
            expect(submittedHeaders[0]).to.equal(block1.hash);

            let accountBalanceAfterTestinEth = await getAccountBalanceInWei(accounts[0]);
            let feesInWei = gasUsed.mul(GAS_PRICE_IN_WEI);
            expect(accountBalanceAfterTestinEth).to.be.bignumber.equal(accountBalanceBeforeTestInWei.sub(feesInWei).sub(stake));

            // withdraw after lock period has elapsed
            const increasedTime = submitTime.add(LOCK_PERIOD).add(time.duration.seconds(1));
            await time.increaseTo(increasedTime);
            ret = await ethrelay.withdrawStake(stake, {from: accounts[0], gasPrice: GAS_PRICE_IN_WEI});
            expectEvent.inLogs(ret.logs, 'WithdrawStake', {client: accounts[0], withdrawnStake: stake});
            gasUsed = gasUsed.add(new BN(ret.receipt.gasUsed));

            accountBalanceAfterTestinEth = await getAccountBalanceInWei(accounts[0]);
            feesInWei = gasUsed.mul(GAS_PRICE_IN_WEI);
            expect(accountBalanceAfterTestinEth).to.be.bignumber.equal(accountBalanceBeforeTestInWei.sub(feesInWei));
        });

        // Test Scenario 3:
        it("should throw error: withdraw should be denied due to insufficient amount of unlocked stake (2)", async () => {
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(2));
            const accountBalanceBeforeTestInWei = await getAccountBalanceInWei(accounts[0]);
            let ret = await ethrelay.depositStake(stake, {
                from: accounts[0],
                value: stake,
                gasPrice: GAS_PRICE_IN_WEI
            });
            let gasUsed = new BN(ret.receipt.gasUsed);

            // submit header in order to lock the deposited stake
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);

            ret = await submitBlockHeader(block1, accounts[0]);
            gasUsed = gasUsed.add(new BN(ret.receipt.gasUsed));
            const submitTime = await time.latest();
            let increasedTime = submitTime.add(LOCK_PERIOD).add(time.duration.seconds(1));
            await time.increaseTo(increasedTime);

            ret = await submitBlockHeader(block2, accounts[0]);
            gasUsed = gasUsed.add(new BN(ret.receipt.gasUsed));

            ret = await ethrelay.withdrawStake(stake, {from: accounts[0], gasPrice: GAS_PRICE_IN_WEI});
            expectEvent.inLogs(ret.logs, 'WithdrawStake', {client: accounts[0], withdrawnStake: new BN(0)});
            gasUsed = gasUsed.add(new BN(ret.receipt.gasUsed));

            const stakeAfterTest = await ethrelay.getStake({from: accounts[0]});
            expect(stakeAfterTest).to.be.bignumber.equal(stake);

            const submittedHeaders = await ethrelay.getBlockHashesSubmittedByClient({from: accounts[0]});
            expect(submittedHeaders.length).to.equal(1);
            expect(submittedHeaders[0]).to.equal(block2.hash);

            let accountBalanceAfterTestinEth = await getAccountBalanceInWei(accounts[0]);
            let feesInWei = gasUsed.mul(GAS_PRICE_IN_WEI);
            expect(accountBalanceAfterTestinEth).to.be.bignumber.equal(accountBalanceBeforeTestInWei.sub(feesInWei).sub(stake));

            // withdraw after lock period has elapsed
            increasedTime = (await time.latest()).add(LOCK_PERIOD).add(time.duration.seconds(1));
            await time.increaseTo(increasedTime);
            ret = await ethrelay.withdrawStake(stake, {from: accounts[0], gasPrice: GAS_PRICE_IN_WEI});
            expectEvent.inLogs(ret.logs, 'WithdrawStake', {client: accounts[0], withdrawnStake: stake});
            gasUsed = gasUsed.add(new BN(ret.receipt.gasUsed));

            accountBalanceAfterTestinEth = await getAccountBalanceInWei(accounts[0]);
            feesInWei = gasUsed.mul(GAS_PRICE_IN_WEI);
            expect(accountBalanceAfterTestinEth).to.be.bignumber.equal(accountBalanceBeforeTestInWei.sub(feesInWei));
        });

        // Test Scenario 4:
        it("should withdraw the correct amount since no stake has ever been locked", async () => {
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(2));
            const stakeBeforeTest = await ethrelay.getStake({from: accounts[0]});
            let gasUsed = new BN(0);
            const accountBalanceBeforeTestInWei = await getAccountBalanceInWei(accounts[0]);

            let ret = await ethrelay.depositStake(stake, {
                from: accounts[0],
                value: stake,
                gasPrice: GAS_PRICE_IN_WEI
            });
            gasUsed = gasUsed.add(new BN(ret.receipt.gasUsed));

            ret = await ethrelay.withdrawStake(stake, {from: accounts[0], gasPrice: GAS_PRICE_IN_WEI});
            expectEvent.inLogs(ret.logs, 'WithdrawStake', {client: accounts[0], withdrawnStake: stake});
            gasUsed = gasUsed.add(new BN(ret.receipt.gasUsed));

            const stakeAfterTest = await ethrelay.getStake({from: accounts[0]});
            expect(stakeAfterTest).to.be.bignumber.equal(stakeBeforeTest);

            const accountBalanceAfterTestinEth = await getAccountBalanceInWei(accounts[0]);
            const feesInWei = gasUsed.mul(GAS_PRICE_IN_WEI);
            expect(accountBalanceAfterTestinEth).to.be.bignumber.equal(accountBalanceBeforeTestInWei.sub(feesInWei));
        });

        // Test Scenario 5:
        it("should withdraw the correct amount since lock period has elapsed", async () => {
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(2));
            const stakeBeforeTest = await ethrelay.getStake({from: accounts[0]});
            await ethrelay.depositStake(stake, {from: accounts[0], value: stake, gasPrice: GAS_PRICE_IN_WEI});

            // submit header in order to lock the deposited stake
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            await submitBlockHeader(block1, accounts[0]);

            const submitTime = await time.latest();
            const increasedTime = submitTime.add(LOCK_PERIOD).add(time.duration.seconds(1));
            await time.increaseTo(increasedTime);

            const ret = await ethrelay.withdrawStake(stake, {from: accounts[0], gasPrice: GAS_PRICE_IN_WEI});
            expectEvent.inLogs(ret.logs, 'WithdrawStake', {client: accounts[0], withdrawnStake: stake});

            const stakeAfterTest = await ethrelay.getStake({from: accounts[0]});
            expect(stakeAfterTest).to.be.bignumber.equal(stakeBeforeTest);

            const submittedHeaders = await ethrelay.getBlockHashesSubmittedByClient({from: accounts[0]});
            expect(submittedHeaders.length).to.equal(0);
        });
    });

    describe('Ethrelay: SubmitBlock', function () {

        // Test Scenario 1:
        //
        // (0)
        //
        it("should correctly execute test scenario 1", async () => {
            const initTime = await time.latest();
            const expectedGenesis = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
            const expectedBlocks = [
                {
                    block: expectedGenesis,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: ZERO_HASH,
                    lockedUntil: initTime,
                    successors: [],
                    submitter: ZERO_ADDRESS
                }
            ];

            const expectedEndpoints = [expectedGenesis];

            await checkExpectedEndpoints(expectedEndpoints);
            await checkExpectedBlockHeaders(expectedBlocks);
        });

        // Test Scenario 2:
        //
        // (0)---(1)
        //
        it('should correctly execute test scenario 2', async () => {
            // deposit enough stake
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock;
            await ethrelay.depositStake(stake, {from: accounts[0], value: stake, gasPrice: GAS_PRICE_IN_WEI});

            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const expectedBlocks = [
                {
                    block: block1,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: ZERO_HASH,
                    successors: [],
                    submitter: accounts[0]
                }
            ];
            const expectedEndpoints = [block1];

            await submitBlockHeaders(expectedBlocks, accounts[0]);

            await checkExpectedEndpoints(expectedEndpoints);
            await checkExpectedBlockHeaders(expectedBlocks);

            await withdrawStake(stake, accounts[0]);
        });

        // Test Scenario 3:
        //
        // (0)---(1)---(2)
        //
        it('should correctly execute test scenario 3', async () => {
            // deposit enough stake
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(2));
            await ethrelay.depositStake(stake, {from: accounts[0], value: stake, gasPrice: GAS_PRICE_IN_WEI});

            // Create expected chain
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const expectedBlocks = [
                {
                    block: block1,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: ZERO_HASH,
                    successors: [block2.hash],
                    submitter: accounts[0]
                },
                {
                    block: block2,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: ZERO_HASH,
                    successors: [],
                    submitter: accounts[0]
                }
            ];
            const expectedEndpoints = [block2];

            await submitBlockHeaders(expectedBlocks, accounts[0]);

            // Perform checks
            await checkExpectedEndpoints(expectedEndpoints);
            await checkExpectedBlockHeaders(expectedBlocks);

            await withdrawStake(stake, accounts[0]);
        });

        // Test Scenario 4:
        //
        //      -(1)
        //    /
        // (0)
        //    \
        //      -(2)
        //
        it('should correctly execute test scenario 4', async () => {
            // deposit enough stake
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(2));
            await ethrelay.depositStake(stake, {from: accounts[0], value: stake, gasPrice: GAS_PRICE_IN_WEI});

            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);

            // change data of block 2
            block2.transactionsRoot = block1.receiptsRoot;
            block2.stateRoot = block1.transactionsRoot;
            block2.receiptsRoot = block1.stateRoot;
            block2.hash = calculateBlockHash(block2);  // IMPORTANT: recalculate block hash otherwise asserts fails

            const expectedBlocks = [
                {
                    block: block1,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [],
                    submitter: accounts[0]
                },
                {
                    block: block2,
                    forkId: 1,
                    iterableIndex: 1,
                    latestFork: block2.parentHash,
                    successors: [],
                    submitter: accounts[0]
                }
            ];
            const expectedEndpoints = [block1, block2];
            await submitBlockHeaders(expectedBlocks, accounts[0]);

            // Perform checks
            await checkExpectedEndpoints(expectedEndpoints);
            await checkExpectedBlockHeaders(expectedBlocks);

            await withdrawStake(stake, accounts[0]);
        });

        // Test Scenario 5:
        //
        //      -(1)---(2)
        //    /
        // (0)
        //    \
        //      -(3)
        //
        it('should correctly execute test scenario 5', async () => {
            // deposit enough stake
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(3));
            await ethrelay.depositStake(stake, {from: accounts[0], value: stake, gasPrice: GAS_PRICE_IN_WEI});

            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);

            // change data of block 3
            block3.transactionsRoot = block1.receiptsRoot;
            block3.stateRoot = block1.transactionsRoot;
            block3.receiptsRoot = block1.stateRoot;
            block3.hash = calculateBlockHash(block3);  // IMPORTANT: recalculate block hash otherwise asserts fails

            const expectedBlocks = [
                {
                    block: block1,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [block2.hash],
                    submitter: accounts[0]
                },
                {
                    block: block2,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [],
                    submitter: accounts[0]
                },
                {
                    block: block3,
                    forkId: 1,
                    iterableIndex: 1,
                    latestFork: block3.parentHash,
                    successors: [],
                    submitter: accounts[0]
                }
            ];
            const expectedEndpoints = [block2, block3];
            await submitBlockHeaders(expectedBlocks, accounts[0]);

            // Perform checks
            await checkExpectedEndpoints(expectedEndpoints);
            await checkExpectedBlockHeaders(expectedBlocks);

            await withdrawStake(stake, accounts[0]);
        });

        // Test Scenario 6:
        //
        //      -(1)
        //    /
        // (0)---(2)
        //    \
        //      -(3)
        //
        it('should correctly execute test scenario 6', async () => {
            // deposit enough stake
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(3));
            await ethrelay.depositStake(stake, {from: accounts[0], value: stake, gasPrice: GAS_PRICE_IN_WEI});

            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);

            // change data of block 2
            block2.transactionsRoot = block1.receiptsRoot;
            block2.stateRoot = block1.transactionsRoot;
            block2.receiptsRoot = block1.stateRoot;
            block2.hash = calculateBlockHash(block2);  // IMPORTANT: recalculate block hash otherwise asserts fails

            // change data of block 3
            block3.transactionsRoot = block1.stateRoot;
            block3.stateRoot = block1.receiptsRoot;
            block3.receiptsRoot = block1.transactionsRoot;
            block3.hash = calculateBlockHash(block3);  // IMPORTANT: recalculate block hash otherwise asserts fails

            const expectedBlocks = [
                {
                    block: block1,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [],
                    submitter: accounts[0]
                },
                {
                    block: block2,
                    forkId: 1,
                    iterableIndex: 1,
                    latestFork: block2.parentHash,
                    successors: [],
                    submitter: accounts[0]
                },
                {
                    block: block3,
                    forkId: 2,
                    iterableIndex: 2,
                    latestFork: block3.parentHash,
                    successors: [],
                    submitter: accounts[0]
                }
            ];
            const expectedEndpoints = [block1, block2, block3];

            await submitBlockHeaders(expectedBlocks, accounts[0]);

            // Perform checks
            await checkExpectedEndpoints(expectedEndpoints);
            await checkExpectedBlockHeaders(expectedBlocks);

            await withdrawStake(stake, accounts[0]);
        });

        // Test Scenario 7:
        //
        //      -(1)---(2)---(3)---(5)
        //    /
        // (0)
        //    \
        //      -(4)
        //
        it('should correctly execute test scenario 7', async () => {
            // deposit enough stake
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(5));
            await ethrelay.depositStake(stake, {from: accounts[0], value: stake, gasPrice: GAS_PRICE_IN_WEI});

            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);

            // change data of block 4
            block4.transactionsRoot = block1.receiptsRoot;
            block4.stateRoot = block1.transactionsRoot;
            block4.receiptsRoot = block1.stateRoot;
            block4.hash = calculateBlockHash(block4);  // IMPORTANT: recalculate block hash otherwise asserts fails

            const expectedBlocks = [
                {
                    block: block1,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [block2.hash],
                    submitter: accounts[0]
                },
                {
                    block: block2,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [block3.hash],
                    submitter: accounts[0]
                },
                {
                    block: block3,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [block5.hash],
                    submitter: accounts[0]
                },
                {
                    block: block4,
                    forkId: 1,
                    iterableIndex: 1,
                    latestFork: block4.parentHash,
                    successors: [],
                    submitter: accounts[0]
                },
                {
                    block: block5,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [],
                    submitter: accounts[0]
                }
            ];
            const expectedEndpoints = [block5, block4];
            await submitBlockHeaders(expectedBlocks, accounts[0]);

            // Perform checks
            await checkExpectedEndpoints(expectedEndpoints);
            await checkExpectedBlockHeaders(expectedBlocks);

            await withdrawStake(stake, accounts[0]);
        });

        // Test Scenario 8:
        //
        //                  -(5)---(7)
        //                /
        // (0)---(1)---(2)---(3)---(4)
        //                      \
        //                        -(6)
        //
        it('should correctly execute test scenario 8', async () => {
            // deposit enough stake
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(7));
            await ethrelay.depositStake(stake, {from: accounts[0], value: stake, gasPrice: GAS_PRICE_IN_WEI});

            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block6 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block7 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);

            // change data of block 5
            block5.transactionsRoot = block3.receiptsRoot;
            block5.stateRoot = block3.transactionsRoot;
            block5.receiptsRoot = block3.stateRoot;
            block5.parentHash = block2.hash;
            block5.hash = calculateBlockHash(block5);  // IMPORTANT: recalculate block hash otherwise asserts fails

            // change data of block 6
            block6.transactionsRoot = block4.receiptsRoot;
            block6.stateRoot = block4.transactionsRoot;
            block6.receiptsRoot = block4.stateRoot;
            block6.parentHash = block3.hash;
            block6.hash = calculateBlockHash(block6);  // IMPORTANT: recalculate block hash otherwise asserts fails

            // change data of block 7
            block7.transactionsRoot = block4.receiptsRoot;
            block7.stateRoot = block4.transactionsRoot;
            block7.receiptsRoot = block4.stateRoot;
            block7.parentHash = block5.hash;
            block7.hash = calculateBlockHash(block7);  // IMPORTANT: recalculate block hash otherwise asserts fails

            const expectedBlocks = [
                {
                    block: block1,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: ZERO_HASH,
                    successors: [block2.hash],
                    submitter: accounts[0]
                },
                {
                    block: block2,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: ZERO_HASH,
                    successors: [block3.hash, block5.hash],
                    submitter: accounts[0]
                },
                {
                    block: block3,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block2.hash,
                    successors: [block4.hash, block6.hash],
                    submitter: accounts[0]
                },
                {
                    block: block4,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block3.hash,
                    successors: [],
                    submitter: accounts[0]
                },
                {
                    block: block5,
                    forkId: 1,
                    iterableIndex: 0,
                    latestFork: block2.hash,
                    successors: [block7.hash],
                    submitter: accounts[0]
                },
                {
                    block: block6,
                    forkId: 2,
                    iterableIndex: 2,
                    latestFork: block3.hash,
                    successors: [],
                    submitter: accounts[0]
                },
                {
                    block: block7,
                    forkId: 1,
                    iterableIndex: 1,
                    latestFork: block2.hash,
                    successors: [],
                    submitter: accounts[0]
                }
            ];
            const expectedEndpoints = [block4, block7, block6];
            await submitBlockHeaders(expectedBlocks, accounts[0]);

            // Perform checks
            await checkExpectedEndpoints(expectedEndpoints);
            await checkExpectedBlockHeaders(expectedBlocks);

            await withdrawStake(stake, accounts[0]);
        });

        it('should revert when the parent of a submitted block header does not exist', async () => {
            // deposit enough stake
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            await ethrelay.depositStake(requiredStakePerBlock, {
                from: accounts[0],
                value: requiredStakePerBlock,
                gasPrice: GAS_PRICE_IN_WEI
            });

            const blockWithNonExistentParent = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const rlpHeader = createRLPHeader(blockWithNonExistentParent);
            await expectRevert(ethrelay.submitBlock(rlpHeader, {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI
            }), 'parent does not exist');

            await withdrawStake(requiredStakePerBlock, accounts[0]);
        });

        // Test Scenario:
        //
        // (0)---(1)
        //
        it('should unlock a block at the correct time', async () => {
            // deposit enough stake
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            await ethrelay.depositStake(requiredStakePerBlock, {
                from: accounts[0],
                value: requiredStakePerBlock,
                gasPrice: GAS_PRICE_IN_WEI
            });

            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const expectedBlocks = [
                {
                    block: block1,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: ZERO_HASH,
                    successors: [],
                    submitter: accounts[0]
                }
            ];
            await submitBlockHeaders(expectedBlocks, accounts[0]);
            expect(await ethrelay.isBlockUnlocked(block1.hash)).to.equal(false);  // block is locked right after submission
            await time.increaseTo(expectedBlocks[0].lockedUntil - 1);
            expect(await ethrelay.isBlockUnlocked(block1.hash)).to.equal(false);  // block is locked for duration of lock period
            await time.increase(time.duration.seconds(2));
            expect(await ethrelay.isBlockUnlocked(block1.hash)).to.equal(true);   // block is unlocked right after lock period has passed

            await withdrawStake(requiredStakePerBlock, accounts[0]);
        });

        it("should not accept block since client has not provided any stake", async () => {
            // submit header
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const ret = await submitBlockHeader(block1, accounts[0]);

            expectEvent.inLogs(ret.logs, 'NewBlock', {blockHash: ZERO_HASH});

            const submittedHeaders = await ethrelay.getBlockHashesSubmittedByClient({from: accounts[0]});
            expect(submittedHeaders.length).to.equal(0);

            const header = await ethrelay.getHeader(block1.hash);
            expect(header.hash).to.equal(ZERO_HASH);  // check whether block does not exist in the contract
        });

        it("should accept block due to enough unused stake", async () => {
            const stake = await ethrelay.getRequiredStakePerBlock();
            await ethrelay.depositStake(stake, {from: accounts[0], value: stake, gasPrice: GAS_PRICE_IN_WEI});

            // submit header
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const ret = await submitBlockHeader(block1, accounts[0]);
            expectEvent.inLogs(ret.logs, 'NewBlock', {blockHash: block1.hash});

            const submittedHeaders = await ethrelay.getBlockHashesSubmittedByClient({from: accounts[0]});
            expect(submittedHeaders.length).to.equal(1);
            expect(submittedHeaders[0]).to.equal(block1.hash);

            const header = await ethrelay.getHeader(block1.hash);
            expect(header.hash).to.equal(block1.hash);

            await withdrawStake(stake, accounts[0]);
        });

    });

    describe('Ethrelay: SubmitBlockBatch', function () {

        // Test Scenario 8:
        //
        //                  -(5)---(7)
        //                /
        // (0)---(1)---(2)---(3)---(4)
        //                      \
        //                        -(6)
        //
        it('should correctly execute test scenario 1', async () => {
            // deposit enough stake
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(7));
            await ethrelay.depositStake(stake, {from: accounts[0], value: stake, gasPrice: GAS_PRICE_IN_WEI});

            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block6 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block7 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);

            // change data of block 5
            block5.transactionsRoot = block3.receiptsRoot;
            block5.stateRoot = block3.transactionsRoot;
            block5.receiptsRoot = block3.stateRoot;
            block5.parentHash = block2.hash;
            block5.hash = calculateBlockHash(block5);  // IMPORTANT: recalculate block hash otherwise asserts fails

            // change data of block 6
            block6.transactionsRoot = block4.receiptsRoot;
            block6.stateRoot = block4.transactionsRoot;
            block6.receiptsRoot = block4.stateRoot;
            block6.parentHash = block3.hash;
            block6.hash = calculateBlockHash(block6);  // IMPORTANT: recalculate block hash otherwise asserts fails

            // change data of block 7
            block7.transactionsRoot = block4.receiptsRoot;
            block7.stateRoot = block4.transactionsRoot;
            block7.receiptsRoot = block4.stateRoot;
            block7.parentHash = block5.hash;
            block7.hash = calculateBlockHash(block7);  // IMPORTANT: recalculate block hash otherwise asserts fails

            const expectedBlocks = [
                {
                    block: block1,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: ZERO_HASH,
                    successors: [block2.hash],
                    submitter: accounts[0]
                },
                {
                    block: block2,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: ZERO_HASH,
                    successors: [block3.hash, block5.hash],
                    submitter: accounts[0]
                },
                {
                    block: block3,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block2.hash,
                    successors: [block4.hash, block6.hash],
                    submitter: accounts[0]
                },
                {
                    block: block4,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block3.hash,
                    successors: [],
                    submitter: accounts[0]
                },
                {
                    block: block5,
                    forkId: 1,
                    iterableIndex: 0,
                    latestFork: block2.hash,
                    successors: [block7.hash],
                    submitter: accounts[0]
                },
                {
                    block: block6,
                    forkId: 2,
                    iterableIndex: 2,
                    latestFork: block3.hash,
                    successors: [],
                    submitter: accounts[0]
                },
                {
                    block: block7,
                    forkId: 1,
                    iterableIndex: 1,
                    latestFork: block2.hash,
                    successors: [],
                    submitter: accounts[0]
                }
            ];
            const expectedEndpoints = [block4, block7, block6];
            await submitBlockBatch(expectedBlocks, accounts[0]);

            // Perform checks
            await checkExpectedEndpoints(expectedEndpoints);
            await checkExpectedBlockHeaders(expectedBlocks);

            await withdrawStake(stake, accounts[0]);
        });

    });

    describe('Ethrelay: VerifyTransaction', function () {

        // Test Scenario 1:
        //
        //       tx
        //        |
        //        v
        // (0)---(1)---(2)---(3)---(4)---(5)
        //
        it('should correctly execute test scenario 1', async () => {
            // deposit enough stake
            const submitterAddr = accounts[0];
            const verifierAddr = accounts[1];
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(5));
            await ethrelay.depositStake(stake, {from: submitterAddr, value: stake, gasPrice: GAS_PRICE_IN_WEI});
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            // Create expected chain
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const requestedBlockInRlp = createRLPHeader(block1);

            const {Value, Path, Nodes} = require("./transactions/genesisPlus1.json");

            const expectedBlocks = [
                {
                    block: block1,
                },
                {
                    block: block2,
                },
                {
                    block: block3,
                },
                {
                    block: block4,
                },
                {
                    block: block5,
                },
            ];

            await submitBlockHeaders(expectedBlocks, submitterAddr);

            for (let i = 0; i < expectedBlocks.length + 1; i++) {
                // console.log((await time.latest()).toString());
                for (let j = 0; j < i; j++) {
                    // console.log(`i: ${i}, j: ${j}`);
                    let balanceSubmitterBeforeCall = await balance.current(submitterAddr);
                    let balanceVerifierBeforeCall = await balance.current(verifierAddr);

                    let ret = await ethrelay.verifyTransaction(verificationFee, requestedBlockInRlp, j, Value, Path, Nodes, {
                        from: verifierAddr,
                        value: verificationFee,
                        gasPrice: GAS_PRICE_IN_WEI
                    });

                    expectEvent.inLogs(ret.logs, 'VerifyTransaction', {result: new BN(0)});

                    let balanceSubmitterAfterCall = await balance.current(submitterAddr);
                    let balanceVerifierAfterCall = await balance.current(verifierAddr);
                    let txCost = (new BN(ret.receipt.gasUsed)).mul(GAS_PRICE_IN_WEI);

                    expect(balanceSubmitterBeforeCall).to.be.bignumber.equal(balanceSubmitterAfterCall.sub(verificationFee));
                    expect(balanceVerifierBeforeCall).to.be.bignumber.equal(balanceVerifierAfterCall.add(verificationFee).add(txCost));
                }

                for (let j = i; j < expectedBlocks.length; j++) {
                    await expectRevert(ethrelay.verifyTransaction(verificationFee, requestedBlockInRlp, j, Value, Path, Nodes, {
                        from: verifierAddr,
                        value: verificationFee,
                        gasPrice: GAS_PRICE_IN_WEI
                    }), "block is locked or not confirmed by enough blocks");
                }

                if (i < expectedBlocks.length) {
                    await time.increaseTo(expectedBlocks[i].lockedUntil);
                    await time.increase(time.duration.seconds(1));
                }
            }

            await withdrawStake(stake, submitterAddr);
        });

        // Test Scenario 2:
        //
        // (0)---(1)---(2)---(3)
        //    \
        //      -(4)
        //        ^
        //        |
        //        tx
        //
        it('should correctly execute test scenario 2', async () => {
            // deposit enough stake
            const submitterAddr = accounts[0];
            const verifierAddr = accounts[1];
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(4));
            await ethrelay.depositStake(stake, {from: submitterAddr, value: stake, gasPrice: GAS_PRICE_IN_WEI});
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            // Create expected chain
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);

            const {Value, Path, Nodes} = require("./transactions/genesisPlus1.json");

            block4.nonce = addToHex(block4.nonce, 1);
            block4.hash = calculateBlockHash(block4);

            const requestedBlockInRlp = createRLPHeader(block4);
            const expectedBlocks = [
                {
                    block: block1,
                },
                {
                    block: block2,
                },
                {
                    block: block3,
                },
                {
                    block: block4,
                }
            ];

            await submitBlockHeaders(expectedBlocks, submitterAddr);

            // it is expected that always false is returned since the requested block is not part of the longest PoW chain
            for (let i = 0; i < expectedBlocks.length + 1; i++) {
                // console.log((await time.latest()).toString());
                for (let j = 0; j < expectedBlocks.length; j++) {
                    await expectRevert(ethrelay.verifyTransaction(verificationFee, requestedBlockInRlp, j, Value, Path, Nodes, {
                        from: verifierAddr,
                        value: verificationFee,
                        gasPrice: GAS_PRICE_IN_WEI
                    }), "block is not part of the longest PoW chain");
                }
                if (i < expectedBlocks.length) {
                    await time.increaseTo(expectedBlocks[i].lockedUntil);
                    await time.increase(time.duration.seconds(1));
                }
            }

            await withdrawStake(stake, submitterAddr);
        });

        // Test Scenario 3:
        //
        // (0)---(1)---(2)---(3)
        //        ^       \
        //        |         -(4)---(5)---(6)
        //        tx                  \
        //                              -(7)---(8)---(9)---(10)
        //                                              \
        //                                                -(11)---(12)
        //
        it('should correctly execute test scenario 3', async () => {
            // deposit enough stake
            const submitterAddr = accounts[0];
            const verifierAddr = accounts[1];
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(12));
            await ethrelay.depositStake(stake, {from: submitterAddr, value: stake, gasPrice: GAS_PRICE_IN_WEI});
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            // Create expected chain
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block6 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block7 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block8 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 6);
            const block9 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 7);
            const block10 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 8);
            const block11 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 8);
            const block12 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 9);

            const {Value, Path, Nodes} = require("./transactions/genesisPlus1.json");

            block4.nonce = addToHex(block4.nonce, 1);

            block4.hash = calculateBlockHash(block4);

            block5.parentHash = block4.hash;
            block5.hash = calculateBlockHash(block5);

            block6.parentHash = block5.hash;
            block6.hash = calculateBlockHash(block6);
            block7.nonce = addToHex(block7.nonce, 1);
            block7.parentHash = block5.hash;
            block7.hash = calculateBlockHash(block7);

            block8.parentHash = block7.hash;
            block8.hash = calculateBlockHash(block8);

            block9.parentHash = block8.hash;
            block9.hash = calculateBlockHash(block9);

            block10.parentHash = block9.hash;
            block10.hash = calculateBlockHash(block10);
            block11.nonce = addToHex(block11.nonce, 1);
            block11.parentHash = block9.hash;
            block11.hash = calculateBlockHash(block11);

            block12.parentHash = block11.hash;
            block12.hash = calculateBlockHash(block12);

            const requestedBlockInRlp = createRLPHeader(block1);
            const expectedBlocks = [
                {block: block1},
                {block: block2},
                {block: block3},
                {block: block4},
                {block: block5},
                {block: block6},
                {block: block7},
                {block: block8},
                {block: block9},
                {block: block10},
                {block: block11},
                {block: block12}
            ];

            const maxConfirmations = expectedBlocks.length + 1;
            const expectedVerificationResults = [
                generateVerificationResult(0, maxConfirmations), // no unlocked block
                generateVerificationResult(1, maxConfirmations), // block 1 unlocked
                generateVerificationResult(2, maxConfirmations), // block 2 unlocked
                generateVerificationResult(2, maxConfirmations), // block 3 unlocked
                generateVerificationResult(3, maxConfirmations), // block 4 unlocked
                generateVerificationResult(4, maxConfirmations), // block 5 unlocked
                generateVerificationResult(4, maxConfirmations), // block 6 unlocked
                generateVerificationResult(5, maxConfirmations), // block 7 unlocked
                generateVerificationResult(6, maxConfirmations), // block 8 unlocked
                generateVerificationResult(7, maxConfirmations), // block 9 unlocked
                generateVerificationResult(7, maxConfirmations), // block 10 unlocked
                generateVerificationResult(8, maxConfirmations), // block 11 unlocked
                generateVerificationResult(9, maxConfirmations), // block 12 unlocked
            ];

            await submitBlockHeaders(expectedBlocks, submitterAddr);

            for (let i = 0; i < expectedBlocks.length + 1; i++) {
                // console.log(`Current time: ${await time.latest()}`);
                // console.log(`Unlocked block: ${i}`);

                for (let j = 0; j < expectedVerificationResults[i].length; j++) {
                    if (expectedVerificationResults[i][j] === 0) {
                        let balanceSubmitterBeforeCall = await balance.current(submitterAddr);
                        let balanceVerifierBeforeCall = await balance.current(verifierAddr);

                        let ret = await ethrelay.verifyTransaction(verificationFee, requestedBlockInRlp, j, Value, Path, Nodes, {
                            from: verifierAddr,
                            value: verificationFee,
                            gasPrice: GAS_PRICE_IN_WEI
                        });

                        expectEvent.inLogs(ret.logs, 'VerifyTransaction', {result: new BN(expectedVerificationResults[i][j])});
                        let balanceSubmitterAfterCall = await balance.current(submitterAddr);
                        let balanceVerifierAfterCall = await balance.current(verifierAddr);
                        let txCost = (new BN(ret.receipt.gasUsed)).mul(GAS_PRICE_IN_WEI);

                        expect(balanceSubmitterBeforeCall).to.be.bignumber.equal(balanceSubmitterAfterCall.sub(verificationFee));
                        expect(balanceVerifierBeforeCall).to.be.bignumber.equal(balanceVerifierAfterCall.add(verificationFee).add(txCost));
                    }
                    if (expectedVerificationResults[i][j] === -1) {
                        await expectRevert(ethrelay.verifyTransaction(verificationFee, requestedBlockInRlp, j, Value, Path, Nodes, {
                            from: verifierAddr,
                            value: verificationFee,
                            gasPrice: GAS_PRICE_IN_WEI
                        }), "block is locked or not confirmed by enough blocks");
                    }
                }

                if (i < expectedBlocks.length) {
                    await time.increaseTo(expectedBlocks[i].lockedUntil);
                    await time.increase(time.duration.seconds(1));
                }
            }

            await withdrawStake(stake, submitterAddr);
        });
        // Test Scenario 4:
        //
        // (0)---(1)
        //    \
        //      -(2)---(3)---(4)---(6)---(8)---(10)---(12)
        //        ^       \     \     \     \
        //        |         -(5)  -(7)  -(9)  -(11)
        //        tx
        //
        it('should correctly execute test scenario 4', async () => {
            // deposit enough stake
            const submitterAddr = accounts[0];
            const verifierAddr = accounts[1];
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(12));
            await ethrelay.depositStake(stake, {from: submitterAddr, value: stake, gasPrice: GAS_PRICE_IN_WEI});
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            // Create expected chain
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block6 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block7 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block8 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block9 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block10 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 6);
            const block11 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 6);
            const block12 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 7);
            
            const {Value, Path, Nodes} = require("./transactions/genesisPlus1.json");

            block2.nonce = addToHex(block2.nonce, 1);
            block2.hash = calculateBlockHash(block2);

            block3.parentHash = block2.hash;
            block3.hash = calculateBlockHash(block3);

            block4.parentHash = block3.hash;
            block4.hash = calculateBlockHash(block4);
            block5.nonce = addToHex(block5.nonce, 1);
            block5.parentHash = block3.hash;
            block5.hash = calculateBlockHash(block5);

            block6.parentHash = block4.hash;
            block6.hash = calculateBlockHash(block6);
            block7.nonce = addToHex(block7.nonce, 1);
            block7.parentHash = block4.hash;
            block7.hash = calculateBlockHash(block7);

            block8.parentHash = block6.hash;
            block8.hash = calculateBlockHash(block8);
            block9.nonce = addToHex(block9.nonce, 1);
            block9.parentHash = block6.hash;
            block9.hash = calculateBlockHash(block9);

            block10.parentHash = block8.hash;
            block10.hash = calculateBlockHash(block10);
            block11.nonce = addToHex(block11.nonce, 1);
            block11.parentHash = block8.hash;
            block11.hash = calculateBlockHash(block11);

            block12.parentHash = block10.hash;
            block12.hash = calculateBlockHash(block12);

            const requestedBlockInRlp = createRLPHeader(block2);
            const expectedBlocks = [
                {block: block1},
                {block: block2},
                {block: block3},
                {block: block4},
                {block: block5},
                {block: block6},
                {block: block7},
                {block: block8},
                {block: block9},
                {block: block10},
                {block: block11},
                {block: block12}
            ];

            const maxConfirmations = expectedBlocks.length + 1;
            const expectedVerificationResults = [
                generateVerificationResult(0, maxConfirmations), // no unlocked block
                generateVerificationResult(0, maxConfirmations), // block 1 unlocked
                generateVerificationResult(1, maxConfirmations), // block 2 unlocked
                generateVerificationResult(2, maxConfirmations), // block 3 unlocked
                generateVerificationResult(3, maxConfirmations), // block 4 unlocked
                generateVerificationResult(3, maxConfirmations), // block 5 unlocked
                generateVerificationResult(4, maxConfirmations), // block 6 unlocked
                generateVerificationResult(4, maxConfirmations), // block 7 unlocked
                generateVerificationResult(5, maxConfirmations), // block 8 unlocked
                generateVerificationResult(5, maxConfirmations), // block 9 unlocked
                generateVerificationResult(6, maxConfirmations), // block 10 unlocked
                generateVerificationResult(6, maxConfirmations), // block 11 unlocked
                generateVerificationResult(7, maxConfirmations), // block 12 unlocked
            ];

            await submitBlockHeaders(expectedBlocks, submitterAddr);

            for (let i = 0; i < expectedBlocks.length + 1; i++) {
                // console.log(`Current time: ${await time.latest()}`);
                // console.log(`Unlocked block: ${i}`);

                for (let j = 0; j < expectedVerificationResults[i].length; j++) {
                    if (expectedVerificationResults[i][j] === 0) {
                        let balanceSubmitterBeforeCall = await balance.current(submitterAddr);
                        let balanceVerifierBeforeCall = await balance.current(verifierAddr);

                        let ret = await ethrelay.verifyTransaction(verificationFee, requestedBlockInRlp, j, Value, Path, Nodes, {
                            from: verifierAddr,
                            value: verificationFee,
                            gasPrice: GAS_PRICE_IN_WEI
                        });

                        expectEvent.inLogs(ret.logs, 'VerifyTransaction', {result: new BN(expectedVerificationResults[i][j])});
                        let balanceSubmitterAfterCall = await balance.current(submitterAddr);
                        let balanceVerifierAfterCall = await balance.current(verifierAddr);
                        let txCost = (new BN(ret.receipt.gasUsed)).mul(GAS_PRICE_IN_WEI);

                        expect(balanceSubmitterBeforeCall).to.be.bignumber.equal(balanceSubmitterAfterCall.sub(verificationFee));
                        expect(balanceVerifierBeforeCall).to.be.bignumber.equal(balanceVerifierAfterCall.add(verificationFee).add(txCost));
                    }
                    if (expectedVerificationResults[i][j] === -1) {
                        await expectRevert(ethrelay.verifyTransaction(verificationFee, requestedBlockInRlp, j, Value, Path, Nodes, {
                            from: verifierAddr,
                            value: verificationFee,
                            gasPrice: GAS_PRICE_IN_WEI
                        }), "block is locked or not confirmed by enough blocks");
                    }
                }

                if (i < expectedBlocks.length) {
                    await time.increaseTo(expectedBlocks[i].lockedUntil);
                    await time.increase(time.duration.seconds(1));
                }
            }

            await withdrawStake(stake, submitterAddr);
        });

        // Test Scenario 5:
        //
        // (0)---(1)  <-- tx
        //    \
        //      -(2)---(3)---(4)---(6)---(8)---(10)---(12)
        //                \     \     \     \
        //                  -(5)  -(7)  -(9)  -(11)
        //
        //
        it('should correctly execute test scenario 5', async () => {
            // deposit enough stake
            const submitterAddr = accounts[0];
            const verifierAddr = accounts[1];
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(12));
            await ethrelay.depositStake(stake, {from: submitterAddr, value: stake, gasPrice: GAS_PRICE_IN_WEI});
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            // Create expected chain
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block6 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block7 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block8 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block9 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block10 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 6);
            const block11 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 6);
            const block12 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 7);
            
            const {Value, Path, Nodes} = require("./transactions/genesisPlus1.json");

            block2.nonce = addToHex(block2.nonce, 1);
            block2.hash = calculateBlockHash(block2);

            block3.parentHash = block2.hash;
            block3.hash = calculateBlockHash(block3);

            block4.parentHash = block3.hash;
            block4.hash = calculateBlockHash(block4);
            block5.nonce = addToHex(block5.nonce, 1);
            block5.parentHash = block3.hash;
            block5.hash = calculateBlockHash(block5);

            block6.parentHash = block4.hash;
            block6.hash = calculateBlockHash(block6);
            block7.nonce = addToHex(block7.nonce, 1);
            block7.parentHash = block4.hash;
            block7.hash = calculateBlockHash(block7);

            block8.parentHash = block6.hash;
            block8.hash = calculateBlockHash(block8);
            block9.nonce = addToHex(block9.nonce, 1);
            block9.parentHash = block6.hash;
            block9.hash = calculateBlockHash(block9);

            block10.parentHash = block8.hash;
            block10.hash = calculateBlockHash(block10);
            block11.nonce = addToHex(block11.nonce, 1);
            block11.parentHash = block8.hash;
            block11.hash = calculateBlockHash(block11);

            block12.parentHash = block10.hash;
            block12.hash = calculateBlockHash(block12);

            const requestedBlockInRlp = createRLPHeader(block1);
            const expectedBlocks = [
                {block: block1},
                {block: block2},
                {block: block3},
                {block: block4},
                {block: block5},
                {block: block6},
                {block: block7},
                {block: block8},
                {block: block9},
                {block: block10},
                {block: block11},
                {block: block12}
            ];

            await submitBlockHeaders(expectedBlocks, submitterAddr);

            await expectRevert(ethrelay.verifyTransaction(verificationFee, requestedBlockInRlp, 0, Value, Path, Nodes, {
                from: verifierAddr,
                value: verificationFee,
                gasPrice: GAS_PRICE_IN_WEI
            }), "block is not part of the longest PoW chain.");

            await withdrawStake(stake, submitterAddr);
        });

        // Test Scenario 6: submit valid Merkle Patricia proof
        //
        //       tx
        //        |
        //        v
        // (0)---(1)---(2)---(3)---(4)---(5)
        //
        it('should correctly execute test scenario 6', async () => {
            // deposit enough stake
            const submitterAddr = accounts[0];
            const verifierAddr = accounts[1];
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(5));
            await ethrelay.depositStake(stake, {from: submitterAddr, value: stake, gasPrice: GAS_PRICE_IN_WEI});
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            // Create expected chain
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const requestedBlockInRlp = createRLPHeader(block1);
            
            const {Value, Path, Nodes} = require("./transactions/genesisPlus1.json");

            const expectedBlocks = [
                {
                    block: block1,
                },
                {
                    block: block2,
                },
                {
                    block: block3,
                },
                {
                    block: block4,
                },
                {
                    block: block5,
                },
            ];

            await submitBlockHeaders(expectedBlocks, submitterAddr);

            await time.increaseTo(expectedBlocks[0].lockedUntil);
            await time.increase(time.duration.seconds(1));

            let balanceSubmitterBeforeCall = await balance.current(submitterAddr);
            let balanceVerifierBeforeCall = await balance.current(verifierAddr);

            let ret = await ethrelay.verifyTransaction(verificationFee, requestedBlockInRlp, 0, Value, Path, Nodes, {
                from: verifierAddr,
                value: verificationFee,
                gasPrice: GAS_PRICE_IN_WEI
            });
            expectEvent.inLogs(ret.logs, 'VerifyTransaction', {result: new BN(0)});

            let balanceSubmitterAfterCall = await balance.current(submitterAddr);
            let balanceVerifierAfterCall = await balance.current(verifierAddr);
            let txCost = (new BN(ret.receipt.gasUsed)).mul(GAS_PRICE_IN_WEI);

            expect(balanceSubmitterBeforeCall).to.be.bignumber.equal(balanceSubmitterAfterCall.sub(verificationFee));
            expect(balanceVerifierBeforeCall).to.be.bignumber.equal(balanceVerifierAfterCall.add(verificationFee).add(txCost));

            await withdrawStake(stake, submitterAddr);
        });

        // Test Scenario 7: submit invalid Merkle Patricia proof
        //
        //
        //
        //
        // (0)---(1)---(2)---(3)---(4)---(5)
        //
        it('should correctly execute test scenario 7', async () => {
            // deposit enough stake
            const submitterAddr = accounts[0];
            const verifierAddr = accounts[1];
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(5));
            await ethrelay.depositStake(stake, {from: submitterAddr, value: stake, gasPrice: GAS_PRICE_IN_WEI});
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            // Create expected chain
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const requestedBlockInRlp = createRLPHeader(block1);
            
            const {Value, Path, Nodes} = require("./transactions/invalid.json");

            const expectedBlocks = [
                {
                    block: block1,
                },
                {
                    block: block2,
                },
                {
                    block: block3,
                },
                {
                    block: block4,
                },
                {
                    block: block5,
                },
            ];

            await submitBlockHeaders(expectedBlocks, submitterAddr);

            await time.increaseTo(expectedBlocks[0].lockedUntil);
            await time.increase(time.duration.seconds(1));

            let balanceSubmitterBeforeCall = await balance.current(submitterAddr);
            let balanceVerifierBeforeCall = await balance.current(verifierAddr);

            let ret = await ethrelay.verifyTransaction(verificationFee, requestedBlockInRlp, 0, Value, Path, Nodes, {
                from: verifierAddr,
                value: verificationFee,
                gasPrice: GAS_PRICE_IN_WEI
            });
            expectEvent.inLogs(ret.logs, 'VerifyTransaction', {result: new BN(1)});

            let balanceSubmitterAfterCall = await balance.current(submitterAddr);
            let balanceVerifierAfterCall = await balance.current(verifierAddr);
            let txCost = (new BN(ret.receipt.gasUsed)).mul(GAS_PRICE_IN_WEI);

            expect(balanceSubmitterBeforeCall).to.be.bignumber.equal(balanceSubmitterAfterCall.sub(verificationFee));
            expect(balanceVerifierBeforeCall).to.be.bignumber.equal(balanceVerifierAfterCall.add(verificationFee).add(txCost));

            await withdrawStake(stake, submitterAddr);
        });

        // Test Scenario 8: submit Merkle Patricia proof for a block that is not stored in the contract
        //
        //
        //
        //
        // (0)---(1)---(2)---(3)---(4)---(5)
        //
        it('should correctly execute test scenario 8', async () => {
            // deposit enough stake
            const submitterAddr = accounts[0];
            const verifierAddr = accounts[1];
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(5));
            await ethrelay.depositStake(stake, {from: submitterAddr, value: stake, gasPrice: GAS_PRICE_IN_WEI});
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            // Create expected chain
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block6 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 6);  // this block will not be submitted
            const requestedBlockInRlp = createRLPHeader(block6);
            
            const {Value, Path, Nodes} = require("./transactions/genesisPlus6.json");

            const expectedBlocks = [
                {
                    block: block1,
                },
                {
                    block: block2,
                },
                {
                    block: block3,
                },
                {
                    block: block4,
                },
                {
                    block: block5,
                },
            ];

            await submitBlockHeaders(expectedBlocks, submitterAddr);

            await expectRevert(ethrelay.verifyTransaction(verificationFee, requestedBlockInRlp, 0, Value, Path, Nodes, {
                from: verifierAddr,
                value: verificationFee,
                gasPrice: GAS_PRICE_IN_WEI
            }), "block does not exist");

            await withdrawStake(stake, submitterAddr);
        });

        it('should revert since msg.value not equal to function parameter', async () => {
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            const block0 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
            const requestedBlockInRlp = createRLPHeader(block0);
            
            const {Value, Path, Nodes} = require("./transactions/genesis.json");

            await expectRevert(ethrelay.verifyTransaction(verificationFee.add(new BN(1)), requestedBlockInRlp, 0, Value, Path, Nodes, {
                from: accounts[0],
                value: verificationFee,
                gasPrice: GAS_PRICE_IN_WEI
            }), "transfer amount not equal to function parameter");
        });

        it('should revert since provided fee is too small', async () => {
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            const block0 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
            const requestedBlockInRlp = createRLPHeader(block0);
            
            const {Value, Path, Nodes} = require("./transactions/genesis.json");

            await expectRevert(ethrelay.verifyTransaction(verificationFee.sub(new BN(1)), requestedBlockInRlp, 0, Value, Path, Nodes, {
                from: accounts[0],
                value: verificationFee.sub(new BN(1)),
                gasPrice: GAS_PRICE_IN_WEI
            }), "provided fee is less than expected fee");
        });

    });

    describe('Ethrelay: VerifyReceipt', function () {

        // Test Scenario 1: submit valid Merkle Patricia proof
        //
        //       tx
        //        |
        //        v
        // (0)---(1)---(2)---(3)---(4)---(5)
        //
        it('should correctly execute test scenario 1', async () => {
            const submitterAddr = accounts[0];
            const verifierAddr = accounts[1];
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(5));
            await ethrelay.depositStake(stake, {from: submitterAddr, value: stake, gasPrice: GAS_PRICE_IN_WEI});
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            // Create expected chain
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const requestedBlockInRlp = createRLPHeader(block1);
            
            const {Value, Path, Nodes} = require("./receipts/genesisPlus1.json");
            
            const expectedBlocks = [
                {
                    block: block1,
                },
                {
                    block: block2,
                },
                {
                    block: block3,
                },
                {
                    block: block4,
                },
                {
                    block: block5,
                },
            ];

            await submitBlockHeaders(expectedBlocks, submitterAddr);

            await time.increaseTo(expectedBlocks[0].lockedUntil);
            await time.increase(time.duration.seconds(1));

            let balanceSubmitterBeforeCall = await balance.current(submitterAddr);
            let balanceVerifierBeforeCall = await balance.current(verifierAddr);

            let ret = await ethrelay.verifyReceipt(verificationFee, requestedBlockInRlp, 0, Value, Path, Nodes, {
                from: verifierAddr,
                value: verificationFee,
                gasPrice: GAS_PRICE_IN_WEI
            });
            expectEvent.inLogs(ret.logs, 'VerifyReceipt', {result: new BN(0)});

            let balanceSubmitterAfterCall = await balance.current(submitterAddr);
            let balanceVerifierAfterCall = await balance.current(verifierAddr);
            let txCost = (new BN(ret.receipt.gasUsed)).mul(GAS_PRICE_IN_WEI);

            expect(balanceSubmitterBeforeCall).to.be.bignumber.equal(balanceSubmitterAfterCall.sub(verificationFee));
            expect(balanceVerifierBeforeCall).to.be.bignumber.equal(balanceVerifierAfterCall.add(verificationFee).add(txCost));

            await withdrawStake(stake, submitterAddr);
        });

        // Test Scenario 2: submit invalid Merkle Patricia proof
        //
        //
        //
        //
        // (0)---(1)---(2)---(3)---(4)---(5)
        //
        it('should correctly execute test scenario 2', async () => {
            const submitterAddr = accounts[0];
            const verifierAddr = accounts[1];
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(5));
            await ethrelay.depositStake(stake, {from: submitterAddr, value: stake, gasPrice: GAS_PRICE_IN_WEI});
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            // Create expected chain
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const requestedBlockInRlp = createRLPHeader(block1);
            
            const {Value, Path, Nodes} = require("./receipts/invalid.json");

            const expectedBlocks = [
                {
                    block: block1,
                },
                {
                    block: block2,
                },
                {
                    block: block3,
                },
                {
                    block: block4,
                },
                {
                    block: block5,
                },
            ];

            await submitBlockHeaders(expectedBlocks, submitterAddr);

            await time.increaseTo(expectedBlocks[0].lockedUntil);
            await time.increase(time.duration.seconds(1));

            let balanceSubmitterBeforeCall = await balance.current(submitterAddr);
            let balanceVerifierBeforeCall = await balance.current(verifierAddr);

            let ret = await ethrelay.verifyReceipt(verificationFee, requestedBlockInRlp, 0, Value, Path, Nodes, {
                from: verifierAddr,
                value: verificationFee,
                gasPrice: GAS_PRICE_IN_WEI
            });
            expectEvent.inLogs(ret.logs, 'VerifyReceipt', {result: new BN(1)});

            let balanceSubmitterAfterCall = await balance.current(submitterAddr);
            let balanceVerifierAfterCall = await balance.current(verifierAddr);
            let txCost = (new BN(ret.receipt.gasUsed)).mul(GAS_PRICE_IN_WEI);

            expect(balanceSubmitterBeforeCall).to.be.bignumber.equal(balanceSubmitterAfterCall.sub(verificationFee));
            expect(balanceVerifierBeforeCall).to.be.bignumber.equal(balanceVerifierAfterCall.add(verificationFee).add(txCost));

            await withdrawStake(stake, submitterAddr);
        });

        // Test Scenario 3: submit Merkle Patricia proof for a block that is not stored in the contract
        //
        //
        //
        //
        // (0)---(1)---(2)---(3)---(4)---(5)
        //
        it('should correctly execute test scenario 3', async () => {
            const submitterAddr = accounts[0];
            const verifierAddr = accounts[1];
            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(5));
            await ethrelay.depositStake(stake, {from: submitterAddr, value: stake, gasPrice: GAS_PRICE_IN_WEI});
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            // Create expected chain
            const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block6 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 6);  // this block will not be submitted
            const requestedBlockInRlp = createRLPHeader(block6);

            const {Value, Path, Nodes} = require("./receipts/genesisPlus6.json");

            const expectedBlocks = [
                {
                    block: block1,
                },
                {
                    block: block2,
                },
                {
                    block: block3,
                },
                {
                    block: block4,
                },
                {
                    block: block5,
                },
            ];

            await submitBlockHeaders(expectedBlocks, submitterAddr);

            await expectRevert(ethrelay.verifyReceipt(verificationFee, requestedBlockInRlp, 0, Value, Path, Nodes, {
                from: verifierAddr,
                value: verificationFee,
                gasPrice: GAS_PRICE_IN_WEI
            }), "block does not exist");

            await withdrawStake(stake, submitterAddr);
        });

        it('should revert since msg.value not equal to function parameter', async () => {
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            const block0 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
            const requestedBlockInRlp = createRLPHeader(block0);
            
            const {Value, Path, Nodes} = require("./receipts/genesis.json");

            await expectRevert(ethrelay.verifyReceipt(verificationFee.add(new BN(1)), requestedBlockInRlp, 0, Value, Path, Nodes, {
                from: accounts[0],
                value: verificationFee,
                gasPrice: GAS_PRICE_IN_WEI
            }), "transfer amount not equal to function parameter");
        });

        it('should revert since provided fee is too small', async () => {
            const verificationFee = await ethrelay.getRequiredVerificationFee();

            const block0 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
            const requestedBlockInRlp = createRLPHeader(block0);
            
            const {Value, Path, Nodes} = require("./receipts/genesis.json");

            await expectRevert(ethrelay.verifyReceipt(verificationFee.sub(new BN(1)), requestedBlockInRlp, 0, Value, Path, Nodes, {
                from: accounts[0],
                value: verificationFee.sub(new BN(1)),
                gasPrice: GAS_PRICE_IN_WEI
            }), "provided fee is less than expected fee");
        });
    });

    describe('DisputeBlock', function () {

        describe('EthrelayCore', function () {

            // Test Scenario 1 (verification of Ethash should fail):
            //
            // (0)---(1)-X-(2)---(3)---(4)
            //
            //
            it('should correctly execute test scenario 1', async () => {
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                const stakeAccount0 = requiredStakePerBlock.mul(new BN(2));
                const stakeAccount1 = requiredStakePerBlock.mul(new BN(2));
                const stakeAccount2 = requiredStakePerBlock.mul(new BN(1));
                await ethrelay.depositStake(stakeAccount0, {
                    from: accounts[0],
                    value: stakeAccount0,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits block 1
                await ethrelay.depositStake(stakeAccount1, {
                    from: accounts[1],
                    value: stakeAccount1,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 2,3
                await ethrelay.depositStake(stakeAccount2, {
                    from: accounts[2],
                    value: stakeAccount2,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits block 4

                // Create expected chain
                const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);

                // change nonce such that the PoW validation results in false (prune Branch)
                block2.nonce = addToHex(block2.nonce, 1);
                block2.hash = calculateBlockHash(block2);
                block3.parentHash = block2.hash;
                block3.hash = calculateBlockHash(block3);
                block4.parentHash = block3.hash;
                block4.hash = calculateBlockHash(block4);

                const {
                    "DatasetLookup":    dataSetLookupBlock2,
                    "WitnessForLookup": witnessForLookupBlock2,
                } = require("./pow/genesisPlus2.json");

                // Submit and dispute blocks
                await submitBlockHeader(block1, accounts[0]);
                const block1LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block2, accounts[1]);
                await submitBlockHeader(block3, accounts[1]);
                await submitBlockHeader(block4, accounts[2]);

                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(block2), createRLPHeader(block1), dataSetLookupBlock2, witnessForLookupBlock2, {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[1], accounts[1], accounts[2]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(2)});

                // Check
                const expectedEndpoints = [block1];
                const expectedBlocks = [
                    {
                        block: block1,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [],
                        lockedUntil: block1LockedUntil,
                        submitter: accounts[0]
                    }
                ];
                const expectedZeroBlocks = [block2, block3, block4];

                await checkExpectedEndpoints(expectedEndpoints);
                await checkExpectedBlockHeaders(expectedBlocks);
                await checkExpectedZeroBlocks(expectedZeroBlocks);

                // withdraw stake
                await withdrawStake(stakeAccount0, accounts[0]);
                await withdrawStake(stakeAccount1, accounts[1]);
                await withdrawStake(stakeAccount2, accounts[2]);
            });

            // Test Scenario 2 (verification of Ethash should fail):
            //
            // (0)---(1)-X-(2)---(4)---(5)
            //          \
            //            -(3)---(6)
            //
            it('should correctly execute test scenario 2', async () => {
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                const stakeAccount0 = requiredStakePerBlock.mul(new BN(3));
                const stakeAccount1 = requiredStakePerBlock.mul(new BN(3));
                await ethrelay.depositStake(stakeAccount0, {
                    from: accounts[0],
                    value: stakeAccount0,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits block 1,3,6
                await ethrelay.depositStake(stakeAccount1, {
                    from: accounts[1],
                    value: stakeAccount1,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 2,4,5

                // Create expected chain
                const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
                const block6 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);

                // change nonce such that the PoW validation results in false (prune Branch)
                block2.nonce = addToHex(block2.nonce, 1);
                block2.hash = calculateBlockHash(block2);
                block4.parentHash = block2.hash;
                block4.hash = calculateBlockHash(block4);
                block5.parentHash = block4.hash;
                block5.hash = calculateBlockHash(block5);

                const {
                    "DatasetLookup":    dataSetLookupBlock2,
                    "WitnessForLookup": witnessForLookupBlock2,
                } = require("./pow/genesisPlus2.json");

                // Submit and dispute blocks
                await submitBlockHeader(block1, accounts[0]);
                const block1LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block2, accounts[1]);
                await submitBlockHeader(block3, accounts[0]);
                const block3LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block4, accounts[1]);
                await submitBlockHeader(block5, accounts[1]);
                await submitBlockHeader(block6, accounts[0]);
                const block6LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(block2), createRLPHeader(block1), dataSetLookupBlock2, witnessForLookupBlock2, {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[1], accounts[1], accounts[1]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(2)});

                // Check
                const expectedBlocks = [
                    {
                        block: block1,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [block3.hash],
                        lockedUntil: block1LockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block3,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [block6.hash],
                        lockedUntil: block3LockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block6,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [],
                        lockedUntil: block6LockedUntil,
                        submitter: accounts[0]
                    }
                ];
                const expectedEndpoints = [block6];
                const expectedZeroBlocks = [block2, block4, block5];
                await checkExpectedEndpoints(expectedEndpoints);
                await checkExpectedBlockHeaders(expectedBlocks);
                await checkExpectedZeroBlocks(expectedZeroBlocks);

                // withdraw stake
                await withdrawStake(stakeAccount0, accounts[0]);
                await withdrawStake(stakeAccount1, accounts[1]);
            });

            // Test Scenario 3 (verification of Ethash should fail):
            //
            // (0)---(1)---(2)---(4)---(5)
            //          \
            //           X-(3)---(6)
            //
            it('should correctly execute test scenario 3', async () => {
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                const stakeAccount0 = requiredStakePerBlock.mul(new BN(4));
                const stakeAccount1 = requiredStakePerBlock.mul(new BN(1));
                const stakeAccount2 = requiredStakePerBlock.mul(new BN(1));
                await ethrelay.depositStake(stakeAccount0, {
                    from: accounts[0],
                    value: stakeAccount0,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 1,2,4,5
                await ethrelay.depositStake(stakeAccount1, {
                    from: accounts[1],
                    value: stakeAccount1,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits block 3
                await ethrelay.depositStake(stakeAccount1, {
                    from: accounts[2],
                    value: stakeAccount2,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits block 6

                // Create expected chain
                const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);
                const block6 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);

                // change nonce such that (1) the PoW validation results in false (prune Branch) and (2) to get different hashes for block2 and block3
                block3.nonce = addToHex(block3.nonce, 1);
                block3.hash = calculateBlockHash(block3);

                block6.parentHash = block3.hash;
                block6.hash = calculateBlockHash(block6);

                const {
                    "DatasetLookup":    dataSetLookupBlock3,
                    "WitnessForLookup": witnessForLookupBlock3,
                } = require("./pow/genesisPlus2.json");

                // Submit and dispute blocks
                await submitBlockHeader(block1, accounts[0]);
                const block1LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block2, accounts[0]);
                const block2LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block3, accounts[1]);
                await submitBlockHeader(block4, accounts[0]);
                const block4LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block5, accounts[0]);
                const block5LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block6, accounts[2]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(block3), createRLPHeader(block1), dataSetLookupBlock3, witnessForLookupBlock3, {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[1], accounts[2]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(2)});

                // Check
                const expectedBlocks = [
                    {
                        block: block1,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [block2.hash],
                        lockedUntil: block1LockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block2,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [block4.hash],
                        lockedUntil: block2LockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block4,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [block5.hash],
                        lockedUntil: block4LockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block5,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [],
                        lockedUntil: block5LockedUntil,
                        submitter: accounts[0]
                    }
                ];
                const expectedEndpoints = [block5];
                const expectedZeroBlocks = [block3, block6];
                await checkExpectedBlockHeaders(expectedBlocks);
                await checkExpectedEndpoints(expectedEndpoints);
                await checkExpectedZeroBlocks(expectedZeroBlocks);

                // withdraw stake
                await withdrawStake(stakeAccount0, accounts[0]);
                await withdrawStake(stakeAccount1, accounts[1]);
                await withdrawStake(stakeAccount2, accounts[2]);
            });

            // Test Scenario 4 (verification of Ethash should fail):
            //
            //            -(2)---(5)
            //          /
            // (0)---(1)---(3)---(6)---(8)
            //          \
            //           X-(4)---(7)
            //
            it('should correctly execute test scenario 4', async () => {
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                const stakeAccount0 = requiredStakePerBlock.mul(new BN(3));
                const stakeAccount1 = requiredStakePerBlock.mul(new BN(1));
                const stakeAccount2 = requiredStakePerBlock.mul(new BN(4));
                await ethrelay.depositStake(stakeAccount0, {
                    from: accounts[0],
                    value: stakeAccount0,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 1,2,5
                await ethrelay.depositStake(stakeAccount1, {
                    from: accounts[1],
                    value: stakeAccount1,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 7
                await ethrelay.depositStake(stakeAccount2, {
                    from: accounts[2],
                    value: stakeAccount2,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 3,4,6,8

                // Create expected chain
                const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block6 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block7 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block8 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);

                // change nonce such that (1) the PoW validation results in false (prune Branch) and (2) to get different hashes for blocks with the same heigth/number
                block3.nonce = addToHex(block3.nonce, 1);
                block3.hash = calculateBlockHash(block3);
                block4.nonce = addToHex(block4.nonce, 2);
                block4.hash = calculateBlockHash(block4);

                block6.parentHash = block3.hash;
                block6.hash = calculateBlockHash(block6);
                block8.parentHash = block6.hash;
                block8.hash = calculateBlockHash(block8);

                block7.parentHash = block4.hash;
                block7.hash = calculateBlockHash(block7);

                const {
                    "DatasetLookup":    dataSetLookupBlock4,
                    "WitnessForLookup": witnessForLookupBlock4,
                } = require("./pow/genesisPlus2.json");

                // Submit and dispute blocks
                await submitBlockHeader(block1, accounts[0]);
                const block1LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block2, accounts[0]);
                const block2LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block3, accounts[2]);
                const block3LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block4, accounts[2]);
                await submitBlockHeader(block5, accounts[0]);
                const block5LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block6, accounts[2]);
                const block6LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block7, accounts[1]);
                await submitBlockHeader(block8, accounts[2]);
                const block8LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(block4), createRLPHeader(block1), dataSetLookupBlock4, witnessForLookupBlock4, {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[2], accounts[1]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(2)});

                // Check
                const expectedBlocks = [
                    {
                        block: block1,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [block2.hash, block3.hash],
                        lockedUntil: block1LockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block2,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: block1.hash,
                        successors: [block5.hash],
                        lockedUntil: block2LockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block3,
                        forkId: 1,
                        iterableIndex: 0,
                        latestFork: block1.hash,
                        successors: [block6.hash],
                        lockedUntil: block3LockedUntil,
                        submitter: accounts[2]
                    },
                    {
                        block: block5,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: block1.hash,
                        successors: [],
                        lockedUntil: block5LockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block6,
                        forkId: 1,
                        iterableIndex: 0,
                        latestFork: block1.hash,
                        successors: [block8.hash],
                        lockedUntil: block6LockedUntil,
                        submitter: accounts[2]
                    },
                    {
                        block: block8,
                        forkId: 1,
                        iterableIndex: 1,
                        latestFork: block1.hash,
                        successors: [],
                        lockedUntil: block8LockedUntil,
                        submitter: accounts[2]
                    }
                ];
                const expectedEndpoints = [block5, block8];
                const expectedZeroBlocks = [block4, block7];
                await checkExpectedBlockHeaders(expectedBlocks);
                await checkExpectedEndpoints(expectedEndpoints);
                await checkExpectedZeroBlocks(expectedZeroBlocks);

                // withdraw stake
                await withdrawStake(stakeAccount0, accounts[0]);
                await withdrawStake(stakeAccount1, accounts[1]);
                await withdrawStake(stakeAccount2, accounts[2]);
            });

            // Test Scenario 5 (verification of Ethash should fail):
            //
            //            -(2)---(5)
            //          /
            // (0)---(1)-X-(3)---(6)---(7)
            //          \
            //            -(4)
            //
            it('should correctly execute test scenario 5', async () => {
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                const stakeAccount0 = requiredStakePerBlock.mul(new BN(3));
                const stakeAccount1 = requiredStakePerBlock.mul(new BN(1));
                const stakeAccount2 = requiredStakePerBlock.mul(new BN(3));
                await ethrelay.depositStake(stakeAccount0, {
                    from: accounts[0],
                    value: stakeAccount0,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 1,2,5
                await ethrelay.depositStake(stakeAccount1, {
                    from: accounts[1],
                    value: stakeAccount1,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 7
                await ethrelay.depositStake(stakeAccount2, {
                    from: accounts[2],
                    value: stakeAccount2,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 3,4,6

                // Create expected chain
                const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block6 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block7 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);

                // change nonce such that (1) the PoW validation results in false (prune Branch) and (2) to get different hashes for blocks with the same heigth/number
                block3.nonce = addToHex(block3.nonce, 1);
                block3.hash = calculateBlockHash(block3);
                block4.nonce = addToHex(block4.nonce, 2);
                block4.hash = calculateBlockHash(block4);

                block6.parentHash = block3.hash;
                block6.hash = calculateBlockHash(block6);

                block7.parentHash = block6.hash;
                block7.hash = calculateBlockHash(block7);

                const {
                    "DatasetLookup":    dataSetLookupBlock3,
                    "WitnessForLookup": witnessForLookupBlock3,
                } = require("./pow/genesisPlus2.json");

                // Submit and dispute blocks
                await submitBlockHeader(block1, accounts[0]);
                const block1LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block2, accounts[0]);
                const block2LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block3, accounts[2]);
                await submitBlockHeader(block4, accounts[2]);
                const block4LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block5, accounts[0]);
                const block5LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block6, accounts[2]);
                await submitBlockHeader(block7, accounts[1]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(block3), createRLPHeader(block1), dataSetLookupBlock3, witnessForLookupBlock3, {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[2], accounts[2], accounts[1]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(2)});

                // Check
                const expectedBlocks = [
                    {
                        block: block1,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [block2.hash, block4.hash],
                        lockedUntil: block1LockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block2,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: block1.hash,
                        successors: [block5.hash],
                        lockedUntil: block2LockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block4,
                        forkId: 2,
                        iterableIndex: 1,
                        latestFork: block1.hash,
                        successors: [],
                        lockedUntil: block4LockedUntil,
                        submitter: accounts[2]
                    },
                    {
                        block: block5,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: block1.hash,
                        successors: [],
                        lockedUntil: block5LockedUntil,
                        submitter: accounts[0]
                    }
                ];
                const expectedEndpoints = [block5, block4];
                const expectedZeroBlocks = [block3, block6, block7];
                await checkExpectedBlockHeaders(expectedBlocks);
                await checkExpectedEndpoints(expectedEndpoints);
                await checkExpectedZeroBlocks(expectedZeroBlocks);

                // withdraw stake
                await withdrawStake(stakeAccount0, accounts[0]);
                await withdrawStake(stakeAccount1, accounts[1]);
                await withdrawStake(stakeAccount2, accounts[2]);
            });

            // Test Scenario 6 (verification of Ethash should fail):
            //
            //           X-(2)---(5)---(7)
            //          /
            // (0)---(1)---(3)---(6)
            //          \
            //            -(4)
            //
            it('should correctly execute test scenario 6', async () => {
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                const stakeAccount0 = requiredStakePerBlock.mul(new BN(3));
                const stakeAccount1 = requiredStakePerBlock.mul(new BN(1));
                const stakeAccount2 = requiredStakePerBlock.mul(new BN(3));
                await ethrelay.depositStake(stakeAccount0, {
                    from: accounts[0],
                    value: stakeAccount0,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 1,2,5
                await ethrelay.depositStake(stakeAccount1, {
                    from: accounts[1],
                    value: stakeAccount1,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 7
                await ethrelay.depositStake(stakeAccount2, {
                    from: accounts[2],
                    value: stakeAccount2,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 3,4,6

                // Create expected chain
                const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block6 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block7 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);

                // change nonce such that (1) the PoW validation results in false (prune Branch) and (2) to get different hashes for blocks with the same heigth/number
                block2.nonce = addToHex(block3.nonce, 1);
                block2.hash = calculateBlockHash(block2);

                block5.parentHash = block2.hash;
                block5.hash = calculateBlockHash(block5);

                block7.parentHash = block5.hash;
                block7.hash = calculateBlockHash(block7);

                block4.nonce = addToHex(block4.nonce, 2);
                block4.hash = calculateBlockHash(block4);

                const {
                    "DatasetLookup":    dataSetLookupBlock2,
                    "WitnessForLookup": witnessForLookupBlock2,
                } = require("./pow/genesisPlus2.json");

                // Submit and dispute blocks
                await submitBlockHeader(block1, accounts[0]);
                const block1LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block2, accounts[0]);
                await submitBlockHeader(block3, accounts[2]);
                const block3LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block4, accounts[2]);
                const block4LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block5, accounts[0]);
                await submitBlockHeader(block6, accounts[2]);
                const block6LockedUntil = (await time.latest()).add(LOCK_PERIOD);
                await submitBlockHeader(block7, accounts[1]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(block2), createRLPHeader(block1), dataSetLookupBlock2, witnessForLookupBlock2, {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[0], accounts[0], accounts[1]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(2)});

                const expectedBlocks = [
                    {
                        block: block1,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [block4.hash, block3.hash],
                        lockedUntil: block1LockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block3,
                        forkId: 1,
                        iterableIndex: 0,
                        latestFork: block1.hash,
                        successors: [block6.hash],
                        lockedUntil: block3LockedUntil,
                        submitter: accounts[2]
                    },
                    {
                        block: block4,
                        forkId: 2,
                        iterableIndex: 0,
                        latestFork: block1.hash,
                        successors: [],
                        lockedUntil: block4LockedUntil,
                        submitter: accounts[2]
                    },
                    {
                        block: block6,
                        forkId: 1,
                        iterableIndex: 1,
                        latestFork: block1.hash,
                        successors: [],
                        lockedUntil: block6LockedUntil,
                        submitter: accounts[2]
                    }
                ];
                const expectedEndpoints = [block4, block6];
                const expectedZeroBlocks = [block2, block5, block7];
                await checkExpectedBlockHeaders(expectedBlocks);
                await checkExpectedEndpoints(expectedEndpoints);
                await checkExpectedZeroBlocks(expectedZeroBlocks);

                // withdraw stake
                await withdrawStake(stakeAccount0, accounts[0]);
                await withdrawStake(stakeAccount1, accounts[1]);
                await withdrawStake(stakeAccount2, accounts[2]);
            });

            // Test Scenario 7 (verification of Ethash should be successful):
            //
            // (0)---(1)-X-(2)---(3)---(4)      // try to dispute a valid block -> should not prone any header
            //
            //
            it('should correctly execute test scenario 7', async () => {
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                const stakeAccount0 = requiredStakePerBlock.mul(new BN(4));
                await ethrelay.depositStake(stakeAccount0, {
                    from: accounts[0],
                    value: stakeAccount0,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 1,2,3,4

                // Create expected chain
                const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);

                const blocksToSubmit = [
                    {block: block1},
                    {block: block2},
                    {block: block3},
                    {block: block4},
                ];

                const {
                    "DatasetLookup":    dataSetLookupBlock2,
                    "WitnessForLookup": witnessForLookupBlock2,
                } = require("./pow/genesisPlus2.json");

                // Submit and dispute blocks
                await submitBlockHeaders(blocksToSubmit, accounts[0]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(block2), createRLPHeader(block1), dataSetLookupBlock2, witnessForLookupBlock2, {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: []});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(0)});

                // Check
                const expectedEndpoints = [block4];
                const expectedBlocks = [
                    {
                        block: block1,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [block2.hash],
                        lockedUntil: blocksToSubmit[0].lockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block2,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [block3.hash],
                        lockedUntil: blocksToSubmit[1].lockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block3,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [block4.hash],
                        lockedUntil: blocksToSubmit[2].lockedUntil,
                        submitter: accounts[0]
                    },
                    {
                        block: block4,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: ZERO_HASH,
                        successors: [],
                        lockedUntil: blocksToSubmit[3].lockedUntil,
                        submitter: accounts[0]
                    }
                ];
                await checkExpectedEndpoints(expectedEndpoints);
                await checkExpectedBlockHeaders(expectedBlocks);

                // withdraw stake
                await withdrawStake(stakeAccount0, accounts[0]);
            });

            it('should eliminate the block since block number is not incremented by one (too high)', async () => {
                // deposit enough stake
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                await ethrelay.depositStake(requiredStakePerBlock, {
                    from: accounts[0],
                    value: requiredStakePerBlock,
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
                const blockWithWrongBlockNumber = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                blockWithWrongBlockNumber.number = GENESIS_BLOCK + 2;
                blockWithWrongBlockNumber.hash = calculateBlockHash(blockWithWrongBlockNumber);

                await submitBlockHeader(blockWithWrongBlockNumber, accounts[0]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(blockWithWrongBlockNumber), createRLPHeader(genesisBlock), [], [], {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[0]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(4)});

                await withdrawStake(requiredStakePerBlock, accounts[0]);
            });

            it('should eliminate block since the block number is not incremented by one (too low)', async () => {
                // deposit enough stake
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                await ethrelay.depositStake(requiredStakePerBlock, {
                    from: accounts[0],
                    value: requiredStakePerBlock,
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
                const blockWithWrongBlockNumber = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                blockWithWrongBlockNumber.number = GENESIS_BLOCK - 1;
                blockWithWrongBlockNumber.hash = calculateBlockHash(blockWithWrongBlockNumber);

                await submitBlockHeader(blockWithWrongBlockNumber, accounts[0]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(blockWithWrongBlockNumber), createRLPHeader(genesisBlock), [], [], {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[0]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(4)});

                await withdrawStake(requiredStakePerBlock, accounts[0]);
            });

            it('should eliminate block since the block number is not incremented by one (equal)', async () => {
                // deposit enough stake
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                await ethrelay.depositStake(requiredStakePerBlock, {
                    from: accounts[0],
                    value: requiredStakePerBlock,
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
                const blockWithWrongBlockNumber = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                blockWithWrongBlockNumber.number = GENESIS_BLOCK;
                blockWithWrongBlockNumber.hash = calculateBlockHash(blockWithWrongBlockNumber);

                await submitBlockHeader(blockWithWrongBlockNumber, accounts[0]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(blockWithWrongBlockNumber), createRLPHeader(genesisBlock), [], [], {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[0]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(4)});

                await withdrawStake(requiredStakePerBlock, accounts[0]);
            });

            it('should eliminate block since the timestamp of the submitted block is not in the future (equal)', async () => {
                // deposit enough stake
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                await ethrelay.depositStake(requiredStakePerBlock, {
                    from: accounts[0],
                    value: requiredStakePerBlock,
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
                const blockWithPastTimestamp = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                blockWithPastTimestamp.timestamp = genesisBlock.timestamp;
                blockWithPastTimestamp.hash = calculateBlockHash(blockWithPastTimestamp);

                await submitBlockHeader(blockWithPastTimestamp, accounts[0]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(blockWithPastTimestamp), createRLPHeader(genesisBlock), [], [], {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[0]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(6)});

                await withdrawStake(requiredStakePerBlock, accounts[0]);
            });

            it('should eliminate block since the timestamp of the submitted block is not in the future (older)', async () => {
                // deposit enough stake
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                await ethrelay.depositStake(requiredStakePerBlock, {
                    from: accounts[0],
                    value: requiredStakePerBlock,
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
                const blockWithPastTimestamp = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                blockWithPastTimestamp.timestamp = genesisBlock.timestamp - 1;
                blockWithPastTimestamp.hash = calculateBlockHash(blockWithPastTimestamp);

                await submitBlockHeader(blockWithPastTimestamp, accounts[0]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(blockWithPastTimestamp), createRLPHeader(genesisBlock), [], [], {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[0]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(6)});

                await withdrawStake(requiredStakePerBlock, accounts[0]);
            });

            it('should eliminate block since the timestamp of the submitted block is too far in the future', async () => {
                // deposit enough stake
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                await ethrelay.depositStake(requiredStakePerBlock, {
                    from: accounts[0],
                    value: requiredStakePerBlock,
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
                const blockWithPastTimestamp = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                blockWithPastTimestamp.timestamp = time.latest() + ALLOWED_FUTURE_BLOCK_TIME;
                blockWithPastTimestamp.hash = calculateBlockHash(blockWithPastTimestamp);

                await submitBlockHeader(blockWithPastTimestamp, accounts[0]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(blockWithPastTimestamp), createRLPHeader(genesisBlock), [], [], {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[0]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(5)});

                await withdrawStake(requiredStakePerBlock, accounts[0]);
            });

            it('should eliminate block since the difficulty of the submitted block is not correct', async () => {
                // deposit enough stake
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                await ethrelay.depositStake(requiredStakePerBlock, {
                    from: accounts[0],
                    value: requiredStakePerBlock,
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
                const blockWithIllegalDifficulty = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                const newDifficulty = web3.utils.toBN(blockWithIllegalDifficulty.difficulty).add(web3.utils.toBN(1000));
                blockWithIllegalDifficulty.difficulty = newDifficulty.toString();
                blockWithIllegalDifficulty.hash = calculateBlockHash(blockWithIllegalDifficulty);

                await submitBlockHeader(blockWithIllegalDifficulty, accounts[0]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(blockWithIllegalDifficulty), createRLPHeader(genesisBlock), [], [], {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[0]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(7)});

                await withdrawStake(requiredStakePerBlock, accounts[0]);
            });

            it('should eliminate block since the gas limit of the submitted block is higher than maximum gas limit', async () => {
                // deposit enough stake
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                await ethrelay.depositStake(requiredStakePerBlock, {
                    from: accounts[0],
                    value: requiredStakePerBlock,
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
                const blockWithIllegalGasLimit = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                blockWithIllegalGasLimit.gasLimit = MAX_GAS_LIMIT + 1n;
                blockWithIllegalGasLimit.hash = calculateBlockHash(blockWithIllegalGasLimit);

                await submitBlockHeader(blockWithIllegalGasLimit, accounts[0]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(blockWithIllegalGasLimit), createRLPHeader(genesisBlock), [], [], {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[0]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(8)});

                await withdrawStake(requiredStakePerBlock, accounts[0]);
            });

            it('should eliminate block sincethe gas limit of the submitted block is smaller than the minium gas limit', async () => {
                // deposit enough stake
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                await ethrelay.depositStake(requiredStakePerBlock, {
                    from: accounts[0],
                    value: requiredStakePerBlock,
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
                const blockWithIllegalGasLimit = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                blockWithIllegalGasLimit.gasLimit = MIN_GAS_LIMIT - 1;
                blockWithIllegalGasLimit.hash = calculateBlockHash(blockWithIllegalGasLimit);

                await submitBlockHeader(blockWithIllegalGasLimit, accounts[0]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(blockWithIllegalGasLimit), createRLPHeader(genesisBlock), [], [], {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[0]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(9)});

                await withdrawStake(requiredStakePerBlock, accounts[0]);
            });

            it('should eliminate block since the gas limit of the submitted block is out of bounds (too high)', async () => {
                // deposit enough stake
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                await ethrelay.depositStake(requiredStakePerBlock, {
                    from: accounts[0],
                    value: requiredStakePerBlock,
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
                const limit = BigInt(genesisBlock.gasLimit) / GAS_LIMIT_BOUND_DIVISOR;
                const blockWithIllegalGasLimit = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                blockWithIllegalGasLimit.gasLimit = BigInt(genesisBlock.gasLimit) + limit + 1n;
                blockWithIllegalGasLimit.hash = calculateBlockHash(blockWithIllegalGasLimit);

                await submitBlockHeader(blockWithIllegalGasLimit, accounts[0]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(blockWithIllegalGasLimit), createRLPHeader(genesisBlock), [], [], {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[0]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(10)});

                await withdrawStake(requiredStakePerBlock, accounts[0]);
            });

            it('should eliminate block since the gas limit of the submitted block is out of bounds (too small)', async () => {
                // deposit enough stake
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                await ethrelay.depositStake(requiredStakePerBlock, {
                    from: accounts[0],
                    value: requiredStakePerBlock,
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
                const limit = BigInt(genesisBlock.gasLimit) / GAS_LIMIT_BOUND_DIVISOR;
                const blockWithIllegalGasLimit = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                blockWithIllegalGasLimit.gasLimit = BigInt(genesisBlock.gasLimit) - limit - 1n;
                blockWithIllegalGasLimit.hash = calculateBlockHash(blockWithIllegalGasLimit);

                await submitBlockHeader(blockWithIllegalGasLimit, accounts[0]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(blockWithIllegalGasLimit), createRLPHeader(genesisBlock), [], [], {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[0]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(10)});

                await withdrawStake(requiredStakePerBlock, accounts[0]);
            });

            it('should eliminate block since the gas used of the submitted block is higher than the gas limit', async () => {
                // deposit enough stake
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                await ethrelay.depositStake(requiredStakePerBlock, {
                    from: accounts[0],
                    value: requiredStakePerBlock,
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
                const blockWithIllegalGasUsed = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                blockWithIllegalGasUsed.gasUsed = BigInt(blockWithIllegalGasUsed.gasLimit) + 1n;
                blockWithIllegalGasUsed.hash = calculateBlockHash(blockWithIllegalGasUsed);

                await submitBlockHeader(blockWithIllegalGasUsed, accounts[0]);
                let ret = await ethrelay.disputeBlockWithoutPunishment(createRLPHeader(blockWithIllegalGasUsed), createRLPHeader(genesisBlock), [], [], {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, 'DisputeBlockWithoutPunishment', {submittersOfIllegalBlocks: [accounts[0]]});
                expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(11)});

                await withdrawStake(requiredStakePerBlock, accounts[0]);
            });
        });

        describe('Ethrelay', function () {

            // Test Scenario 1 (verification of Ethash should fail):
            //
            //           X-(2)---(5)---(7)
            //          /
            // (0)---(1)---(3)---(6)
            //          \
            //            -(4)
            //
            it('should correctly execute test scenario 1', async () => {
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                const stakeAccount0 = requiredStakePerBlock.mul(new BN(3));
                const stakeAccount1 = requiredStakePerBlock.mul(new BN(1));
                const stakeAccount2 = requiredStakePerBlock.mul(new BN(2));
                const stakeAccount3 = requiredStakePerBlock.mul(new BN(1));
                await ethrelay.depositStake(stakeAccount0, {
                    from: accounts[0],
                    value: stakeAccount0,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 1,3,6
                await ethrelay.depositStake(stakeAccount1, {
                    from: accounts[1],
                    value: stakeAccount1,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 7
                await ethrelay.depositStake(stakeAccount2, {
                    from: accounts[2],
                    value: stakeAccount2,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 2,5
                await ethrelay.depositStake(stakeAccount3, {
                    from: accounts[3],
                    value: stakeAccount3,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 4

                // Create expected chain
                const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block5 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block6 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block7 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);

                // change nonce such that (1) the PoW validation results in false (prune Branch) and (2) to get different hashes for blocks with the same heigth/number
                block2.nonce = addToHex(block3.nonce, 1);
                block2.hash = calculateBlockHash(block2);

                block5.parentHash = block2.hash;
                block5.hash = calculateBlockHash(block5);

                block7.parentHash = block5.hash;
                block7.hash = calculateBlockHash(block7);

                block4.nonce = addToHex(block4.nonce, 2);
                block4.hash = calculateBlockHash(block4);

                const {
                    "DatasetLookup":    dataSetLookupBlock2,
                    "WitnessForLookup": witnessForLookupBlock2,
                } = require("./pow/genesisPlus2.json");

                // Submit and dispute blocks
                await submitBlockHeader(block1, accounts[0]);
                await submitBlockHeader(block2, accounts[2]);
                await submitBlockHeader(block3, accounts[0]);
                await submitBlockHeader(block4, accounts[3]);
                await submitBlockHeader(block5, accounts[2]);
                await submitBlockHeader(block6, accounts[0]);
                await submitBlockHeader(block7, accounts[1]);

                const stakeAccount0BeforeDispute = await ethrelay.getStake({from: accounts[0]});
                const stakeAccount1BeforeDispute = await ethrelay.getStake({from: accounts[1]});
                const stakeAccount2BeforeDispute = await ethrelay.getStake({from: accounts[2]});
                const stakeAccount3BeforeDispute = await ethrelay.getStake({from: accounts[3]});

                await ethrelay.disputeBlockHeader(createRLPHeader(block2), createRLPHeader(block1), dataSetLookupBlock2, witnessForLookupBlock2, {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const stakeAccount0AfterDispute = await ethrelay.getStake({from: accounts[0]});
                const stakeAccount1AfterDispute = await ethrelay.getStake({from: accounts[1]});
                const stakeAccount2AfterDispute = await ethrelay.getStake({from: accounts[2]});
                const stakeAccount3AfterDispute = await ethrelay.getStake({from: accounts[3]});

                expect(stakeAccount0AfterDispute).to.be.bignumber.equal(stakeAccount0BeforeDispute.add(requiredStakePerBlock.mul(new BN(3))));
                expect(stakeAccount1AfterDispute).to.be.bignumber.equal(stakeAccount1BeforeDispute.sub(requiredStakePerBlock));
                expect(stakeAccount2AfterDispute).to.be.bignumber.equal(stakeAccount2BeforeDispute.sub(requiredStakePerBlock.mul(new BN(2))));
                expect(stakeAccount3AfterDispute).to.be.bignumber.equal(stakeAccount3BeforeDispute);

                // withdraw stake
                await withdrawStake(stakeAccount0AfterDispute, accounts[0]);
                await withdrawStake(stakeAccount1AfterDispute, accounts[1]);
                await withdrawStake(stakeAccount2AfterDispute, accounts[2]);
                await withdrawStake(stakeAccount3AfterDispute, accounts[3]);
            });

            // Test Scenario 2 (verification of Ethash should be successful):
            //
            // (0)---(1)-X-(2)---(3)---(4)      // try to dispute a valid block -> should not prone any header, stakes should not change
            //
            //
            it('should correctly execute test scenario 2', async () => {
                const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
                const stakeAccount0 = requiredStakePerBlock.mul(new BN(2));
                const stakeAccount1 = requiredStakePerBlock.mul(new BN(2));
                await ethrelay.depositStake(stakeAccount0, {
                    from: accounts[0],
                    value: stakeAccount0,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 1,2
                await ethrelay.depositStake(stakeAccount1, {
                    from: accounts[1],
                    value: stakeAccount1,
                    gasPrice: GAS_PRICE_IN_WEI
                });  // submits blocks 3,4

                // Create expected chain
                const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
                const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
                const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
                const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 4);

                const {
                    "DatasetLookup":    dataSetLookupBlock2,
                    "WitnessForLookup": witnessForLookupBlock2,
                } = require("./pow/genesisPlus2.json");

                // Submit and dispute blocks
                await submitBlockHeader(block1, accounts[0]);
                await submitBlockHeader(block2, accounts[0]);
                await submitBlockHeader(block3, accounts[1]);
                await submitBlockHeader(block4, accounts[1]);

                const stakeAccount0BeforeDispute = await ethrelay.getStake({from: accounts[0]});
                const stakeAccount1BeforeDispute = await ethrelay.getStake({from: accounts[1]});

                await ethrelay.disputeBlockHeader(createRLPHeader(block2), createRLPHeader(block1), dataSetLookupBlock2, witnessForLookupBlock2, {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI
                });

                const stakeAccount0AfterDispute = await ethrelay.getStake({from: accounts[0]});
                const stakeAccount1AfterDispute = await ethrelay.getStake({from: accounts[1]});

                // tried to dispute a legal block -> nothing should have been changed
                expect(stakeAccount0AfterDispute).to.be.bignumber.equal(stakeAccount0BeforeDispute);
                expect(stakeAccount1AfterDispute).to.be.bignumber.equal(stakeAccount1BeforeDispute);

                // withdraw stake
                await withdrawStake(stakeAccount0, accounts[0]);
                await withdrawStake(stakeAccount1, accounts[1]);
            });
        });
    });

    const submitBlockHeader = async (header, accountAddr) => {
        const rlpHeader = createRLPHeader(header);
        return await ethrelay.submitBlock(rlpHeader, {from: accountAddr, gasPrice: GAS_PRICE_IN_WEI});
    };

    const submitBlockHeaders = async (expectedHeaders, accountAddr) => {
        await asyncForEach(expectedHeaders, async expected => {
            const rlpHeader = createRLPHeader(expected.block);
            await time.increase(time.duration.seconds(15));
            await ethrelay.submitBlock(rlpHeader, {from: accountAddr, gasPrice: GAS_PRICE_IN_WEI});
            const submitTime = await time.latest();
            expected.lockedUntil = submitTime.add(LOCK_PERIOD);
        });
    };

    const submitBlockBatch = async (expectedHeaders, accountAddr) => {
        const batch = [];
        for (let i = 0; i < expectedHeaders.length; i++) {
            batch.push(createRLPHeader(expectedHeaders[i].block));
        }
        await ethrelay.submitBlockBatch(arrToBufArr(RLP.encode(bufArrToArr(batch))), { from: accountAddr, gasPrice: GAS_PRICE_IN_WEI });

        const submitTime = await time.latest();
        const expectedLockedUntil = submitTime.add(LOCK_PERIOD);
        for (let i = 0; i < expectedHeaders.length; i++) {
            expectedHeaders[i].lockedUntil = expectedLockedUntil;
        }
    };

    const checkExpectedBlockHeaders = async (expectedHeaders) => {
        await asyncForEach(expectedHeaders, async expected => {
            // check header data
            const actualHeader = await ethrelay.getHeader(expected.block.hash);
            assertHeaderEqual(actualHeader, expected.block);

            // check header meta data
            const actualMeta = await ethrelay.getBlockMetaInfo(expected.block.hash);
            assertMetaEqual(actualMeta, expected);
        });
    };

    const checkExpectedZeroBlocks = async (expectedZeroBlocks) => {
        await asyncForEach(expectedZeroBlocks, async expectedZero => {
            const removedBlock = await ethrelay.getHeader(expectedZero.hash);
            expect(removedBlock.blockNumber).to.be.bignumber.equal(new BN(0));
            expect(removedBlock.totalDifficulty).to.be.bignumber.equal(new BN(0));
        });
    };

    // checks if expectedEndpoints array is correct and if longestChainEndpoints contains hash of block with highest difficulty
    const checkExpectedEndpoints = async (expectedEndpoints) => {
        expect(await ethrelay.getNumberOfForks()).to.be.bignumber.equal(new BN(expectedEndpoints.length));

        let expectedLongestChainEndpoint = expectedEndpoints[0];
        await asyncForEach(expectedEndpoints, async (expected, index) => {
            expect(await ethrelay.getEndpoint(index)).to.equal(expected.hash);
            if (expectedLongestChainEndpoint.totalDifficulty < expected.totalDifficulty) {
                expectedLongestChainEndpoint = expected;
            }
        });

        expect(await ethrelay.getLongestChainEndpoint()).to.equal(expectedLongestChainEndpoint.hash);
    };

    const getAccountBalanceInWei = async (accountAddress) => {
        return await balance.current(accountAddress);
    };

    const withdrawStake = async (stake, accountAddr) => {
        const submitTime = await time.latest();
        const increasedTime = submitTime.add(LOCK_PERIOD).add(time.duration.seconds(1));
        await time.increaseTo(increasedTime);  // unlock all blocks
        await ethrelay.withdrawStake(stake, {from: accountAddr, gasPrice: GAS_PRICE_IN_WEI});
    };

    const submitEpochData = async (ethashContractInstance, epoch, fullSizeIn128Resolution, branchDepth, merkleNodes) => {
        let start = new BN(0);
        let nodes = [];
        let mnlen = 0;
        let index = 0;
        for (let mn of merkleNodes) {
            nodes.push(mn);
            if (nodes.length === 40 || index === merkleNodes.length - 1) {
                mnlen = new BN(nodes.length);

                if (index < 440 && epoch === 128) {
                    start = start.add(mnlen);
                    nodes = [];
                    return;
                }

                await ethashContractInstance.setEpochData(epoch, fullSizeIn128Resolution, branchDepth, nodes, start, mnlen);

                start = start.add(mnlen);
                nodes = [];
            }
            index++;
        }
    };
});

function Block(
    hash,
    parent,
    number,
    lockedUntil,
    totalDifficulty,
    forkId,
    iterableIndex,
    latestFork
) {
    this.hash = hash;
    this.parentHash = parent;
    this.number = number;
    this.lockedUntil = lockedUntil;
    this.totalDifficulty = totalDifficulty;
    this.forkId = forkId;
    this.iterableIndex = iterableIndex;
    this.latestFork = latestFork;
}

Block.prototype.toString = function blockToString() {
    return `Block {
    hash: ${this.hash},
    parentHash: ${this.parentHash},
    blockHeight: ${this.number.toString()},
    lockedUntil: ${this.lockedUntil.toString()},
    totalDifficulty: ${this.totalDifficulty.toString()},
    forkId: ${this.forkId.toString()},
    iterableIndex: ${this.iterableIndex.toString()},
    latestFork: ${this.latestFork},
  }`
};

const assertHeaderEqual = (actual, expected) => {
    expect(actual.hash).to.equal(expected.hash);
    expect(actual.blockNumber).to.be.bignumber.equal(new BN(expected.number));
    expect(actual.totalDifficulty).to.be.bignumber.equal(expected.totalDifficulty);
};

const assertMetaEqual = (actual, expected) => {
    expect(actual.latestFork).to.equal(expected.latestFork);
    expect(actual.forkId).to.be.bignumber.equal(new BN(expected.forkId));
    expect(actual.iterableIndex).to.be.bignumber.equal(new BN(expected.iterableIndex));
    expect(actual.lockedUntil).to.be.bignumber.equal(expected.lockedUntil);
    expect(actual.successors).to.deep.equal(expected.successors);
    expect(actual.submitter).to.equal(expected.submitter);
};

const asyncForEach = async (array, callback) => {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
};

const generateVerificationResult = (numberOfSuccessfulInvocations, size) => {
    let array = Array(size);
    array.fill(0, 0, numberOfSuccessfulInvocations);
    array.fill(-1, numberOfSuccessfulInvocations, array.length); // indicates a revert

    return array;
};
