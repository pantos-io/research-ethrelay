const Web3 = require("web3");
const { BN, balance, ether, expectRevert, time } = require('openzeppelin-test-helpers');
const { createRLPHeader, calculateBlockHash } = require('../utils/utils');

const Testimonium = artifacts.require('./Testimonium');
const { expect } = require('chai');

const GENESIS_BLOCK = 8084509;
const ZERO_BLOCK = '0x0000000000000000000000000000000000000000000000000000000000000000';
const LOCK_PERIOD = time.duration.minutes(5);


contract('Testimonium', async (accounts) => {

    let testimonium;
    let sourceWeb3;

    before(async () => {
        sourceWeb3 = new Web3("https://mainnet.infura.io");
        // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
        await time.advanceBlock();
    });

    beforeEach(async () => {
        const genesisBlock = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
        testimonium = await Testimonium.new(createRLPHeader(genesisBlock), genesisBlock.totalDifficulty);
    });


    it("should initialise correctly", async () => {
        const initTime = await time.latest();
        const expectedGenesis = await sourceWeb3.eth.getBlock(GENESIS_BLOCK);
        const expectedBlocks = [
            {
                block: expectedGenesis,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: ZERO_BLOCK,
                lockedUntil: initTime
            }
        ];

        expect(await testimonium.getNoOfForks()).to.be.bignumber.equal(new BN(1));
        expect(await testimonium.getBlockHashOfEndpoint(0)).to.equal(expectedGenesis.hash);
        await checkExpectedBlockHeaders(expectedBlocks);
    });

    // Test Scenario:
    //
    // (0)---(1)
    //
    it('should add a block header correctly on top of the genesis block', async () => {
        const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
        const expectedBlocks = [
            {
                block: block1,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: ZERO_BLOCK
            }
        ];
        await submitExpectedBlockHeaders(expectedBlocks);

        expect(await testimonium.getNoOfForks()).to.be.bignumber.equal(new BN(1));
        expect(await testimonium.getBlockHashOfEndpoint(0)).to.equal(block1.hash);
        await checkExpectedBlockHeaders(expectedBlocks);
    });

    // Test Scenario:
    //
    // (0)---(1)---(2)
    //
    it('should add two block headers correctly on top of the genesis block', async () => {
        // Create expected chain
        const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
        const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
        const expectedBlocks = [
            {
                block: block1,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: ZERO_BLOCK
            },
            {
                block: block2,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: ZERO_BLOCK
            }
        ];
        await submitExpectedBlockHeaders(expectedBlocks);

        // Perform checks
        expect(await testimonium.getNoOfForks()).to.be.bignumber.equal(new BN(1));
        expect(await testimonium.getBlockHashOfEndpoint(0)).to.equal(block2.hash);
        await checkExpectedBlockHeaders(expectedBlocks);
    });

    // Test Scenario:
    //
    //      -(1)
    //    /
    // (0)
    //    \
    //      -(2)
    //
    it('should create a fork correctly', async () => {
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
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: block1.parentHash
            },
            {
                block: block2,
                orderedIndex: 1,
                iterableIndex: 1,
                latestFork: block2.parentHash
            }
        ];
        await submitExpectedBlockHeaders(expectedBlocks);

        // Perform checks
        expect(await testimonium.getNoOfForks()).to.be.bignumber.equal(new BN(2));
        expect(await testimonium.getBlockHashOfEndpoint(0)).to.equal(block1.hash);
        expect(await testimonium.getBlockHashOfEndpoint(1)).to.equal(block2.hash);
        await checkExpectedBlockHeaders(expectedBlocks);
    });

    // Test Scenario:
    //
    //      -(1)
    //    /
    // (0)---(2)
    //    \
    //      -(3)
    //
    it('should create a three-fork correctly', async () => {
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
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: block1.parentHash
            },
            {
                block: block2,
                orderedIndex: 1,
                iterableIndex: 1,
                latestFork: block2.parentHash
            },
            {
                block: block3,
                orderedIndex: 2,
                iterableIndex: 2,
                latestFork: block3.parentHash
            }
        ];
        await submitExpectedBlockHeaders(expectedBlocks);

        // Perform checks
        expect(await testimonium.getNoOfForks()).to.be.bignumber.equal(new BN(3));
        expect(await testimonium.getBlockHashOfEndpoint(0)).to.equal(block1.hash);
        expect(await testimonium.getBlockHashOfEndpoint(1)).to.equal(block2.hash);
        expect(await testimonium.getBlockHashOfEndpoint(2)).to.equal(block3.hash);
        await checkExpectedBlockHeaders(expectedBlocks);
    });

    it('should revert when the parent of a submitted block header does not exist', async () => {
        const blockWithNonExistentParent = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
        const rlpHeader = createRLPHeader(blockWithNonExistentParent);
        await expectRevert(testimonium.submitHeader(rlpHeader), 'Non-existent parent');
    });

    // Test Scenario:
    //
    // (0)---(1)
    //
    it('should unlock a block at the correct time', async () => {
        const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
        const expectedBlocks = [
            {
                block: block1,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: ZERO_BLOCK
            }
        ];
        await submitExpectedBlockHeaders(expectedBlocks);
        expect(await testimonium.isUnlocked(block1.hash)).to.equal(false);  // block is locked right after submission
        await time.increase(LOCK_PERIOD);
        expect(await testimonium.isUnlocked(block1.hash)).to.equal(false);  // block is locked for duration of lock period
        await time.increase(time.duration.seconds(1));
        expect(await testimonium.isUnlocked(block1.hash)).to.equal(true);   // block is unlocked right after lock period has passed
    });

    const submitExpectedBlockHeaders = async (expectedHeaders) => {
        await asyncForEach(expectedHeaders, async expected => {
            const rlpHeader = createRLPHeader(expected.block);
            await time.increase(time.duration.seconds(15));
            await testimonium.submitHeader(rlpHeader);
            const submitTime = await time.latest();
            expected.lockedUntil = submitTime.add(LOCK_PERIOD);
        });
    };

    const checkExpectedBlockHeaders = async (expectedHeaders) => {
        await expectedHeaders.forEach(async expected => {
            const actual = toBlock(expected.block.hash, await testimonium.getBlock(web3.utils.hexToBytes(expected.block.hash)));
            assertBlocksEqual(actual, expected.block);
            expect(actual.latestFork).to.equal(expected.latestFork);
            expect(actual.orderedIndex).to.be.bignumber.equal(new BN(expected.orderedIndex));
            expect(actual.iterableIndex).to.be.bignumber.equal(new BN(expected.iterableIndex));
            expect(actual.lockedUntil).to.be.bignumber.equal(expected.lockedUntil);
        });
    };

});


function Block(
    hash,
    parent,
    number,
    lockedUntil,
    totalDifficulty,
    orderedIndex,
    iterableIndex,
    latestFork
) {
    this.hash = hash;
    this.parentHash = parent;
    this.number = number;
    this.lockedUntil = lockedUntil;
    this.totalDifficulty = totalDifficulty;
    this.orderedIndex = orderedIndex;
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
    orderedIndex: ${this.orderedIndex.toString()},
    iterableIndex: ${this.iterableIndex.toString()},
    latestFork: ${this.latestFork},
  }`
};

const toBlock = (hash, result) => {
    return new Block(hash, result[0], result[1], result[2], result[3], result[4], result[5], result[6]);
};

const assertBlocksEqual = (actual, expected) => {
    expect(actual.hash).to.equal(expected.hash);
    expect(actual.parent).to.equal(expected.parent);
    expect(actual.number).to.be.bignumber.equal(new BN(expected.number));
    expect(actual.totalDifficulty).to.be.bignumber.equal(expected.totalDifficulty);
    // todo: maybe parse also total difficulty in Testimonium contract, so we don't have to it calculate manually
    // assert.equal(actual.totalDifficulty, expected.totalDifficulty, 'Total difficulties are different');
};

async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}


