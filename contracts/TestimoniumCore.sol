pragma solidity ^0.5.10;

import "./MerklePatriciaProof.sol";

contract EthashInterface {
    function verifyPoW(uint blockNumber, bytes32 rlpHeaderHashWithoutNonce, uint nonce, uint difficulty,
        uint[] calldata dataSetLookup, uint[] calldata witnessForLookup) external view returns (bool, uint, uint);
}


/// @title TestimoniumCore: A contract enabling cross-blockchain verifications (transactions, receipts, states)
/// @author Marten Sigwart, Philipp Frauenthaler
/// @notice You can use this contract for submitting new block headers, disputing already submitted block headers, and
///         for verifying Merkle Patricia proofs (transactions, receipts, states).
contract TestimoniumCore {

    using RLPReader for *;
    uint constant LOCK_PERIOD_IN_MIN = 5 minutes;
    uint constant ALLOWED_FUTURE_BLOCK_TIME = 15 seconds;
    uint constant MAX_GAS_LIMIT = 2**63-1;
    uint constant MIN_GAS_LIMIT = 5000;
    int64 constant GAS_LIMIT_BOUND_DIVISOR = 1024;
    bytes32 constant EMPTY_UNCLE_HASH = hex"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347";

    EthashInterface ethashContract;


    struct MetaInfo {
        bytes32[] successors;    // in case of forks a blockchain can have multiple successors
        uint orderedIndex;       // index at which the block header is/was stored in the ordered endpoints array
        uint iterableIndex;      // index at which the block header is/was stored in the iterable endpoints array
        bytes32 latestFork;      // contains the hash of the latest node where the current fork branched off
        uint lockedUntil;        // timestamp until which it is possible to dispute a given block
        address submitter;
    }

    struct BlockHeader {
        bytes32 parent;
        bytes32 uncleHash;
        bytes32 stateRoot;
        bytes32 transactionsRoot;
        bytes32 receiptsRoot;
        uint blockNumber;
        uint gasLimit;
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
    constructor (bytes memory _rlpHeader, uint totalDifficulty, address _ethashContractAddr) internal {
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
        uint blockNumber, uint gasLimit, bytes32 rlpHeaderHashWithoutNonce, uint timestamp, uint nonce,
        uint difficulty, uint totalDifficulty
    ) {
        BlockHeader storage header = headers[blockHash];
        return (
            header.parent,
            header.uncleHash,
            header.stateRoot,
            header.transactionsRoot,
            header.receiptsRoot,
            header.blockNumber,
            header.gasLimit,
            header.rlpHeaderHashWithoutNonce,
            header.timestamp,
            header.nonce,
            header.difficulty,
            header.totalDifficulty
        );
    }

    function getHeaderMetaInfo(bytes32 blockHash) internal view returns (
        bytes32[] memory successors, uint orderedIndex, uint iterableIndex, bytes32 latestFork, uint lockedUntil,
        address submitter
    ) {
        BlockHeader storage header = headers[blockHash];
        return (
            header.meta.successors,
            header.meta.orderedIndex,
            header.meta.iterableIndex,
            header.meta.latestFork,
            header.meta.lockedUntil,
            header.meta.submitter
        );
    }

    function getLockedUntil(bytes32 blockHash) internal view returns (uint) {
        return headers[blockHash].meta.lockedUntil;
    }

    function getNoOfForks() internal view returns (uint) {
        return iterableEndpoints.length;    // Important: do not use orderedEndpoints.length since that array contains gaps
    }

    // @dev Returns the block hash of the endpoint at the specified index
    function getBlockHashOfEndpoint(uint index) internal view returns (bytes32) {
        return iterableEndpoints[index];
    }

    function isBlock(bytes32 hash) public view returns (bool) {
        return headers[hash].nonce != 0;
    }

    function getTransactionsRoot(bytes32 blockHash) internal view returns (bytes32) {
        return headers[blockHash].transactionsRoot;
    }

    function getReceiptsRoot(bytes32 blockHash) internal view returns (bytes32) {
        return headers[blockHash].receiptsRoot;
    }

    function getStateRoot(bytes32 blockHash) internal view returns (bytes32) {
        return headers[blockHash].stateRoot;
    }

    /// @dev Accepts an RLP encoded header. The provided header is parsed, validated and some fields are stored.
    function submitHeader(bytes memory _rlpHeader, address submitter) internal returns (bytes32) {
        bytes32 newBlockHash;
        BlockHeader memory newHeader;
        (newBlockHash, newHeader) = parseAndValidateBlockHeader(_rlpHeader);  // block is also validated by this function

        // Get parent header and set next pointer to newHeader
        BlockHeader storage parentHeader = headers[newHeader.parent];
        parentHeader.meta.successors.push(newBlockHash);
        newHeader.meta.lockedUntil = now + LOCK_PERIOD_IN_MIN;
        newHeader.meta.submitter = submitter;

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
        return newBlockHash;
    }

    event PoWValidationResult(bool isPoWValid, uint errorCode, uint errorInfo);
    /// @dev If a client is convinced that a certain block header is invalid, it can call this function which validates
    ///      whether enough PoW has been carried out.
    /// @param blockHash the hash of the block to dispute
    /// @param dataSetLookup contains elements of the DAG needed for the PoW verification
    /// @param witnessForLookup needed for verifying the dataSetLookup
    /// @return A list of addresses belonging to the submitters of illegal blocks
    function disputeBlock(bytes32 blockHash, uint[] memory dataSetLookup, uint[] memory witnessForLookup) internal returns (address[] memory) {
        // Currently, once the dispute period is over and the block is unlocked we accept it as valid.
        // In that case, no validation is carried out anymore.
        // TO DISCUSS: There might not be a problem to accept disputes even after a block has been unlocked.
        // If an already unlocked block is disputed, certain transactions might have been illegally verified.
        require(!isUnlocked(blockHash), "dispute period is expired");
        BlockHeader memory header = headers[blockHash];
        bool isPoWCorrect;
        uint errorCode;
        uint errorInfo;
        address[] memory submitters = new address[](0);
        (isPoWCorrect, errorCode, errorInfo) = ethashContract.verifyPoW(header.blockNumber, header.rlpHeaderHashWithoutNonce,
            header.nonce, header.difficulty, dataSetLookup, witnessForLookup);
        emit PoWValidationResult(isPoWCorrect, errorCode, errorInfo);

        if (!isPoWCorrect && errorCode == 2) {   // remove branch only if not enough work was performed, i.e., difficulty is too low (errorCode == 2)
            submitters = removeBranch(blockHash);
        }

        return submitters;
    }

    /// @dev Verifies the existence of a transaction ('txHash') within a certain block ('blockHash').
    /// @param blockHash the hash of the block that contains the Merkle root hash
    /// @param noOfConfirmations the required number of succeeding blocks needed for a block to be considered as confirmed
    /// @param rlpEncodedValue the value of the Merkle Patricia trie (e.g, transaction, receipt, state) in RLP format
    /// @param path the path (key) in the trie indicating the way starting at the root node and ending at the value (e.g., transaction)
    /// @param rlpEncodedNodes an RLP encoded list of nodes of the Merkle branch, first element is the root node, last element the value
    /// @param merkleRootHash the hash of the root node of the Merkle Patricia trie
    /// @return 0: verification was successful
    ///         1: block is confirmed and unlocked, but the Merkle proof was invalid
    //
    // The verification follows the following steps:
    //     1. Verify that the given block is part of the longest Proof of Work chain
    //     2. Verify that the block is unlcoked and has been confirmed by at least n succeeding unlocked blocks ('noOfConfirmations')
    //     3. Verify the Merkle Patricia proof of the given block
    //
    // In case we have to check whether enough block confirmations occurred
    // starting from the requested block ('blockHash'), we go to the latest
    // unlocked block on the longest chain path (could be the requested block itself)
    // and count the number of confirmations (i.e. the number of unlocked blocks),
    // starting from the latest unlocked block along the longest chain path.
    function verifyMerkleProof(bytes32 blockHash, uint8 noOfConfirmations, bytes memory rlpEncodedValue,
        bytes memory path, bytes memory rlpEncodedNodes, bytes32 merkleRootHash) internal view returns (uint8) {

        require(isBlock(blockHash), "block does not exist");

        (bool isPartOfLongestPoWCFork, bytes32 confirmationStart) = isBlockPartOfFork(blockHash, longestChainEndpoint);
        require(isPartOfLongestPoWCFork, "block is not part of the longest PoW chain");

        if (headers[confirmationStart].blockNumber <= headers[blockHash].blockNumber + noOfConfirmations) {
            noOfConfirmations = noOfConfirmations - uint8(headers[confirmationStart].blockNumber - headers[blockHash].blockNumber);
            bool unlockedAndConfirmed = hasEnoughConfirmations(confirmationStart, noOfConfirmations);
            require(unlockedAndConfirmed, "block is locked or not confirmed by enough blocks");
        }

        if (MerklePatriciaProof.verify(rlpEncodedValue, path, rlpEncodedNodes, merkleRootHash) > 0) {
            return 1;
        }

        return 0;
    }

    function isBlockPartOfFork(bytes32 blockHash, bytes32 forkEndpoint) private view returns (bool, bytes32) {
        bytes32 current = forkEndpoint;
        uint lastForkIndex = headers[forkEndpoint].meta.orderedIndex;
        bytes32 confirmationStartHeader;    // the hash from where to start the confirmation count in case the requested block header is part of the longest chain

        // Current is still the endpoint
        // if the endpoint is already unlocked we need to start the confirmation verification from the endpoint
        if (isUnlocked(current)) {
            confirmationStartHeader = current;
        }

        while (headers[current].meta.orderedIndex > headers[blockHash].meta.orderedIndex) {
            // go to next fork point
            current = headers[current].meta.latestFork;

            // set confirmationStartHeader only if it has not been set before
            if (confirmationStartHeader == 0) {
                if (isUnlocked(current)) {
                    confirmationStartHeader = getSuccessorByOrderedIndex(current, lastForkIndex);
                }
            }

            // only now we set the lastForkIndex
            lastForkIndex = headers[current].meta.orderedIndex;
        }

        if (headers[current].meta.orderedIndex < headers[blockHash].meta.orderedIndex) {
            return (false, confirmationStartHeader);   // the requested block is NOT part of the longest chain
        }

        if (headers[current].blockNumber < headers[blockHash].blockNumber) {
            // current and the requested block are on a fork with the same orderedIndex
            // however, the requested block comes after the fork point (current), so the requested block cannot be part of the longest chain
            return (false, confirmationStartHeader);
        }

        // if no earlier block header has been found from where to start the confirmation verification,
        // we start the verification from the requested block header
        if (confirmationStartHeader == 0) {
            confirmationStartHeader = blockHash;
        }

        return (true, confirmationStartHeader);

    }

    function isUnlocked(bytes32 blockHash) internal view returns (bool) {
        return headers[blockHash].meta.lockedUntil < now;
    }

    function getSuccessorByOrderedIndex(bytes32 blockHash, uint orderedIndex) private view returns (bytes32) {
        for (uint i = 0; i < headers[blockHash].meta.successors.length; i++) {
            bytes32 successor = headers[blockHash].meta.successors[i];
            if (headers[successor].meta.orderedIndex == orderedIndex) {
                return successor;
            }
        }

        return blockHash;
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
    function removeBranch(bytes32 rootHash) private returns (address[] memory) {
        bytes32 parentHash = headers[rootHash].parent;
        BlockHeader storage parentHeader = headers[parentHash];

        address[] memory submitters = pruneBranch(rootHash, 0);

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
        return submitters;
    }

    function pruneBranch(bytes32 root, uint counter) private returns (address[] memory) {
        BlockHeader storage rootHeader = headers[root];
        address[] memory submitters;

        counter += 1;

        if (rootHeader.meta.successors.length > 1) {
            address[] memory aggregatedSubmitters = new address[](0);
            for (uint i=0; i < rootHeader.meta.successors.length; i++) {
                address[] memory submittersOfBranch = pruneBranch(rootHeader.meta.successors[i], 0);
                aggregatedSubmitters = combineArrays(aggregatedSubmitters, submittersOfBranch);
            }
            submitters = copyArrays(new address[](aggregatedSubmitters.length + counter), aggregatedSubmitters, counter);

        }
        if (rootHeader.meta.successors.length == 1) {
            submitters = pruneBranch(rootHeader.meta.successors[0], counter);
        }
        if (orderedEndpoints[rootHeader.meta.orderedIndex] == root) {
            // root is an endpoint --> delete root in endpoints array, since root will be deleted and thus can no longer be an endpoint
            delete orderedEndpoints[rootHeader.meta.orderedIndex];
            bytes32 lastIterableElement = iterableEndpoints[iterableEndpoints.length - 1];
            iterableEndpoints[rootHeader.meta.iterableIndex] = lastIterableElement;
            iterableEndpoints.length--;
            headers[lastIterableElement].meta.iterableIndex = rootHeader.meta.iterableIndex;
            submitters = new address[](counter);
        }
        submitters[counter-1] = headers[root].meta.submitter;
        delete headers[root];
        return submitters;
    }

    function copyArrays(address[] memory dest, address[] memory src, uint startIndex) private pure returns (address[] memory) {
        require(dest.length - startIndex >= src.length);
        uint j = startIndex;
        for (uint i = 0; i < src.length; i++) {
            dest[j] = src[i];
            j++;
        }

        return dest;
    }

    function combineArrays(address[] memory arr1, address[] memory arr2) private pure returns (address[] memory) {
        address[] memory resultArr = new address[](arr1.length + arr2.length);
        uint i = 0;

        // copy arr1 to resultArr
        for (; i < arr1.length; i++) {
            resultArr[i] = arr1[i];
        }

        // copy arr2 to resultArr
        for (uint j = 0; j < arr2.length; j++) {
            resultArr[i] = arr2[j];
            i++;
        }

        return resultArr;
    }

    event SubmitBlockHeader( bytes32 hash, bytes32 hashWithoutNonce, uint nonce, uint difficulty, bytes32 parent, bytes32 transactionsRoot );
    function parseAndValidateBlockHeader( bytes memory rlpHeader ) private returns (bytes32, BlockHeader memory) {
        BlockHeader memory header;

        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();
        uint gasUsed;   // we do not store gasUsed with the header as we do not need to access it after the header validation has taken place
        uint idx;
        while(it.hasNext()) {
            if( idx == 0 ) header.parent = bytes32(it.next().toUint());
            else if ( idx == 1 ) header.uncleHash = bytes32(it.next().toUint());
            else if ( idx == 3 ) header.stateRoot = bytes32(it.next().toUint());
            else if ( idx == 4 ) header.transactionsRoot = bytes32(it.next().toUint());
            else if ( idx == 5 ) header.receiptsRoot = bytes32(it.next().toUint());
            else if ( idx == 7 ) header.difficulty = it.next().toUint();
            else if ( idx == 8 ) header.blockNumber = it.next().toUint();
            else if ( idx == 9 ) header.gasLimit = it.next().toUint();
            else if ( idx == 10 ) gasUsed = it.next().toUint();
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
        checkHeaderValidity(header, gasUsed);

        // Get parent header and set total difficulty
        BlockHeader storage parentHeader = headers[header.parent];
        header.totalDifficulty = parentHeader.totalDifficulty + header.difficulty;

        emit SubmitBlockHeader(blockHash, rlpHeaderHashWithoutNonce, header.nonce, header.difficulty, header.parent, header.transactionsRoot);
        return (blockHash, header);
    }

    function copy(bytes memory sourceArray, uint newLength) private pure returns (bytes memory) {
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

    // @dev Validates the fields of a block header without validating the PoW
    // The validation largely follows the header validation of the geth implementation:
    // https://github.com/ethereum/go-ethereum/blob/aa6005b469fdd1aa7a95f501ce87908011f43159/consensus/ethash/consensus.go#L241
    function checkHeaderValidity(BlockHeader memory header, uint gasUsed) private view {
        if (orderedEndpoints.length == 0) {
            // we do not check header validity for the genesis block
            // since the genesis block is submitted at contract creation.
            return;
        }

        // validate parent
        BlockHeader storage parent = headers[header.parent];
        require(parent.nonce != 0, "non-existent parent");

        // validate block number
        require(parent.blockNumber + 1 == header.blockNumber, "illegal block number");

        // validate timestamp
        require(header.timestamp <= now + ALLOWED_FUTURE_BLOCK_TIME, "illegal timestamp");
        require(parent.timestamp < header.timestamp, "illegal timestamp");

        // validate difficulty
        uint expectedDifficulty = calculateDifficulty(parent, header.timestamp);
        require(expectedDifficulty == header.difficulty, "wrong difficulty");

        // validate gas limit
        require(header.gasLimit <= MAX_GAS_LIMIT, "gas limit too high");  // verify that the gas limit is <= 2^63-1
        require(header.gasLimit >= MIN_GAS_LIMIT, "gas limit too small"); // verify that the gas limit is >= 5000
        require(gasLimitWithinBounds(int64(header.gasLimit), int64(parent.gasLimit)), "illegal gas limit");
        require(gasUsed <= header.gasLimit, "gas used is higher than the gas limit"); // verify that the gasUsed is <= gasLimit
    }

    function gasLimitWithinBounds(int64 gasLimit, int64 parentGasLimit) private pure returns (bool) {
        int64 limit = parentGasLimit / GAS_LIMIT_BOUND_DIVISOR;
        int64 difference = gasLimit - parentGasLimit;
        if (difference < 0) {
            difference *= -1;
        }
        return difference <= limit;
    }

    // diff = (parent_diff +
    //         (parent_diff / 2048 * max((2 if len(parent.uncles) else 1) - ((timestamp - parent.timestamp) // 9), -99))
    //        ) + 2^(periodCount - 2)
    // https://github.com/ethereum/go-ethereum/blob/aa6005b469fdd1aa7a95f501ce87908011f43159/consensus/ethash/consensus.go#L335
    function calculateDifficulty(BlockHeader memory parent, uint timestamp) private pure returns (uint) {
        int x = int((timestamp - parent.timestamp) / 9);

        // take into consideration uncles of parent
        if (parent.uncleHash == EMPTY_UNCLE_HASH) {
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
