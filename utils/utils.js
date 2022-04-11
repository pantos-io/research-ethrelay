const RLP = require('rlp');
const Web3 = require('web3');
const BigNumber = require('bignumber.js');
const { arrToBufArr } = require('ethereumjs-util');

const calculateBlockHash = (block) => {
    return Web3.utils.keccak256(createRLPHeader(block));
};

const addToHex = (hexString, number) => {
  return web3.utils.toHex((new BigNumber(hexString).plus(number)));
};

const createRLPHeader = (block) => {
    return arrToBufArr(RLP.encode([
        block.parentHash,
        block.sha3Uncles,
        block.miner,
        block.stateRoot,
        block.transactionsRoot,
        block.receiptsRoot,
        block.logsBloom,
        BigInt(block.difficulty),
        BigInt(block.number),
        block.gasLimit,
        block.gasUsed,
        block.timestamp,
        block.extraData,
        block.mixHash,
        block.nonce,
        block.baseFeePerGas,
    ]));
};

const createRLPTransaction = (transaction) => {
    return RLP.encode([
        transaction.nonce,
        Number(transaction.gasPrice),
        transaction.gas,
        transaction.to,
        Number(transaction.value),
        transaction.input,
        transaction.v,
        transaction.r,
        transaction.s,
    ]);
};

module.exports = {
    calculateBlockHash,
    createRLPHeader,
    addToHex,
    createRLPTransaction,
};
