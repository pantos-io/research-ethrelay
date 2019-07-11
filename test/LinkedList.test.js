const Web3 = require("web3");
const RLP = require('rlp');

const LinkedList = artifacts.require('./LinkedList');
const BN = web3.utils.BN;

const genesisRLP = '0xf90217a0f325431224239d833b7d870b4d6d7fd2e6ab4b80857022daa012a9a08277e09fa01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d493479406b8c5883ec71bc3f4b332081519f23834c8706ea00ceb1811de623435b9e6e35e75b2faa0e732d364b2a3781bc6e9d6b5212b860ba056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b90100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008707896d68b38322837b5c1d837a120080845d1ddeaa99d883010817846765746888676f312e31302e34856c696e7578a04db51f8d4a4200dbdcbf0bd0c7bd8c104dfcfa61fb5ba7ef767183f86b1d57d588c23b0a7000b8c2c7';

// const {assertRevert} = require('openzeppelin-solidity/test/helpers/assertRevert');

contract('LinkedList', async (accounts) => {

    let testimonium;
    let sourceWeb3;

    before(async () => {
        sourceWeb3 = new Web3("https://mainnet.infura.io");
    });

    beforeEach(async () => {
        testimonium = await LinkedList.new(web3.utils.hexToBytes(genesisRLP));
    });


    it("should initialise correctly", async () => {
        const noOfForks = await testimonium.getNoOfForks();
        const blockHash = await testimonium.getBlockHashOfEndpoint(0);
        const actualGenesis = toBlock(blockHash, await testimonium.getBlock(blockHash));
        const expectedGenesis = await sourceWeb3.eth.getBlock(8084509);

        expectedGenesis.totalDifficulty = expectedGenesis.difficulty;   // our 'genesis' block's total difficulty will just be its difficulty
        console.log('Genesis Block:', blockHash.valueOf());
        assertBlocksEqual(actualGenesis, expectedGenesis);
        assert.equal(noOfForks.valueOf(), 1, "The contract should have one fork initially");
        assert.equal(actualGenesis.latestFork, '0x0000000000000000000000000000000000000000000000000000000000000000', "The contract should not have a latest fork set initially");
        assert.equal(actualGenesis.orderedIndex, 0, 'Index in orderedEndpoints array should be 0');
        assert.equal(actualGenesis.iterableIndex, 0, 'Index in iterableIndex array should be 0');
    });

    it('should add a block header correctly on top of the genesis block', async () => {
        const noOfForks = await testimonium.getNoOfForks();
        const expected = await sourceWeb3.eth.getBlock(8084510);
        const rlpHeader = createRLPHeader(expected);
        await testimonium.submitHeader(rlpHeader);
        const blockHash = await testimonium.getBlockHashOfEndpoint(0);
        const actual = toBlock(blockHash, await testimonium.getBlock(blockHash));

        assertBlocksEqual(actual, expected);
        assert.equal(noOfForks.valueOf(), 1, "The contract should still only have one fork");
        assert.equal(actual.latestFork, '0x0000000000000000000000000000000000000000000000000000000000000000', "The contract should not have a latest fork set initially");
        assert.equal(actual.orderedIndex, 0, 'Index in orderedEndpoints array should be 0');
        assert.equal(actual.iterableIndex, 0, 'Index in iterableIndex array should be 0');
    });

    it('should create a fork correctly', async () => {
        const branch0 = await sourceWeb3.eth.getBlock(8084510);
        const branch1 = await sourceWeb3.eth.getBlock(8084510);

        // change data of branch 1
        branch1.transactionsRoot = branch0.receiptsRoot;
        branch1.stateRoot = branch0.transactionsRoot;
        branch1.receiptsRoot = branch0.stateRoot;
        branch1.hash = web3.utils.keccak256(createRLPHeader(branch1));  // IMPORTANT: recalculate block hash otherwise asserts fails

        // submit both headers
        const rlpHeader0 = createRLPHeader(branch0);
        const rlpHeader1 = createRLPHeader(branch1);
        await testimonium.submitHeader(rlpHeader0);
        await testimonium.submitHeader(rlpHeader1);

        const noOfForks = await testimonium.getNoOfForks();
        assert.equal(noOfForks.valueOf(), 2, "The contract should have two forks");

        const blockHash0 = await testimonium.getBlockHashOfEndpoint(0);
        const blockHash1 = await testimonium.getBlockHashOfEndpoint(1);
        const actual0 = toBlock(blockHash0, await testimonium.getBlock(blockHash0));
        const actual1 = toBlock(blockHash1, await testimonium.getBlock(blockHash1));

        // check first branch
        assertBlocksEqual(actual0, branch0);
        assert.equal(actual0.latestFork, actual0.parentHash, "The parent has become the latest fork");
        assert.equal(actual0.orderedIndex, 0, 'Index in orderedEndpoints array should be 0');
        assert.equal(actual0.iterableIndex, 0, 'Index in iterableIndex array should be 0');

        // check second branch
        assertBlocksEqual(actual1, branch1);
        assert.equal(actual1.latestFork, actual1.parentHash, "The parent has become the latest fork");
        assert.equal(actual1.orderedIndex, 1, 'Index in orderedEndpoints array should be 1');
        assert.equal(actual1.iterableIndex, 1, 'Index in iterableIndex array should be 1');
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
    assert.equal(actual.hash, expected.hash, 'Block hashes are different');
    assert.equal(actual.parent, expected.parent, 'Parent hashes are different');
    assert.equal(actual.number, expected.number, 'Block numbers are different');
    // todo: maybe parse also total difficulty in Testimonium contract, so we don't have to it calculate manually
    // assert.equal(actual.totalDifficulty, expected.totalDifficulty, 'Total difficulties are different');
};

const createRLPHeader = (block) => {
    return RLP.encode([
        block.parentHash,
        block.sha3Uncles,
        block.miner,
        block.stateRoot,
        block.transactionsRoot,
        block.receiptsRoot,
        block.logsBloom,
        new BN(block.difficulty),
        new BN(block.number),
        block.gasLimit,
        block.gasUsed,
        block.timestamp,
        block.extraData,
        block.mixHash,
        block.nonce,
    ]);
};


