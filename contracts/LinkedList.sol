pragma solidity ^0.5.10;

import "./RLP.sol";

contract LinkedList {

    using RLP for *;

    struct BlockHeaderLight {
        bytes32 parent;
        bytes32 stateRoot;
        bytes32 transactionsRoot;
        bytes32 receiptsRoot;
        uint blockNumber;
        bytes32 rlpHeaderHashWithoutNonce;   // sha3 hash of the header without nonce and mix fields
        bytes8 nonce;                        // blockNumber, rlpHeaderHashWithoutNonce and nonce are needed for verifying PoW
        uint timestamp;
    }

    struct BlockHeaderFull {
        bytes32 parent;
        bytes32 ommersHash;
        address beneficiary;
        bytes32 stateRoot;
        bytes32 transactionsRoot;
        bytes32 receiptsRoot;
        byte[256] logsBloom;
        uint difficulty;
        uint blockNumber;
        uint gasLimit;
        uint gasUsed;
        uint timestamp;
        bytes extraData;
        bytes32 mixHash;
        uint nonce;
    }

    bytes32 public head;
    mapping (bytes32 => BlockHeaderLight) public headers;  // sha3 hash -> Header
    mapping (uint => bytes32[]) public heightToHeaders;     // blockNumber -> Array of Header hashes

    constructor () public {

    }

    function addHeader(bytes memory _rlpHeader) public {
        BlockHeaderFull memory header = parseBlockHeader(_rlpHeader);
//        checkValidHeader(header);
//        headers[header.]
    }

    function checkValidHeader(BlockHeaderLight memory header) private view {
        require(headers[header.parent].nonce != 0, "Non-existent parent");
        // todo: check block number increment
        // todo: check difficulty
        // todo: check gas limit
        // todo: check timestamp
    }

    event ParseBlockHeader( bytes32 hash, bytes32 hashWithoutNonce, uint nonce, bytes32 parent );
    function parseBlockHeader( bytes memory rlpHeader ) internal returns(BlockHeaderFull memory) {
        BlockHeaderFull memory header;

        RLP.Iterator memory it = rlpHeader.toRLPItem().iterator();
        uint idx;
        while(it.hasNext()) {
            if( idx == 0 ) header.parent = it.next().toBytes32();
            else if ( idx == 3 ) header.stateRoot = it.next().toBytes32();
            else if ( idx == 4 ) header.transactionsRoot = it.next().toBytes32();
            else if ( idx == 5 ) header.receiptsRoot = it.next().toBytes32();
            else if ( idx == 7 ) header.difficulty = it.next().toUint();
            else if ( idx == 8 ) header.blockNumber = it.next().toUint();
            else if ( idx == 9 ) header.gasLimit = it.next().toUint();
            else if ( idx == 11 ) header.timestamp = it.next().toUint();
            else if ( idx == 14 ) header.nonce = it.next().toUint();
            else it.next();

            idx++;
        }

        bytes32 blockHash = keccak256(rlpHeader);
        bytes memory rlpWithoutNonce = copy(rlpHeader, rlpHeader.length-42);
        rlpWithoutNonce[1] = toByte(1);
        rlpWithoutNonce[2] = toByte(217);
        bytes32 rlpHeaderHashWithoutNonce = keccak256(rlpWithoutNonce);
        emit ParseBlockHeader(blockHash, rlpHeaderHashWithoutNonce, header.nonce, header.parent);

        return header;
    }

    function toByte(uint8 _num) internal pure returns (byte _ret) {
        return byte(_num);
    }

    function copy(bytes memory sourceArray, uint newLength) internal pure returns (bytes memory){
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
