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
        block.baseFeePerGas,
    ]);
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
