pragma solidity ^0.5.10;

import "./MerklePatriciaProof.sol";

contract EthashInterface {
    function verifyPoW(uint blockNumber, bytes32 rlpHeaderHashWithoutNonce, uint nonce, uint difficulty,
        uint[] calldata dataSetLookup, uint[] calldata witnessForLookup) external view returns (uint, uint);
}


/// @title TestimoniumCore: A contract enabling cross-blockchain verifications (transactions, receipts, states)
/// @author Marten Sigwart, Philipp Frauenthaler
/// @notice You can use this contract for submitting new block headers, disputing already submitted block headers, and
///         for verifying Merkle Patricia proofs (transactions, receipts, states).
contract TestimoniumCore {

    using RLPReader for *;
    uint16 constant LOCK_PERIOD_IN_MIN = 5 minutes;
    uint8 constant ALLOWED_FUTURE_BLOCK_TIME = 15 seconds;
    uint8 constant MAX_EXTRA_DATA_SIZE = 32;
    uint8 constant REQU_SUCEEDING_BLOCKS = 3;
    uint16 constant MIN_GAS_LIMIT = 5000;
    int64 constant GAS_LIMIT_BOUND_DIVISOR = 1024;
    uint constant MAX_GAS_LIMIT = 2**63-1;
    bytes32 constant EMPTY_UNCLE_HASH = hex"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347";

    EthashInterface ethashContract;


    struct MetaInfo {
        uint64 iterableIndex;      // index at which the block header is/was stored in the iterable endpoints array
        uint64 forkId;
        uint64 lockedUntil;        // timestamp until which it is possible to dispute a given block
        bytes32 latestFork;      // contains the hash of the latest node where the current fork branched off
        address submitter;
        bytes32[] successors;    // in case of forks a blockchain can have multiple successors
    }

    struct Header {
        uint24 blockNumber;
        uint232 totalDifficulty;
        bytes32 hash;
        MetaInfo meta;
    }

    struct FullHeader {
        bytes32 parent;
        bytes32 uncleHash;
        bytes32 stateRoot;
        bytes32 transactionsRoot;
        bytes32 receiptsRoot;
        uint blockNumber;
        uint gasLimit;
        uint gasUsed;
        bytes32 rlpHeaderHashWithoutNonce;   // sha3 hash of the header without nonce and mix fields
        uint timestamp;                      // block timestamp is needed for difficulty calculation
        uint nonce;                          // blockNumber, rlpHeaderHashWithoutNonce and nonce are needed for verifying PoW
        uint difficulty;
        bytes extraData;
    }

    uint64 maxForkId = 0;
    bytes32 public longestChainEndpoint;
    mapping (bytes32 => Header) private headers;  // sha3 hash -> Header
    bytes32[] iterableEndpoints;

    // The contract is initialized with block 8084509 and the total difficulty of that same block.
    // The contract creator needs to make sure that these values represent a valid block of the tracked blockchain.
    constructor (bytes memory _rlpHeader, uint totalDifficulty, address _ethashContractAddr) internal {
        bytes32 newBlockHash = keccak256(_rlpHeader);
        FullHeader memory parsedHeader = parseRlpEncodedHeader(_rlpHeader);
        Header memory newHeader;
        newHeader.hash = newBlockHash;
        newHeader.blockNumber = uint24(parsedHeader.blockNumber);
        newHeader.totalDifficulty = uint232(totalDifficulty);
        newHeader.meta.forkId = maxForkId;
        newHeader.meta.iterableIndex = uint64(iterableEndpoints.push(newBlockHash) - 1);
        newHeader.meta.lockedUntil = uint64(now);    // the first block does not need a confirmation period
        headers[newBlockHash] = newHeader;
        longestChainEndpoint = newBlockHash;

        ethashContract = EthashInterface(_ethashContractAddr);
    }

    function getHeader(bytes32 blockHash) public view returns (bytes32 hash, uint blockNumber, uint totalDifficulty) {
        Header storage header = headers[blockHash];
        return (
            header.hash,
            header.blockNumber,
            header.totalDifficulty
        );
    }

    function getHeaderMetaInfo(bytes32 blockHash) internal view returns (
        bytes32[] memory successors, uint forkId, uint iterableIndex, bytes32 latestFork, uint lockedUntil,
        address submitter
    ) {
        Header storage header = headers[blockHash];
        return (
            header.meta.successors,
            header.meta.forkId,
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
        return iterableEndpoints.length;
    }

    // @dev Returns the block hash of the endpoint at the specified index
    function getBlockHashOfEndpoint(uint index) internal view returns (bytes32) {
        return iterableEndpoints[index];
    }

    function isHeaderStored(bytes32 hash) public view returns (bool) {
        return headers[hash].blockNumber != 0;
    }

    /// @dev Accepts an RLP encoded header. The provided header is parsed and its hash along with some meta data is stored.
    event SubmitHeader( bytes32 hash );
    function submitHeader(bytes memory _rlpHeader, address submitter) public returns (bytes32) {
        Header memory newHeader;

        // calculate block hash and check that block header does not already exist
        bytes32 blockHash = keccak256(_rlpHeader);
        require(!isHeaderStored(blockHash), "block already exists");

        bytes32 decodedParent;
        uint decodedBlockNumber;
        uint decodedDifficulty;
        (decodedParent, decodedBlockNumber, decodedDifficulty) = getParentBlockNumberDiff(_rlpHeader);
        // Get parent header
        require(isHeaderStored(decodedParent), "parent does not exist");
        Header storage parentHeader = headers[decodedParent];
        parentHeader.meta.successors.push(blockHash);

        newHeader.hash = blockHash;
        newHeader.blockNumber = uint24(decodedBlockNumber);
        newHeader.totalDifficulty = uint232(parentHeader.totalDifficulty + decodedDifficulty);
        newHeader.meta.lockedUntil = uint64(now + LOCK_PERIOD_IN_MIN);
        newHeader.meta.submitter = submitter;

        // check if parent is an endpoint
        if (iterableEndpoints.length > parentHeader.meta.iterableIndex && iterableEndpoints[parentHeader.meta.iterableIndex] == decodedParent) {
            // parentHeader is an endpoint (and no fork) -> replace parentHeader in endpoints by new header (since new header becomes new endpoint)
            newHeader.meta.forkId = parentHeader.meta.forkId;
            iterableEndpoints[parentHeader.meta.iterableIndex] = newHeader.hash;
            newHeader.meta.iterableIndex = parentHeader.meta.iterableIndex;
            delete parentHeader.meta.iterableIndex;
            newHeader.meta.latestFork = parentHeader.meta.latestFork;
        }
        else {
            // parentHeader is forked
            maxForkId += 1;
            newHeader.meta.forkId = maxForkId;
            newHeader.meta.iterableIndex = uint64(iterableEndpoints.push(newHeader.hash) - 1);
            newHeader.meta.latestFork = decodedParent;

            if (parentHeader.meta.successors.length == 2) {
                // a new fork was created, so we set the latest fork of the original branch to the newly created fork
                // this has to be done only the first time a fork is created
                setLatestForkAtSuccessors(headers[parentHeader.meta.successors[0]], decodedParent);
            }
        }

        if (newHeader.totalDifficulty > headers[longestChainEndpoint].totalDifficulty) {
            longestChainEndpoint = blockHash;
        }

        headers[newHeader.hash] = newHeader; // make sure to persist the header only AFTER all property changes
        emit SubmitHeader(newHeader.hash);

        return newHeader.hash;
    }

    event DisputeBlock(uint returnCode);
    event PoWValidationResult(uint returnCode, uint errorInfo);
    /// @dev If a client is convinced that a certain block header is invalid, it can call this function which validates
    ///      whether enough PoW has been carried out.
    /// @param rlpHeader the encoded version of the block header to dispute
    /// @param rlpParent the encoded version of the block header's parent
    /// @param dataSetLookup contains elements of the DAG needed for the PoW verification
    /// @param witnessForLookup needed for verifying the dataSetLookup
    /// @return A list of addresses belonging to the submitters of illegal blocks
    function disputeBlock(bytes memory rlpHeader, bytes memory rlpParent, uint[] memory dataSetLookup,
                          uint[] memory witnessForLookup) internal returns (address[] memory) {
        // Currently, once the dispute period is over and the block is unlocked we accept it as valid.
        // In that case, no validation is carried out anymore.

        bytes32 headerHash = keccak256(rlpHeader);
        require(isHeaderStored(headerHash), "provided header does not exist");
        require(isHeaderStored(keccak256(rlpParent)), "provided parent does not exist");
        require(!isUnlocked(headerHash), "dispute period is expired");

        Header storage storedHeader = headers[headerHash];
        Header storage storedParent = headers[keccak256(rlpParent)];
        require(isHeaderSuccessorOfParent(storedHeader, storedParent), "stored parent is not a predecessor of stored header within Testimonium");

        FullHeader memory providedHeader = parseRlpEncodedHeader(rlpHeader);
        FullHeader memory providedParent = parseRlpEncodedHeader(rlpParent);
        require(providedHeader.parent == keccak256(rlpParent), "provided header's parent does not match with provided parent' hash");

        uint returnCode = checkHeaderValidity(providedHeader, providedParent);

        if (returnCode == 0) {
            // header validation without checking Ethash was successful -> verify Ethash
            uint errorInfo;
            (returnCode, errorInfo) = ethashContract.verifyPoW(storedHeader.blockNumber, getRlpHeaderHashWithoutNonce(rlpHeader),
                providedHeader.nonce, providedHeader.difficulty, dataSetLookup, witnessForLookup);

            emit PoWValidationResult(returnCode, errorInfo);

        }

        address[] memory submitters = new address[](0);

        if (returnCode != 0) {
            submitters = removeBranch(headerHash, storedParent);
        }

        emit DisputeBlock(returnCode);
        return submitters;
    }

    function isHeaderSuccessorOfParent(Header memory header, Header memory parent) private pure returns (bool) {
        for (uint i = 0; i < parent.meta.successors.length; i++) {
            bytes32 successor = parent.meta.successors[i];
            if (successor == header.hash) {
                return true;
            }
        }

        return false;
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

        require(isHeaderStored(blockHash), "block does not exist");

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

    function isBlockConfirmed(bytes32 blockHash, uint8 noOfConfirmations) internal view returns (bool) {

        if (isHeaderStored(blockHash) == false) {
            return false;
        }

        (bool isPartOfLongestPoWCFork, bytes32 confirmationStart) = isBlockPartOfFork(blockHash, longestChainEndpoint);
        if (isPartOfLongestPoWCFork == false) {
            return false;
        }

        if (headers[confirmationStart].blockNumber <= headers[blockHash].blockNumber + noOfConfirmations) {
            noOfConfirmations = noOfConfirmations - uint8(headers[confirmationStart].blockNumber - headers[blockHash].blockNumber);
            bool unlockedAndConfirmed = hasEnoughConfirmations(confirmationStart, noOfConfirmations);
            if (unlockedAndConfirmed == false) {
                return false;
            }
        }

        return true;
    }

    function isBlockPartOfFork(bytes32 blockHash, bytes32 forkEndpoint) private view returns (bool, bytes32) {
        bytes32 current = forkEndpoint;
        uint lastForkId;
        bytes32 confirmationStartHeader;    // the hash from where to start the confirmation count in case the requested block header is part of the longest chain

        // Current is still the endpoint
        // if the endpoint is already unlocked we need to start the confirmation verification from the endpoint
        if (isUnlocked(current)) {
            confirmationStartHeader = current;
        }

        while (headers[current].meta.forkId > headers[blockHash].meta.forkId) {
            // go to next fork point but remember last fork id
            lastForkId = headers[current].meta.forkId;
            current = headers[current].meta.latestFork;

            // set confirmationStartHeader only if it has not been set before
            if (confirmationStartHeader == 0) {
                if (isUnlocked(current)) {
                    confirmationStartHeader = getSuccessorByForkId(current, lastForkId);
                }
            }
        }

        if (headers[current].meta.forkId < headers[blockHash].meta.forkId) {
            return (false, confirmationStartHeader);   // the requested block is NOT part of the longest chain
        }

        if (headers[current].blockNumber < headers[blockHash].blockNumber) {
            // current and the requested block are on a fork with the same fork id
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

    function getSuccessorByForkId(bytes32 blockHash, uint forkId) private view returns (bytes32) {
        for (uint i = 0; i < headers[blockHash].meta.successors.length; i++) {
            bytes32 successor = headers[blockHash].meta.successors[i];
            if (headers[successor].meta.forkId == forkId) {
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

    function setLatestForkAtSuccessors(Header storage header, bytes32 latestFork) private {
        if (header.meta.latestFork == latestFork) {
            // latest fork has already been set
            return;
        }

        header.meta.latestFork = latestFork;

        if (header.meta.successors.length == 1) {
            setLatestForkAtSuccessors(headers[header.meta.successors[0]], latestFork);
        }
    }

    function setLatestForkAndForkIdAtSuccessors(Header storage header, bytes32 latestFork, uint64 forkId) private {
        if (header.meta.latestFork == latestFork) {
            // latest fork has already been set
            return;
        }

        header.meta.latestFork = latestFork;
        header.meta.forkId = forkId;

        if (header.meta.successors.length == 1) {
            setLatestForkAndForkIdAtSuccessors(headers[header.meta.successors[0]], latestFork, forkId);
        }
    }

    event RemoveBranch( bytes32 root );
    function removeBranch(bytes32 rootHash, Header storage parentHeader) private returns (address[] memory) {
        address[] memory submitters = pruneBranch(rootHash, 0);

        if (parentHeader.meta.successors.length == 1) {
            // parentHeader has only one successor --> parentHeader will be an endpoint after pruning
            parentHeader.meta.iterableIndex = uint64(iterableEndpoints.push(parentHeader.hash) - 1);
        }

        // remove root (which will be pruned) from the parent's successor list
        for (uint i=0; i < parentHeader.meta.successors.length; i++) {
            if (parentHeader.meta.successors[i] == rootHash) {
                // overwrite root with last successor and delete last successor
                parentHeader.meta.successors[i] = parentHeader.meta.successors[parentHeader.meta.successors.length - 1];
                parentHeader.meta.successors.length--;
                break;  // we remove at most one element
            }
        }

        if (parentHeader.meta.successors.length == 1) {
            // only one successor left after pruning -> parent is no longer a fork junction
            setLatestForkAndForkIdAtSuccessors(headers[parentHeader.meta.successors[0]], parentHeader.meta.latestFork, parentHeader.meta.forkId);
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
        Header storage rootHeader = headers[root];
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
        if (iterableEndpoints.length > rootHeader.meta.iterableIndex && iterableEndpoints[rootHeader.meta.iterableIndex] == root) {
            // root is an endpoint --> delete root in endpoints array, since root will be deleted and thus can no longer be an endpoint
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

    function parseRlpEncodedHeader(bytes memory rlpHeader) private pure returns (FullHeader memory) {
        FullHeader memory header;

        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();
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
            else if ( idx == 10 ) header.gasUsed = it.next().toUint();
            else if ( idx == 11 ) header.timestamp = it.next().toUint();
            else if ( idx == 12 ) header.extraData = it.next().toBytes();
            else if ( idx == 14 ) header.nonce = it.next().toUint();
            else it.next();

            idx++;
        }

        return header;
    }

    function getRlpHeaderHashWithoutNonce(bytes memory rlpHeader) private pure returns (bytes32) {
        // duplicate rlp header and truncate nonce and mixDataHash
        bytes memory rlpWithoutNonce = copy(rlpHeader, rlpHeader.length-42);  // 42: length of none+mixHash
        uint16 rlpHeaderWithoutNonceLength = uint16(rlpHeader.length-3-42);  // rlpHeaderLength - 3 prefix bytes (0xf9 + length) - length of nonce and mixHash
        bytes2 headerLengthBytes = bytes2(rlpHeaderWithoutNonceLength);
        rlpWithoutNonce[1] = headerLengthBytes[0];
        rlpWithoutNonce[2] = headerLengthBytes[1];

        return keccak256(rlpWithoutNonce);
    }

    function getTxRoot(bytes memory rlpHeader) internal pure returns (bytes32) {
        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();
        uint idx;
        while(it.hasNext()) {
            if ( idx == 4 ) return bytes32(it.next().toUint());
            else it.next();

            idx++;
        }

        return 0;
    }

    function getStateRoot(bytes memory rlpHeader) internal pure returns (bytes32) {
        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();
        uint idx;
        while(it.hasNext()) {
            if ( idx == 3 ) return bytes32(it.next().toUint());
            else it.next();

            idx++;
        }

        return 0;
    }

    function getReceiptsRoot(bytes memory rlpHeader) internal pure returns (bytes32) {
        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();
        uint idx;
        while(it.hasNext()) {
            if ( idx == 5 ) return bytes32(it.next().toUint());
            else it.next();

            idx++;
        }

        return 0;
    }

    function getParentBlockNumberDiff(bytes memory rlpHeader) internal pure returns (bytes32, uint, uint) {
        uint idx;
        bytes32 parent;
        uint blockNumber;
        uint difficulty;
        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();

        while(it.hasNext()) {
            if( idx == 0 ) parent = bytes32(it.next().toUint());
            else if ( idx == 7 ) difficulty = it.next().toUint();
            else if ( idx == 8 ) blockNumber = it.next().toUint();
            else it.next();

            idx++;
        }

        return (parent, blockNumber, difficulty);
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

    // @dev Validates the fields of a block header without validating Ethash.
    // The validation largely follows the header validation of the geth implementation:
    // https://github.com/ethereum/go-ethereum/blob/aa6005b469fdd1aa7a95f501ce87908011f43159/consensus/ethash/consensus.go#L241
    function checkHeaderValidity(FullHeader memory header, FullHeader memory parent) private view returns (uint) {
        if (iterableEndpoints.length == 0) {
            // we do not check header validity for the genesis block
            // since the genesis block is submitted at contract creation.
            return 0;
        }

        if (header.extraData.length > MAX_EXTRA_DATA_SIZE) return 3;

        // check block number
        if (parent.blockNumber + 1 != header.blockNumber) return 4;

        // check timestamp
        if (header.timestamp > now + ALLOWED_FUTURE_BLOCK_TIME) return 5;
        if (parent.timestamp >= header.timestamp) return 6;

        // check difficulty
        uint expectedDifficulty = calculateDifficulty(parent, header.timestamp);
        if (expectedDifficulty != header.difficulty) return 7;

        // validate gas limit
        if (header.gasLimit > MAX_GAS_LIMIT) return 8; // verify that the gas limit is <= 2^63-1
        if (header.gasLimit < MIN_GAS_LIMIT) return 9; // verify that the gas limit is >= 5000
        if (!gasLimitWithinBounds(int64(header.gasLimit), int64(parent.gasLimit))) return 10;
        if (header.gasUsed > header.gasLimit) return 11;

        return 0;
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
    function calculateDifficulty(FullHeader memory parent, uint timestamp) private pure returns (uint) {
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
        if (parent.blockNumber + 1 >= 9200000) {
            // https://eips.ethereum.org/EIPS/eip-2384
            bombDelayFromParent = 9000000 - 1;
        }

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
