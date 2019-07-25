pragma solidity ^0.5.10;

import "./RLP.sol";

contract Testimonium {

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
        uint lockedUntil;                   // timestamp until which it is possible to dispute a given block
        uint totalDifficulty;
        uint orderedIndex;     // index at which the block header is/was stored in the ordered endpoints array
        uint iterableIndex;     // index at which the block header is/was stored in the iterable endpoints array
        bytes32 latestFork;  // contains the hash of the latest node where the current fork branched off
    }

    mapping (bytes32 => BlockHeader) public headers;  // sha3 hash -> Header
    uint constant lockPeriodInMin = 5 minutes;
    uint constant requiredSucceedingBlocks = 3;
    bytes32[] orderedEndpoints;   // contains the hash of each fork's recent block
    bytes32[] iterableEndpoints;
    bytes32 public longestChainEndpoint;

    // The contract is initialized with block 8084509 and the total difficulty of that same block.
    // The contract creator needs to make sure that these values represent a valid block of the tracked blockchain.
    constructor (bytes memory _rlpHeader, uint totalDifficulty) public {
        bytes32 newBlockHash;
        BlockHeader memory newHeader;
        (newBlockHash, newHeader) = parseAndValidateBlockHeader(_rlpHeader);  // block is also validated by this function
        newHeader.orderedIndex = orderedEndpoints.push(newBlockHash) - 1;
        newHeader.iterableIndex = iterableEndpoints.push(newBlockHash) - 1;
        newHeader.lockedUntil = now;    // the first block does not need a confirmation period
        newHeader.totalDifficulty = totalDifficulty;
        headers[newBlockHash] = newHeader;
        longestChainEndpoint = newBlockHash;
    }

    function getNoOfForks() public view returns (uint) {
        return iterableEndpoints.length;
    }

    // @dev Returns the block hash of the endpoint at the specified index
    function getBlockHashOfEndpoint(uint index) public view returns (bytes32) {
        return iterableEndpoints[index];
    }

    function getSuccessors(bytes32 blockHash) public view returns (bytes32[] memory) {
        return headers[blockHash].successors;
    }

    function isBlock(bytes32 hash) public view returns (bool) {
        return headers[hash].nonce != 0;    // maybe a more sophisticated check is required here
    }

    function submitHeader(bytes memory _rlpHeader) public {
        bytes32 newBlockHash;
        BlockHeader memory newHeader;
        (newBlockHash, newHeader) = parseAndValidateBlockHeader(_rlpHeader);  // block is also validated by this function

        // Get parent header and set next pointer to newHeader
        BlockHeader storage parentHeader = headers[newHeader.parent];
        parentHeader.successors.push(newBlockHash);

        newHeader.lockedUntil = now + lockPeriodInMin;

        // check if parent is an endpoint
        if (orderedEndpoints[parentHeader.orderedIndex] == newHeader.parent) {
            // parentHeader is an endpoint (and no fork) -> replace parentHeader in endpoints by new header (since new header becomes new endpoint)
            orderedEndpoints[parentHeader.orderedIndex] = newBlockHash;
            newHeader.orderedIndex = parentHeader.orderedIndex;
            iterableEndpoints[parentHeader.iterableIndex] = newBlockHash;
            newHeader.iterableIndex = parentHeader.iterableIndex;
            delete parentHeader.iterableIndex;
            newHeader.latestFork = parentHeader.latestFork;
        }
        else {
            // parentHeader is forked
            newHeader.orderedIndex = orderedEndpoints.push(newBlockHash) - 1;
            newHeader.iterableIndex = iterableEndpoints.push(newBlockHash) - 1;
            newHeader.latestFork = newHeader.parent;

            if (parentHeader.successors.length == 2) {
                // a new fork was created, so we set the latest fork of the original branch to the newly created fork
                // this has to be done only the first time a fork is created
                setLatestForkAtSuccessors(headers[parentHeader.successors[0]], newHeader.parent);
            }
        }

        if (newHeader.totalDifficulty > headers[longestChainEndpoint].totalDifficulty) {
            longestChainEndpoint = newBlockHash;
        }

        headers[newBlockHash] = newHeader; // make sure to persist the header only AFTER all property changes
    }

    function disputeBlock(bytes32 blockHash) public {
        // Currently, once the dispute period is over and the block is unlocked we accept it as valid.
        // In that case, no validation is carried out anymore.
        // TO DISCUSS: There might not be a problem to accept disputes even after a block has been unlocked.
        // If an already unlocked block is disputed, certain transactions might have been illegally verified.
        require(!isUnlocked(blockHash), "dispute period is expired");

        // todo: do light validation
        // todo: do full validation (via SPV or majority vote)
        removeBranch(blockHash);
    }

    // @dev Verifies the existence of a transaction ('txHash') within a certain block ('blockHash').
    // The verification follows the following steps:
    //     1. Verify that the given block is part of the longest Proof of Work chain
    //     2. Verify that the block has passed the dispute period in which the validity of a block can be disputed
    //     3. Verify that the block has been confirmed by at least n succeeding blocks ('noOfConfirmations')
    //     4. Verify that the transaction is indeed part of the block via a Merkle proof
    //
    // In case we have to check whether enough block confirmations occurred
    // starting from the requested block ('blockHash'), we go to the latest
    // unlocked block on the longest chain path (could be the requested block itself)
    // and count the number of confirmations (i.e. the number of unlocked blocks),
    // starting from the latest unlocked block along the longest chain path.
    function verifyTransaction(bytes32 txHash, bytes32 requested, uint8 noOfConfirmations) public view returns (bool) {
        bytes32 last = longestChainEndpoint;
        bytes32 current = longestChainEndpoint;
        bytes32 checkpoint = requested;
        bool confirmed = false;
        while (true) {
            if (!confirmed && checkpoint == requested) {
                if (isUnlocked(current)) {
                    if (headers[current].blockNumber >= headers[requested].blockNumber + noOfConfirmations) {
                        // We found a block that is unlocked AND confirms the requested block
                        // by at least 'noOfConfirmations' confirmations
                        confirmed = true;
                    } else {
                        // We found a block that is unlocked, but the requested block cannot be considered confirmed yet.
                        // Since all blocks before the current block will also be unlocked, we only need to check whether
                        // enough blocks follow the current block along the longest chain which are also unlocked.
                        // 'Enough' is determined by the number of blocks required for the requested block to be considered confirmed.
                        checkpoint = getSuccessor(current, last);
                        noOfConfirmations = (uint8)(headers[requested].blockNumber + noOfConfirmations - headers[checkpoint].blockNumber);
                    }
                }
            }

            if (headers[current].orderedIndex < headers[requested].orderedIndex) {
                return false;   // the requested block is NOT part of the longest chain
            }

            if (headers[current].orderedIndex == headers[requested].orderedIndex) {
                break;  // the requested block is part of the longest chain --> jump out of the loop
            }

            // go to next fork
            last = current;
            current = headers[current].latestFork;
        }

        if (!confirmed && !hasEnoughConfirmations(checkpoint, noOfConfirmations)) {
            return false;
        }

        return verifyMerkleProof();
    }

    function isUnlocked(bytes32 blockHash) public view returns (bool) {
        return headers[blockHash].lockedUntil < now;
    }

    // @dev Returns the successor of the given block ('blockHash').
    // If a block does not have any successors, the block itself is returned.
    // If a block only has one successor, that successor is returned.
    // If a block has multiple successors, the successor in the direction of the next fork ('nextFork') is returned.
    function getSuccessor(bytes32 blockHash, bytes32 nextFork) private view returns (bytes32) {
        if (headers[blockHash].successors.length == 1) {
            return headers[blockHash].successors[0];
        }

        if (headers[blockHash].successors.length > 1) {
            for (uint i = 0; i<headers[blockHash].successors.length; i++) {
                bytes32 successor = headers[blockHash].successors[i];
                if (headers[successor].orderedIndex == headers[nextFork].orderedIndex) {
                    return successor;
                }
            }
        }

        return blockHash;   // --> either block has no successors or the right successor could not be determined
    }

    // @dev Checks whether a block has enough succeeding blocks that are unlocked (dispute period is over).
    // Note: The caller has to make sure that this method is only called for paths where the required number of
    // confirmed blocks does not go beyond forks, i.e., each block has to have a clear successor.
    // If a block is a fork, i.e., has more than one successor and requires more than 0 confirmations
    // the method returns false, which may or may not represent the true state of the system.
    function hasEnoughConfirmations(bytes32 start, uint8 noOfConfirmations) private view returns (bool) {
        if (!isUnlocked(start)) {
            return false;   // --> block is still locked and can therefore not be confirmed
        }

        if (noOfConfirmations == 0) {
            return true;    // --> block is unlocked and no more confirmations are required
        }

        // More confirmations are required but block has more than one successor or no successor at all.
        // Since we do not know which path to take or there is no path to choose at all, we return false.
        if (headers[start].successors.length != 1) {
            // todo: move along first path
            return false;
        }

        return hasEnoughConfirmations(headers[start].successors[0], noOfConfirmations - 1);
    }

    function verifyMerkleProof() private pure returns (bool) {
        // todo: check Merkle Proof
        return true;
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


    event RemoveBranch( bytes32 root );
    function removeBranch(bytes32 rootHash) private {
        bytes32 parentHash = headers[rootHash].parent;
        BlockHeader storage parentHeader = headers[parentHash];

        pruneBranch(rootHash);

        if (parentHeader.successors.length == 1) {
            // parentHeader has only one successor --> parentHeader will be an endpoint after pruning
            orderedEndpoints[parentHeader.orderedIndex] = parentHash;
            parentHeader.iterableIndex = iterableEndpoints.push(parentHash) - 1;
        }

        // remove root (which will be pruned) from the parent's successor list
        for (uint i=0; i<parentHeader.successors.length; i++) {
            if (parentHeader.successors[i] == rootHash) {
                // overwrite root with last successor and delete last successor
                parentHeader.successors[i] = parentHeader.successors[parentHeader.successors.length - 1];
                parentHeader.successors.length--;
                break;  // we remove at most one element
            }
        }

        // find new longest chain endpoint
        longestChainEndpoint = iterableEndpoints[0];
        for (uint i=1; i<iterableEndpoints.length; i++) {
            if (headers[iterableEndpoints[i]].totalDifficulty > headers[longestChainEndpoint].totalDifficulty) {
                longestChainEndpoint = iterableEndpoints[i];
            }
        }

        emit RemoveBranch(rootHash);
    }

    function pruneBranch(bytes32 root) private {
        BlockHeader storage rootHeader = headers[root];
        for (uint i=0; i<rootHeader.successors.length; i++) {
            pruneBranch(rootHeader.successors[i]);
        }
        if (orderedEndpoints[rootHeader.orderedIndex] == root) {
            // root is an endpoint --> delete root in endpoints array, since root will be deleted and thus can no longer be an endpoint
            delete orderedEndpoints[rootHeader.orderedIndex];
            bytes32 lastIterableElement = iterableEndpoints[iterableEndpoints.length - 1];
            iterableEndpoints[rootHeader.iterableIndex] = lastIterableElement;
            iterableEndpoints.length--;
            headers[lastIterableElement].iterableIndex = rootHeader.iterableIndex;
        }
        delete headers[root];
    }

    function checkHeaderValidity(BlockHeader memory header) private view {
        if (orderedEndpoints.length > 0) {
            require(headers[header.parent].nonce != 0, "non-existent parent");
            // todo: check block number increment
            // todo: check difficulty
            // todo: check gas limit
            // todo: check timestamp
        }
    }

    event SubmitBlockHeader( bytes32 hash, bytes32 hashWithoutNonce, uint nonce, bytes32 parent );
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
            else if ( idx == 8 ) header.blockNumber = it.next().toUint();
//            else if ( idx == 9 ) header.gasLimit = it.next().toUint();
//            else if ( idx == 11 ) header.timestamp = it.next().toUint();
            else if ( idx == 14 ) header.nonce = it.next().toUint();
            else it.next();

            idx++;
        }

        // calculate block hash and check that block header does not already exist
        bytes32 blockHash = keccak256(rlpHeader);
        require(!isBlock(blockHash), "block already exists");

        // duplicate rlp header and truncate nonce and mixDataHash
        bytes memory rlpWithoutNonce = copy(rlpHeader, rlpHeader.length-42);  // 42: length of none+mixHash
        uint16 rlpHeaderWithoutNonceLength = uint16(rlpHeader.length-3-42);  // rlpHeaderLength - 3 prefix bytes (0xf9 + length) - length of nonce and mixHash
        bytes2 headerLengthBytes = bytes2(rlpHeaderWithoutNonceLength);
        rlpWithoutNonce[1] = headerLengthBytes[0];
        rlpWithoutNonce[2] = headerLengthBytes[1];
        bytes32 rlpHeaderHashWithoutNonce = keccak256(rlpWithoutNonce);

        header.rlpHeaderHashWithoutNonce = rlpHeaderHashWithoutNonce;
        checkHeaderValidity(header);

        // Get parent header and set total difficulty
        BlockHeader storage parentHeader = headers[header.parent];
        header.totalDifficulty = parentHeader.totalDifficulty + difficulty;

        emit SubmitBlockHeader(blockHash, rlpHeaderHashWithoutNonce, header.nonce, header.parent);
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
