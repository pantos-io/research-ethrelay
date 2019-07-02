pragma solidity ^0.5.10;

import "./RLP.sol";

contract LinkedList {

    using RLP for *;

    struct BlockHeader {
        bytes32 parent;
        bytes32 stateRoot;
        bytes32 transactionsRoot;
        bytes32 receiptsRoot;
        uint blockNumber;
        bytes32 rlpHeaderHashWithoutNonce;   // sha3 hash of the header without nonce and mix fields
        uint nonce;                        // blockNumber, rlpHeaderHashWithoutNonce and nonce are needed for verifying PoW
        uint lockedUntil;
        bool isDisputed;
    }

//    struct BlockHeaderFull {
//        bytes32 parent;
//        bytes32 ommersHash;
//        address beneficiary;
//        bytes32 stateRoot;
//        bytes32 transactionsRoot;
//        bytes32 receiptsRoot;
//        byte[256] logsBloom;
//        uint difficulty;
//        uint blockNumber;
//        uint gasLimit;
//        uint gasUsed;
//        uint timestamp;
//        bytes extraData;
//        bytes32 mixHash;
//        uint nonce;
//    }

    bytes32 public lastConfirmedBlock;
    mapping (bytes32 => BlockHeader) public headers;  // sha3 hash -> Header
    mapping (uint => bytes32[]) public heightToHeaders;     // blockNumber -> Array of Header hashes
    uint constant lockPeriodInMin = 5 minutes;
    uint constant requiredSucceedingBlocks = 3;
    uint lastRemovedBlockHeight = 0;   // TODO: initialize

    constructor () public {

    }

    function addHeader(bytes memory _rlpHeader) public {
        bytes32 blockHash;
        BlockHeader memory header;
        (blockHash, header) = parseBlockHeader(_rlpHeader);
        header.lockedUntil = now + lockPeriodInMin;
        header.isDisputed = false;
        headers[blockHash] = header;
        heightToHeaders[header.blockNumber].push(blockHash);
        lastConfirmedBlock = getLastConfirmedBlock(header.parent);


        for (uint i = lastRemovedBlockHeight + 1; i <= headers[lastConfirmedBlock].blockNumber; i++) {
            removeBlocksAtHeight(headers[lastConfirmedBlock].blockNumber);
        }
        lastRemovedBlockHeight = headers[lastConfirmedBlock].blockNumber;

    }

    function getLastConfirmedBlock(bytes32 currentBlockHash) internal view returns (bytes32) {
        bytes32 newConfirmedBlock = lastConfirmedBlock;
        BlockHeader memory currentBlock = headers[currentBlockHash];
        uint8 count = 0;
        while (currentBlock.nonce != 0 &&  // check if current block exists
               currentBlockHash != lastConfirmedBlock &&   // check if last confirmed block header is reached
               currentBlock.blockNumber > headers[lastConfirmedBlock].blockNumber) {  // check if current block is at height higher than last confirmed block

            if (currentBlock.lockedUntil > now || currentBlock.isDisputed) {
                return lastConfirmedBlock; // either the lock period is not over yet or the validity of the block has been disputed
            }
            if (count == 0 && currentBlock.blockNumber - headers[lastConfirmedBlock].blockNumber <= requiredSucceedingBlocks) {
                return lastConfirmedBlock; // lastConfirmedBlock cannot be updated because there are not enough succeeding blocks
            }

            if (count == requiredSucceedingBlocks) {
                newConfirmedBlock = currentBlockHash;
            }
            currentBlockHash = currentBlock.parent;
            count++;
        }
        return newConfirmedBlock;
    }

    function removeBlocksAtHeight(uint blockHeight) private {
        if (heightToHeaders[blockHeight].length == 0) {
            return;
        }

        for (uint i; i<heightToHeaders[blockHeight].length; i++) {
            if (heightToHeaders[blockHeight][i] == lastConfirmedBlock) {
                continue;
            }
            delete headers[heightToHeaders[blockHeight][i]];
        }
        delete heightToHeaders[blockHeight];
    }

    function checkValidHeader(BlockHeader memory header) private view {
        require(headers[header.parent].nonce != 0, "Non-existent parent");
        // todo: check block number increment
        // todo: check difficulty
        // todo: check gas limit
        // todo: check timestamp
    }

    event ParseBlockHeader( bytes32 hash, bytes32 hashWithoutNonce, uint nonce, bytes32 parent );
    function parseBlockHeader( bytes memory rlpHeader ) internal returns(bytes32, BlockHeader memory) {
        BlockHeader memory header;

        RLP.Iterator memory it = rlpHeader.toRLPItem().iterator();
        uint idx;
        while(it.hasNext()) {
            if( idx == 0 ) header.parent = it.next().toBytes32();
            else if ( idx == 3 ) header.stateRoot = it.next().toBytes32();
            else if ( idx == 4 ) header.transactionsRoot = it.next().toBytes32();
            else if ( idx == 5 ) header.receiptsRoot = it.next().toBytes32();
//            else if ( idx == 7 ) header.difficulty = it.next().toUint();
//            else if ( idx == 8 ) header.blockNumber = it.next().toUint();
//            else if ( idx == 9 ) header.gasLimit = it.next().toUint();
//            else if ( idx == 11 ) header.timestamp = it.next().toUint();
            else if ( idx == 14 ) header.nonce = it.next().toUint();
            else it.next();

            idx++;
        }

        // duplicate rlp header and truncate nonce and mixDataHash
        bytes32 blockHash = keccak256(rlpHeader);
        bytes memory rlpWithoutNonce = copy(rlpHeader, rlpHeader.length-42);  // 42: length of none+mixHash
        uint16 rlpHeaderWithoutNonceLength = uint16(rlpHeader.length-3-42);  // rlpHeaderLength - 3 prefix bytes (0xf9 + length) - length of nonce and mixHash
        bytes2 headerLengthBytes = bytes2(rlpHeaderWithoutNonceLength);
        rlpWithoutNonce[1] = headerLengthBytes[0];
        rlpWithoutNonce[2] = headerLengthBytes[1];
        bytes32 rlpHeaderHashWithoutNonce = keccak256(rlpWithoutNonce);
        emit ParseBlockHeader(blockHash, rlpHeaderHashWithoutNonce, header.nonce, header.parent);

        header.rlpHeaderHashWithoutNonce = rlpHeaderHashWithoutNonce;
        // TODO: check header validity (block number, timestamp, difficulty)

        return (blockHash, header);

    }

    function copy(bytes memory sourceArray, uint newLength) internal pure returns (bytes memory) {
        uint newArraySize = newLength;
        if (newArraySize > sourceArray.length) {
            newArraySize = sourceArray.length;
        }

        bytes memory newArray = new bytes(newArraySize);
        for(uint i = 0; i < newArraySize; i++){
            newArray[i] = sourceArray[i];
        }

        return newArray;
    }
}