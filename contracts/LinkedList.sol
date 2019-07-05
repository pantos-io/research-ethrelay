pragma solidity ^0.5.10;

import "./RLP.sol";

contract LinkedList {

    using RLP for *;

    struct BlockHeader {
        bytes32 parent;
        bytes32[] successors;    // in case of forks a blockchain can have multiple successors
        bytes32 stateRoot;
        bytes32 transactionsRoot;
        bytes32 receiptsRoot;
        uint blockNumber;
        bytes32 rlpHeaderHashWithoutNonce;   // sha3 hash of the header without nonce and mix fields
        uint nonce;                        // blockNumber, rlpHeaderHashWithoutNonce and nonce are needed for verifying PoW
        uint lockedUntil;
        uint totalDifficulty;
        uint index;     // index at which the block header is/was stored in the endpoints mapping
        bytes32 latestFork;  // contains the hash of the latest node where the current fork branched off
    }

    bytes32 public lastConfirmedBlock;
    mapping (bytes32 => BlockHeader) public headers;  // sha3 hash -> Header
    uint constant lockPeriodInMin = 5 minutes;
    uint constant requiredSucceedingBlocks = 3;
    bytes32[] endpoints;   // contains the hash of each fork's recent block

    constructor (bytes memory _rlpHeader) public {  // initialized with block 8084509
        // TODO: maybe add newBlockHash as latestFork
        bytes32 newBlockHash;
        BlockHeader memory newHeader;
        (newBlockHash, newHeader) = parseAndValidateBlockHeader(_rlpHeader);  // block is also validated by this function
        newHeader.index = endpoints.push(newBlockHash) - 1;
        headers[newBlockHash] = newHeader;
    }

    function submitHeader(bytes memory _rlpHeader) public {
        bytes32 newBlockHash;
        BlockHeader memory newHeader;
        (newBlockHash, newHeader) = parseAndValidateBlockHeader(_rlpHeader);  // block is also validated by this function

        // Get parent header and set next pointer to newHeader
        BlockHeader storage parentHeader = headers[newHeader.parent];
        parentHeader.successors.push(newBlockHash);

        newHeader.lockedUntil = now + lockPeriodInMin;
        headers[newBlockHash] = newHeader;

        // check if parent is an endpoint
        if (endpoints[parentHeader.index] == newHeader.parent) {
            // parentHeader is an endpoint (and no fork) -> replace parentHeader in endpoints by new header (since new header becomes new endpoint)
            endpoints[parentHeader.index] = newBlockHash;
            newHeader.index = parentHeader.index;
            newHeader.latestFork = parentHeader.latestFork;
        }
        else {
            // parentHeader is forked
            newHeader.index = endpoints.push(newBlockHash) - 1;
            newHeader.latestFork = newHeader.parent;

            if (parentHeader.successors.length == 2) {
                // a new fork was created, so we set the latest fork of the original branch to the newly created fork
                // this has to be done only the first time a fork is created
                setLatestForkAtSuccessors(headers[parentHeader.successors[0]], newHeader.parent);
            }
        }

    }

    function setLatestForkAtSuccessors(BlockHeader storage header, bytes32 latestFork) private {
        if (header.latestFork == latestFork) {
            // latest fork has already been set
            return;
        }

        header.latestFork = latestFork;

        if (header.successors.length == 1) {
            setLatestForkAtSuccessors(headers[header.successors[0]], latestFork);
        }
    }

    function removeBranch(bytes32 root) public {
        bytes32 parent = headers[root].parent;
        BlockHeader storage parentHeader = headers[parent];
        if (parentHeader.successors.length == 1) {
            // parentHeader has only one successor --> parentHeader will be an endpoint after pruning
            endpoints[parentHeader.index] = parent;
        }

        // remove root (which will be pruned) from the parent's successor list
        for (uint i=0; i<parentHeader.successors.length; i++) {
            if (parentHeader.successors[i] == root) {
                // overwrite root with last successor and delete last successor
                parentHeader.successors[i] = parentHeader.successors[parentHeader.successors.length - 1];
                parentHeader.successors.length--;
                break;  // we remove at most one element
            }
        }
        pruneBranch(root);
    }

    function pruneBranch(bytes32 root) private {
        BlockHeader storage rootHeader = headers[root];
        for (uint i=0; i<rootHeader.successors.length; i++) {
            pruneBranch(rootHeader.successors[i]);
        }
        if (endpoints[rootHeader.index] == root) {
            // root is an endpoint --> delete root in endpoints array, since root will be deleted and thus can no longer be an endpoint
            delete endpoints[rootHeader.index];
        }
        delete headers[root];
    }

    function checkHeaderValidity(BlockHeader memory header) private view {
        if (endpoints.length > 0) {
            require(headers[header.parent].nonce != 0, "Non-existent parent");
            // todo: check block number increment
            // todo: check difficulty
            // todo: check gas limit
            // todo: check timestamp
        }
    }

    event ParseBlockHeader( bytes32 hash, bytes32 hashWithoutNonce, uint nonce, bytes32 parent );
    function parseAndValidateBlockHeader( bytes memory rlpHeader ) internal returns(bytes32, BlockHeader memory) {
        BlockHeader memory header;
        uint difficulty;

        RLP.Iterator memory it = rlpHeader.toRLPItem().iterator();
        uint idx;
        while(it.hasNext()) {
            if( idx == 0 ) header.parent = it.next().toBytes32();
            else if ( idx == 3 ) header.stateRoot = it.next().toBytes32();
            else if ( idx == 4 ) header.transactionsRoot = it.next().toBytes32();
            else if ( idx == 5 ) header.receiptsRoot = it.next().toBytes32();
            else if ( idx == 7 ) difficulty = it.next().toUint();
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
        checkHeaderValidity(header);

        // Get parent header and calculate total difficulty for the new block
        BlockHeader storage parentHeader = headers[header.parent];
        header.totalDifficulty = parentHeader.totalDifficulty + difficulty;

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
