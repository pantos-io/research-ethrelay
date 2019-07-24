const Web3 = require("web3");
const { BN, balance, ether, expectRevert, time } = require('openzeppelin-test-helpers');
const { createRLPHeader, calculateBlockHash, createRLPHeaderWithoutNonce } = require('../utils/utils');

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
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: ZERO_BLOCK,
                lockedUntil: initTime,
                successors: []
            }
        ];

        const expectedEndpoints = [ expectedGenesis ];

        await checkExpectedEndpoints(expectedEndpoints);
        await checkExpectedBlockHeaders(expectedBlocks);
    });

    // Test Scenario 2:
    //
    // (0)---(1)
    //
    it('should correctly execute test scenario 2', async () => {
        const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
        const expectedBlocks = [
            {
                block: block1,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: ZERO_BLOCK,
                successors: []
            }
        ];
        const expectedEndpoints = [ block1 ];

        await submitBlockHeaders(expectedBlocks);

        await checkExpectedEndpoints(expectedEndpoints);
        await checkExpectedBlockHeaders(expectedBlocks);
    });

    // Test Scenario 3:
    //
    // (0)---(1)---(2)
    //
    it('should correctly execute test scenario 3', async () => {
        // Create expected chain
        const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
        const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
        const expectedBlocks = [
            {
                block: block1,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: ZERO_BLOCK,
                successors: [block2.hash]
            },
            {
                block: block2,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: ZERO_BLOCK,
                successors: []
            }
        ];
        const expectedEndpoints = [ block2 ];

        await submitBlockHeaders(expectedBlocks);

        // Perform checks
        await checkExpectedEndpoints(expectedEndpoints);
        await checkExpectedBlockHeaders(expectedBlocks);
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
                latestFork: block1.parentHash,
                successors: []
            },
            {
                block: block2,
                orderedIndex: 1,
                iterableIndex: 1,
                latestFork: block2.parentHash,
                successors: []
            }
        ];
        const expectedEndpoints = [ block1, block2 ];
        await submitBlockHeaders(expectedBlocks);

        // Perform checks
        await checkExpectedEndpoints(expectedEndpoints);
        await checkExpectedBlockHeaders(expectedBlocks);
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
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: block1.parentHash,
                successors: [block2.hash]
            },
            {
                block: block2,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: block1.parentHash,
                successors: []
            },
            {
                block: block3,
                orderedIndex: 1,
                iterableIndex: 1,
                latestFork: block3.parentHash,
                successors: []
            }
        ];
        const expectedEndpoints = [ block2, block3 ];
        await submitBlockHeaders(expectedBlocks);

        // Perform checks
        await checkExpectedEndpoints(expectedEndpoints);
        await checkExpectedBlockHeaders(expectedBlocks);
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
                latestFork: block1.parentHash,
                successors: []
            },
            {
                block: block2,
                orderedIndex: 1,
                iterableIndex: 1,
                latestFork: block2.parentHash,
                successors: []
            },
            {
                block: block3,
                orderedIndex: 2,
                iterableIndex: 2,
                latestFork: block3.parentHash,
                successors: []
            }
        ];
        const expectedEndpoints = [ block1, block2, block3 ];

        await submitBlockHeaders(expectedBlocks);

        // Perform checks
        await checkExpectedEndpoints(expectedEndpoints);
        await checkExpectedBlockHeaders(expectedBlocks);
    });

    // Test Scenario 7:
    //
    //      -(1)---(2)---(3)
    //    /
    // (0)
    //    \
    //      -(4)
    //
    it('should correctly execute test scenario 7', async () => {
        const block1 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);
        const block2 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 2);
        const block3 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 3);
        const block4 = await sourceWeb3.eth.getBlock(GENESIS_BLOCK + 1);

        // change data of block 4
        block4.transactionsRoot = block1.receiptsRoot;
        block4.stateRoot = block1.transactionsRoot;
        block4.receiptsRoot = block1.stateRoot;
        block4.hash = calculateBlockHash(block4);  // IMPORTANT: recalculate block hash otherwise asserts fails

        const expectedBlocks = [
            {
                block: block1,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: block1.parentHash,
                successors: [block2.hash]
            },
            {
                block: block2,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: block1.parentHash,
                successors: [block3.hash]
            },
            {
                block: block3,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: block1.parentHash,
                successors: []
            },
            {
                block: block4,
                orderedIndex: 1,
                iterableIndex: 1,
                latestFork: block4.parentHash,
                successors: []
            }
        ];
        const expectedEndpoints = [ block3, block4 ];
        await submitBlockHeaders(expectedBlocks);

        // Perform checks
        await checkExpectedEndpoints(expectedEndpoints);
        await checkExpectedBlockHeaders(expectedBlocks);
    });

    // Test Scenario 8:
    //
    //                  -(5)---(7)
    //                /
    // (0)---(1)---(2)---(3)---(4)
    //                      \
    //                        -(6)
    //
    it.only('should correctly execute test scenario 8', async () => {
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
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: ZERO_BLOCK,
                successors: [block2.hash]
            },
            {
                block: block2,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: ZERO_BLOCK,
                successors: [block3.hash, block5.hash]
            },
            {
                block: block3,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: block2.hash,
                successors: [block4.hash, block6.hash]
            },
            {
                block: block4,
                orderedIndex: 0,
                iterableIndex: 0,
                latestFork: block3.hash,
                successors: []
            },
            {
                block: block5,
                orderedIndex: 1,
                iterableIndex: 0,
                latestFork: block2.hash,
                successors: [block7.hash]
            },
            {
                block: block6,
                orderedIndex: 2,
                iterableIndex: 2,
                latestFork: block3.hash,
                successors: []
            },
            {
                block: block7,
                orderedIndex: 1,
                iterableIndex: 1,
                latestFork: block2.hash,
                successors: []
            }
        ];
        const expectedEndpoints = [ block4, block7, block6 ];
        await submitBlockHeaders(expectedBlocks);

        // Perform checks
        await checkExpectedEndpoints(expectedEndpoints);
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
                latestFork: ZERO_BLOCK,
                successors: []
            }
        ];
        await submitBlockHeaders(expectedBlocks);
        expect(await testimonium.isUnlocked(block1.hash)).to.equal(false);  // block is locked right after submission
        await time.increaseTo(expectedBlocks[0].lockedUntil-1);
        expect(await testimonium.isUnlocked(block1.hash)).to.equal(false);  // block is locked for duration of lock period
        await time.increase(time.duration.seconds(2));
        expect(await testimonium.isUnlocked(block1.hash)).to.equal(true);   // block is unlocked right after lock period has passed
    });

    const submitBlockHeaders = async (expectedHeaders) => {
        await asyncForEach(expectedHeaders, async expected => {
            const rlpHeader = createRLPHeader(expected.block);
            await time.increase(time.duration.seconds(15));
            await testimonium.submitHeader(rlpHeader);
            const submitTime = await time.latest();
            expected.lockedUntil = submitTime.add(LOCK_PERIOD);
        });
    };

    const checkExpectedBlockHeaders = async (expectedHeaders) => {
        await asyncForEach(expectedHeaders, async expected => {
            const actual = await testimonium.headers(web3.utils.hexToBytes(expected.block.hash));
            const successors = await testimonium.getSuccessors(web3.utils.hexToBytes(expected.block.hash));  // successors are not returned in first call
            actual.successors = successors;
            assertBlocksEqual(actual, expected.block);
            expect(actual.latestFork).to.equal(expected.latestFork);
            expect(actual.orderedIndex).to.be.bignumber.equal(new BN(expected.orderedIndex));
            expect(actual.iterableIndex).to.be.bignumber.equal(new BN(expected.iterableIndex));
            expect(actual.lockedUntil).to.be.bignumber.equal(expected.lockedUntil);
            expect(actual.successors).to.deep.equal(expected.successors);
        });
    };

    // checks if expectedEndpoints array is correct and if longestChainEndpoints contains hash of block with highest difficulty
    const checkExpectedEndpoints = async (expectedEndpoints) => {
        expect(await testimonium.getNoOfForks()).to.be.bignumber.equal(new BN(expectedEndpoints.length));

        let expectedLongestChainEndpoint = expectedEndpoints[0];
        await expectedEndpoints.forEach(async (expected, index) => {
            expect(await testimonium.getBlockHashOfEndpoint(index)).to.equal(expected.hash);
            if (expectedLongestChainEndpoint.totalDifficulty < expected.totalDifficulty) {
                expectedLongestChainEndpoint = expected;
            }
        });

        expect(await testimonium.longestChainEndpoint()).to.equal(expectedLongestChainEndpoint.hash);

    }
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

const assertBlocksEqual = (actual, expected) => {
    expect(actual.parent).to.equal(expected.parentHash);
    expect(actual.blockNumber).to.be.bignumber.equal(new BN(expected.number));
    expect(actual.totalDifficulty).to.be.bignumber.equal(expected.totalDifficulty);
    expect(actual.stateRoot).to.equal(expected.stateRoot);
    expect(actual.transactionsRoot).to.equal(expected.transactionsRoot);
    expect(actual.receiptsRoot).to.equal(expected.receiptsRoot);
    expect(actual.nonce).to.be.bignumber.equal(web3.utils.toBN(expected.nonce));
    expect(actual.rlpHeaderHashWithoutNonce).to.equal(web3.utils.keccak256(createRLPHeaderWithoutNonce(expected)));
};

async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}


