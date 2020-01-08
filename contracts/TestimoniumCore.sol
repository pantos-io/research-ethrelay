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
    uint constant ALLOWED_FUTURE_BLOCK_TIME = 15 seconds;
    uint constant MAX_GAS_LIMIT = 2**63-1;
    uint constant MIN_GAS_LIMIT = 5000;
    int64 constant GAS_LIMIT_BOUND_DIVISOR = 1024;
    bytes32 constant EMPTY_UNCLE_HASH = hex"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347";

    EthashInterface ethashContract;


    struct MetaInfo {
        bytes32[] successors;    // in case of forks a blockchain can have multiple successors
        uint forkId;
        uint iterableIndex;      // index at which the block header is/was stored in the iterable endpoints array
        bytes32 latestFork;      // contains the hash of the latest node where the current fork branched off
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
        uint timestamp;                      // block timestamp is needed for difficulty calculation
        uint difficulty;
        uint totalDifficulty;
        MetaInfo meta;
    }

    mapping (bytes32 => BlockHeader) private headers;  // sha3 hash -> Header
    uint constant lockPeriodInMin = 5 minutes;
    uint constant requiredSucceedingBlocks = 3;
    uint maxForkId = 0;
    bytes32[] iterableEndpoints;
    bytes32 public longestChainEndpoint;

    // The contract is initialized with block 8084509 and the total difficulty of that same block.
    // The contract creator needs to make sure that these values represent a valid block of the tracked blockchain.
    constructor (bytes memory _rlpHeader, uint totalDifficulty, address _ethashContractAddr) internal {
        bytes32 newBlockHash;
        BlockHeader memory newHeader;
        bytes32 rlpHeaderHashWithoutNonce;
        uint nonce;
        (newBlockHash, newHeader, rlpHeaderHashWithoutNonce, nonce) = parseAndValidateBlockHeader(_rlpHeader);  // block is also validated by this function

        newHeader.totalDifficulty = totalDifficulty;
        newHeader.meta.forkId = maxForkId;
        maxForkId += 1;
        newHeader.meta.iterableIndex = iterableEndpoints.push(newBlockHash) - 1;
        headers[newBlockHash] = newHeader;
        longestChainEndpoint = newBlockHash;

        ethashContract = EthashInterface(_ethashContractAddr);
    }

    function getHeader(bytes32 blockHash) public view returns (
        bytes32 parent, bytes32 uncleHash, bytes32 stateRoot, bytes32 transactionsRoot, bytes32 receiptsRoot,
        uint blockNumber, uint gasLimit, uint timestamp, uint difficulty, uint totalDifficulty
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
            header.timestamp,
            header.difficulty,
            header.totalDifficulty
        );
    }

    function getHeaderMetaInfo(bytes32 blockHash) internal view returns (
        bytes32[] memory successors, uint forkId, uint iterableIndex, bytes32 latestFork, address submitter
    ) {
        BlockHeader storage header = headers[blockHash];
        return (
            header.meta.successors,
            header.meta.forkId,
            header.meta.iterableIndex,
            header.meta.latestFork,
            header.meta.submitter
        );
    }

    function getNoOfForks() internal view returns (uint) {
        return iterableEndpoints.length;
    }

    // @dev Returns the block hash of the endpoint at the specified index
    function getBlockHashOfEndpoint(uint index) internal view returns (bytes32) {
        return iterableEndpoints[index];
    }

    function isBlock(bytes32 hash) public view returns (bool) {
        return headers[hash].difficulty != 0;
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

    event PoWValidationResult(uint errorCode, uint errorInfo);
    /// @dev Accepts an RLP encoded header. The provided header is parsed, validated and some fields are stored.
    function submitHeader(bytes memory _rlpHeader, uint[] memory dataSetLookup, uint[] memory witnessForLookup, address submitter) internal returns (bytes32) {
        bytes32 newBlockHash;
        BlockHeader memory newHeader;
        bytes32 rlpHeaderHashWithoutNonce;
        uint nonce;
        (newBlockHash, newHeader, rlpHeaderHashWithoutNonce, nonce) = parseAndValidateBlockHeader(_rlpHeader);  // block is also validated by this function

        // verify Ethash
        (uint returnCode, ) = ethashContract.verifyPoW(newHeader.blockNumber, rlpHeaderHashWithoutNonce,
            nonce, newHeader.difficulty, dataSetLookup, witnessForLookup);
        emit PoWValidationResult(returnCode, 0);
        require(returnCode == 0, "Ethash validation failed");

        // Get parent header and set next pointer to newHeader
        BlockHeader storage parentHeader = headers[newHeader.parent];
        parentHeader.meta.successors.push(newBlockHash);
        newHeader.meta.submitter = submitter;

        // check if parent is an endpoint
        if (iterableEndpoints.length > parentHeader.meta.iterableIndex && iterableEndpoints[parentHeader.meta.iterableIndex] == newHeader.parent) {
            // parentHeader is an endpoint (and no fork) -> replace parentHeader in endpoints by new header (since new header becomes new endpoint)
            newHeader.meta.forkId = parentHeader.meta.forkId;
            iterableEndpoints[parentHeader.meta.iterableIndex] = newBlockHash;
            newHeader.meta.iterableIndex = parentHeader.meta.iterableIndex;
            delete parentHeader.meta.iterableIndex;
            newHeader.meta.latestFork = parentHeader.meta.latestFork;
        }
        else {
            // parentHeader is forked
            newHeader.meta.forkId = maxForkId;
            maxForkId += 1;
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

        bool isPartOfLongestPoWCFork = isBlockPartOfFork(blockHash, longestChainEndpoint);
        require(isPartOfLongestPoWCFork, "block is not part of the longest PoW chain");

        require(headers[longestChainEndpoint].blockNumber >= headers[blockHash].blockNumber + noOfConfirmations);

        if (MerklePatriciaProof.verify(rlpEncodedValue, path, rlpEncodedNodes, merkleRootHash) > 0) {
            return 1;
        }

        return 0;
    }

    function isBlockPartOfFork(bytes32 blockHash, bytes32 forkEndpoint) private view returns (bool) {
        bytes32 current = forkEndpoint;

        while (headers[current].meta.forkId > headers[blockHash].meta.forkId) {
            // go to next fork point
            current = headers[current].meta.latestFork;
        }

        if (headers[current].meta.forkId < headers[blockHash].meta.forkId) {
            return false;   // the requested block is NOT part of the longest chain
        }

        if (headers[current].blockNumber < headers[blockHash].blockNumber) {
            // current and the requested block are on a fork with the same fork id
            // however, the requested block comes after the fork point (current), so the requested block cannot be part of the longest chain
            return false;
        }

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

    event SubmitBlockHeader( bytes32 hash, bytes32 hashWithoutNonce, uint nonce, uint difficulty, bytes32 parent, bytes32 transactionsRoot );
    function parseAndValidateBlockHeader( bytes memory rlpHeader ) private returns (bytes32, BlockHeader memory, bytes32, uint) {
        BlockHeader memory header;

        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();
        uint gasUsed;   // we do not store gasUsed with the header as we do not need to access it after the header validation has taken place
        uint idx;
        uint nonce;
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
            else if ( idx == 14 ) nonce = it.next().toUint();
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

        checkHeaderValidity(header, gasUsed);

        // Get parent header and set total difficulty
        header.totalDifficulty = headers[header.parent].totalDifficulty + header.difficulty;

        emit SubmitBlockHeader(blockHash, rlpHeaderHashWithoutNonce, nonce, header.difficulty, header.parent, header.transactionsRoot);
        return (blockHash, header, rlpHeaderHashWithoutNonce, nonce);
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
        if (iterableEndpoints.length == 0) {
            // we do not check header validity for the genesis block
            // since the genesis block is submitted at contract creation.
            return;
        }

        // validate parent
        BlockHeader storage parent = headers[header.parent];
        require(parent.difficulty != 0, "non-existent parent");

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
