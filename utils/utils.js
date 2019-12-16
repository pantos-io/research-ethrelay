const RLP = require('rlp');
const Web3 = require('web3');
const web3 = new Web3(Web3.givenProvider || 'https://mainnet.infura.io', null, {});
const BN = web3.utils.BN;
const BigNumber = require('bignumber.js');

const calculateBlockHash = (block) => {
    return web3.utils.keccak256(createRLPHeader(block));
};

const addToHex = (hexString, number) => {
  return web3.utils.toHex((new BigNumber(hexString).plus(number)));
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
const createRLPHeaderWithoutNonce = (block) => {
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
    ]);
};

const asyncForEach = async (array, callback) => {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
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

            await ethashContractInstance.setEpochData(epoch, fullSizeIn128Resolution, branchDepth, convertEachElemToBN(nodes), start, mnlen);

            start = start.add(mnlen);
            nodes = [];
        }
        index++;
    }
};

const submitBlockHeader = async (testimoniumContractInstance, header, from, gasPrice) => {
    const rlpHeader = createRLPHeader(header);
    return await testimoniumContractInstance.submitBlock(rlpHeader, {from, gasPrice});
};

// This is a workaround for a bug discussed at https://github.com/ethereum/web3.js/issues/2077#issuecomment-482932690
const convertEachElemToBN = (strNumArray) => {
    let resultingArray = new Array(strNumArray.length);
    strNumArray.forEach((elem, index) => {
        resultingArray[index] = new BN(elem);
    });

    return resultingArray;
};

module.exports = {
    calculateBlockHash,
    createRLPHeader,
    createRLPHeaderWithoutNonce,
    addToHex,
    asyncForEach,
    submitEpochData,
    submitBlockHeader,
    convertEachElemToBN
};
