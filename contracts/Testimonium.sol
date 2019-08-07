pragma solidity ^0.5.10;

import "./RLP.sol";

contract EthashInterface {
    function verifyPoW(uint blockNumber, bytes32 rlpHeaderHashWithoutNonce, uint nonce, uint difficulty,
        uint[] calldata dataSetLookup, uint[] calldata witnessForLookup) external view returns (bool, uint, uint);
}

contract Testimonium {

    using RLP for *;

    EthashInterface ethashContract;

    bytes32 constant emptyUncleHash = hex"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347";

    struct MetaInfo {
        bytes32[] successors;    // in case of forks a blockchain can have multiple successors
        uint orderedIndex;       // index at which the block header is/was stored in the ordered endpoints array
        uint iterableIndex;      // index at which the block header is/was stored in the iterable endpoints array
        bytes32 latestFork;      // contains the hash of the latest node where the current fork branched off
        uint lockedUntil;        // timestamp until which it is possible to dispute a given block
    }

    struct BlockHeader {
        bytes32 parent;
        bytes32 uncleHash;
        bytes32 stateRoot;
        bytes32 transactionsRoot;
        bytes32 receiptsRoot;
        uint blockNumber;
        bytes32 rlpHeaderHashWithoutNonce;   // sha3 hash of the header without nonce and mix fields
        uint timestamp;                      // block timestamp is needed for difficulty calculation
        uint nonce;                          // blockNumber, rlpHeaderHashWithoutNonce and nonce are needed for verifying PoW
        uint difficulty;
        uint totalDifficulty;
        MetaInfo meta;
    }

    mapping (bytes32 => BlockHeader) private headers;  // sha3 hash -> Header
    uint constant lockPeriodInMin = 5 minutes;
    uint constant requiredSucceedingBlocks = 3;
    bytes32[] orderedEndpoints;   // contains the hash of each fork's recent block
    bytes32[] iterableEndpoints;
    bytes32 public longestChainEndpoint;

    // The contract is initialized with block 8084509 and the total difficulty of that same block.
    // The contract creator needs to make sure that these values represent a valid block of the tracked blockchain.
    constructor (bytes memory _rlpHeader, uint totalDifficulty, address _ethashContractAddr) public {
        bytes32 newBlockHash;
        BlockHeader memory newHeader;
        (newBlockHash, newHeader) = parseAndValidateBlockHeader(_rlpHeader);  // block is also validated by this function
        newHeader.totalDifficulty = totalDifficulty;
        newHeader.meta.orderedIndex = orderedEndpoints.push(newBlockHash) - 1;
        newHeader.meta.iterableIndex = iterableEndpoints.push(newBlockHash) - 1;
        newHeader.meta.lockedUntil = now;    // the first block does not need a confirmation period
        headers[newBlockHash] = newHeader;
        longestChainEndpoint = newBlockHash;

        ethashContract = EthashInterface(_ethashContractAddr);
    }

    function getHeader(bytes32 blockHash) public view returns (
        bytes32 parent, bytes32 uncleHash, bytes32 stateRoot, bytes32 transactionsRoot, bytes32 receiptsRoot,
        uint blockNumber, bytes32 rlpHeaderHashWithoutNonce, uint timestamp, uint nonce, uint difficulty, uint totalDifficulty
    ) {
        BlockHeader storage header = headers[blockHash];
        return (
            header.parent,
            header.uncleHash,
            header.stateRoot,
            header.transactionsRoot,
            header.receiptsRoot,
            header.blockNumber,
            header.rlpHeaderHashWithoutNonce,
            header.timestamp,
            header.nonce,
            header.difficulty,
            header.totalDifficulty
        );
    }

    function getHeaderMetaInfo(bytes32 blockHash) public view returns (
        bytes32[] memory successors, uint orderedIndex, uint iterableIndex, bytes32 latestFork, uint lockedUntil
    ) {
        BlockHeader storage header = headers[blockHash];
        return (
            header.meta.successors,
            header.meta.orderedIndex,
            header.meta.iterableIndex,
            header.meta.latestFork,
            header.meta.lockedUntil
        );
    }

    function getNoOfForks() public view returns (uint) {
        return iterableEndpoints.length;    // Important: do not use orderedEndpoints.length since that array contains gaps
    }

    // @dev Returns the block hash of the endpoint at the specified index
    function getBlockHashOfEndpoint(uint index) public view returns (bytes32) {
        return iterableEndpoints[index];
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
        parentHeader.meta.successors.push(newBlockHash);

        newHeader.meta.lockedUntil = now + lockPeriodInMin;

        // check if parent is an endpoint
        if (orderedEndpoints[parentHeader.meta.orderedIndex] == newHeader.parent) {
            // parentHeader is an endpoint (and no fork) -> replace parentHeader in endpoints by new header (since new header becomes new endpoint)
            orderedEndpoints[parentHeader.meta.orderedIndex] = newBlockHash;
            newHeader.meta.orderedIndex = parentHeader.meta.orderedIndex;
            iterableEndpoints[parentHeader.meta.iterableIndex] = newBlockHash;
            newHeader.meta.iterableIndex = parentHeader.meta.iterableIndex;
            delete parentHeader.meta.iterableIndex;
            newHeader.meta.latestFork = parentHeader.meta.latestFork;
        }
        else {
            // parentHeader is forked
            newHeader.meta.orderedIndex = orderedEndpoints.push(newBlockHash) - 1;
            newHeader.meta.iterableIndex = iterableEndpoints.push(newBlockHash) - 1;
            newHeader.meta.latestFork = newHeader.parent;

            if (parentHeader.meta.successors.length == 2) {
                // a new fork was created, so we set the latest fork of the original branch to the newly created fork
                // this has to be done only the first time a fork is created
                setLatestForkAtSuccessors(headers[parentHeader.meta.successors[0]], newHeader.parent);
            }
        }

        if (newHeader.totalDifficulty > headers[longestChainEndpoint].totalDifficulty) {
            longestChainEndpoint = newBlockHash;
        }

        headers[newBlockHash] = newHeader; // make sure to persist the header only AFTER all property changes
    }

    event PoWValidationResult(bool isPoWValid, uint errorCode, uint errorInfo);

    function disputeBlock(bytes32 blockHash, uint[] memory dataSetLookup, uint[] memory witnessForLookup) public {
        // Currently, once the dispute period is over and the block is unlocked we accept it as valid.
        // In that case, no validation is carried out anymore.
        // TO DISCUSS: There might not be a problem to accept disputes even after a block has been unlocked.
        // If an already unlocked block is disputed, certain transactions might have been illegally verified.
        require(!isUnlocked(blockHash), "dispute period is expired");
        BlockHeader memory header = headers[blockHash];
        bool isPoWCorrect;
        uint errorCode;
        uint errorInfo;
        (isPoWCorrect, errorCode, errorInfo) = ethashContract.verifyPoW(header.blockNumber, header.rlpHeaderHashWithoutNonce,
            header.nonce, header.difficulty, dataSetLookup, witnessForLookup);
        emit PoWValidationResult(isPoWCorrect, errorCode, errorInfo);

        // todo: do light validation
        if (!isPoWCorrect && errorCode == 2) {   // remove branch only if now enough work was performed is too low (errorCode == 2)
            removeBranch(blockHash);
        }
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

            if (headers[current].meta.orderedIndex < headers[requested].meta.orderedIndex) {
                return false;   // the requested block is NOT part of the longest chain
            }

            if (headers[current].meta.orderedIndex == headers[requested].meta.orderedIndex) {
                break;  // the requested block is part of the longest chain --> jump out of the loop
            }

            // go to next fork
            last = current;
            current = headers[current].meta.latestFork;
        }

        if (!confirmed && !hasEnoughConfirmations(checkpoint, noOfConfirmations)) {
            return false;
        }

        return verifyMerkleProof();
    }

    function isUnlocked(bytes32 blockHash) public view returns (bool) {
        return headers[blockHash].meta.lockedUntil < now;
    }

    // @dev Returns the successor of the given block ('blockHash').
    // If a block does not have any successors, the block itself is returned.
    // If a block only has one successor, that successor is returned.
    // If a block has multiple successors, the successor in the direction of the next fork ('nextFork') is returned.
    function getSuccessor(bytes32 blockHash, bytes32 nextFork) private view returns (bytes32) {
        if (headers[blockHash].meta.successors.length == 1) {
            return headers[blockHash].meta.successors[0];
        }

        if (headers[blockHash].meta.successors.length > 1) {
            for (uint i = 0; i<headers[blockHash].meta.successors.length; i++) {
                bytes32 successor = headers[blockHash].meta.successors[i];
                if (headers[successor].meta.orderedIndex == headers[nextFork].meta.orderedIndex) {
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

        if (headers[start].meta.successors.length == 0) {
            // More confirmations are required but block has no more successors.
            return false;
        }

        return hasEnoughConfirmations(headers[start].meta.successors[0], noOfConfirmations - 1);
    }

    function verifyMerkleProof() private pure returns (bool) {
        // todo: check Merkle Proof
        return true;
    }

    function setLatestForkAtSuccessors(BlockHeader storage header, bytes32 latestFork) private {
        if (header.meta.latestFork == latestFork) {
            // latest fork has already been set
            return;
        }

        header.meta.latestFork = latestFork;

        if (header.meta.successors.length == 1) {
            setLatestForkAtSuccessors(headers[header.meta.successors[0]], latestFork);
        }
    }


    event RemoveBranch( bytes32 root );
    function removeBranch(bytes32 rootHash) private {
        bytes32 parentHash = headers[rootHash].parent;
        BlockHeader storage parentHeader = headers[parentHash];

        pruneBranch(rootHash);

        if (parentHeader.meta.successors.length == 1) {
            // parentHeader has only one successor --> parentHeader will be an endpoint after pruning
            orderedEndpoints[parentHeader.meta.orderedIndex] = parentHash;
            parentHeader.meta.iterableIndex = iterableEndpoints.push(parentHash) - 1;
        }

        // remove root (which will be pruned) from the parent's successor list
        for (uint i=0; i<parentHeader.meta.successors.length; i++) {
            if (parentHeader.meta.successors[i] == rootHash) {
                // overwrite root with last successor and delete last successor
                parentHeader.meta.successors[i] = parentHeader.meta.successors[parentHeader.meta.successors.length - 1];
                parentHeader.meta.successors.length--;
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
        for (uint i=0; i<rootHeader.meta.successors.length; i++) {
            pruneBranch(rootHeader.meta.successors[i]);
        }
        if (orderedEndpoints[rootHeader.meta.orderedIndex] == root) {
            // root is an endpoint --> delete root in endpoints array, since root will be deleted and thus can no longer be an endpoint
            delete orderedEndpoints[rootHeader.meta.orderedIndex];
            bytes32 lastIterableElement = iterableEndpoints[iterableEndpoints.length - 1];
            iterableEndpoints[rootHeader.meta.iterableIndex] = lastIterableElement;
            iterableEndpoints.length--;
            headers[lastIterableElement].meta.iterableIndex = rootHeader.meta.iterableIndex;
        }
        delete headers[root];
    }

    event SubmitBlockHeader( bytes32 hash, bytes32 hashWithoutNonce, uint nonce, uint difficulty, bytes32 parent );
    function parseAndValidateBlockHeader( bytes memory rlpHeader ) internal returns(bytes32, BlockHeader memory) {
        BlockHeader memory header;

        RLP.Iterator memory it = rlpHeader.toRLPItem().iterator();
        uint idx;
        while(it.hasNext()) {
            if( idx == 0 ) header.parent = it.next().toBytes32();
            else if ( idx == 1 ) header.uncleHash = it.next().toBytes32();
            else if ( idx == 3 ) header.stateRoot = it.next().toBytes32();
            else if ( idx == 4 ) header.transactionsRoot = it.next().toBytes32();
            else if ( idx == 5 ) header.receiptsRoot = it.next().toBytes32();
            else if ( idx == 7 ) header.difficulty = it.next().toUint();
            else if ( idx == 8 ) header.blockNumber = it.next().toUint();
//            else if ( idx == 9 ) header.gasLimit = it.next().toUint();
            else if ( idx == 11 ) header.timestamp = it.next().toUint();
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
        header.totalDifficulty = parentHeader.totalDifficulty + header.difficulty;

        emit SubmitBlockHeader(blockHash, rlpHeaderHashWithoutNonce, header.nonce, header.difficulty, header.parent);
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

    function checkHeaderValidity(BlockHeader memory header) private {
        if (orderedEndpoints.length == 0) {
            // we do not check header validity for the genesis block
            // since the genesis block is submitted at contract creation.
            return;
        }

        BlockHeader storage parent = headers[header.parent];
        require(parent.nonce != 0, "non-existent parent");
        require(parent.blockNumber + 1 == header.blockNumber, "illegal block number");
        require(parent.timestamp < header.timestamp, "illegal timestamp");

        // validate difficulty
        uint expectedDifficulty = calculateDifficulty(parent, header.timestamp);
        require(expectedDifficulty == header.difficulty, "wrong difficulty");

        // todo: check gas limit
    }

    // diff = (parent_diff +
    //         (parent_diff / 2048 * max((2 if len(parent.uncles) else 1) - ((timestamp - parent.timestamp) // 9), -99))
    //        ) + 2^(periodCount - 2)
    // https://github.com/ethereum/go-ethereum/blob/aa6005b469fdd1aa7a95f501ce87908011f43159/consensus/ethash/consensus.go#L335
    function calculateDifficulty(BlockHeader memory parent, uint timestamp) private pure returns (uint) {
        int x = int((timestamp - parent.timestamp) / 9);

        // take into consideration uncles of parent
        if (parent.uncleHash == emptyUncleHash) {
            x = 1 - x;
        } else {
            x = 2 - x;
        }

        if (x < -99) {
            x = -99;
        }
        x = int(parent.difficulty) + int(parent.difficulty) / 2048 * x;
        // minimum difficulty = 131072
        if (x < 131072) {
            x = 131072;
        }
        uint bombDelayFromParent = 5000000 - 1;

        // calculate a fake block number for the ice-age delay
        // Specification: https://eips.ethereum.org/EIPS/eip-1234
        uint fakeBlockNumber = 0;
        if (parent.blockNumber >= bombDelayFromParent) {
            fakeBlockNumber = parent.blockNumber - bombDelayFromParent;
        }
        // for the exponential factor
        uint periodCount = fakeBlockNumber / 100000;

        // the exponential factor, commonly referred to as "the bomb"
        // diff = diff + 2^(periodCount - 2)
        if (periodCount > 1) {
            return uint(x) + 2**(periodCount - 2);
        }
        return uint(x);
    }
}
