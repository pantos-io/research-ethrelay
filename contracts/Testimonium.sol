pragma solidity ^0.5.10;

import "./TestimoniumCore.sol";
import "../node_modules/solidity-rlp/contracts/RLPReader.sol";


/// @title Testimonium: A contract enabling cross-blockchain verifications (transactions, receipts, states)
/// @author Marten Sigwart, Philipp Frauenthaler
/// @notice You can use this contract for submitting new block headers, disputing already submitted block headers, and
///         for verifying Merkle Patricia proofs (transactions, receipts, states).
/// @dev    This contract uses the TestimoniumCore contract and extends it with an incentive structure.
contract Testimonium is TestimoniumCore {

    uint constant ETH_IN_WEI = 1000000000000000000;
    uint constant REQUIRED_STAKE_PER_BLOCK = 1 * ETH_IN_WEI;
    uint constant REQUIRED_VERIFICATION_FEE_IN_WEI = ETH_IN_WEI / 10;
    uint8 constant VERIFICATION_TYPE_TX = 1;
    uint8 constant VERIFICATION_TYPE_RECEIPT = 2;
    uint8 constant VERIFICATION_TYPE_STATE = 3;

    mapping(address => bytes32[]) blocksSubmittedByClient;
    mapping(address => uint) clientStake;

    // The contract is initialized with block 8084509 and the total difficulty of that same block.
    // The contract creator needs to make sure that these values represent a valid block of the tracked blockchain.
    constructor(bytes memory _rlpHeader, uint totalDifficulty, address _ethashContractAddr) TestimoniumCore(_rlpHeader, totalDifficulty, _ethashContractAddr) public {}

    /// @dev Deposits stake for a client allowing the client to submit block headers.
    function depositStake(uint amount) payable public {
        require(amount == msg.value, "transfer amount not equal to function parameter");
        clientStake[msg.sender] = clientStake[msg.sender] + msg.value;
    }

    event WithdrawStake(address client, uint withdrawnStake);
    /// @dev Withdraws the stake of a client. The stake is reduced by the specified amount. Emits an event WithdrawStake
    ///      containing the client's address and the amount of withdrawn stake.
    function withdrawStake(uint amount) public {
        uint withdrawnStake = 0;
        if (clientStake[msg.sender] >= amount) {
            if (getUnusedStake(msg.sender) >= amount) {
                withdraw(msg.sender, amount);
                withdrawnStake = amount;
            }
            else {
                // no enough free stake -> try to clean up array (search for stakes used by blocks that have already passed the lock period)
                cleanSubmitList(msg.sender);
                if (getUnusedStake(msg.sender) >= amount) {
                    withdraw(msg.sender, amount);
                    withdrawnStake = amount;
                }
            }
        }

        emit WithdrawStake(msg.sender, withdrawnStake);
    }

    function getStake() public view returns (uint) {
        return clientStake[msg.sender];
    }

    function getRequiredStakePerBlock() public pure returns (uint) {
        return REQUIRED_STAKE_PER_BLOCK;
    }

    function getRequiredVerificationFee() public pure returns (uint) {
        return REQUIRED_VERIFICATION_FEE_IN_WEI;
    }

    function getBlockHashesSubmittedByClient() public view returns (bytes32[] memory) {
        return blocksSubmittedByClient[msg.sender];
    }

    event SubmitBlock(bytes32 blockHash);
    function submitBlock(bytes memory rlpHeader) public {
        // client must have enough stake to be able to submit blocks
        if (getUnusedStake(msg.sender) < REQUIRED_STAKE_PER_BLOCK) {
            // client has not enough unused stake -> check whether some of the blocks submitted by the client have left the lock period
            cleanSubmitList(msg.sender);
            if (getUnusedStake(msg.sender) < REQUIRED_STAKE_PER_BLOCK) {
                // not enough unused stake -> abort
                emit SubmitBlock(0);
                return;
            }
        }

        // client has enough stake -> submit header and add its hash to the client's list of submitted block headers
        bytes32 blockHash = submitHeader(rlpHeader, msg.sender);
        blocksSubmittedByClient[msg.sender].push(blockHash);

        emit SubmitBlock(blockHash);
    }

    function disputeBlockHeader(bytes memory rlpHeader, bytes memory rlpParent, uint[] memory dataSetLookup, uint[] memory witnessForLookup) public {
        address[] memory submittersToPunish = disputeBlock(rlpHeader, rlpParent, dataSetLookup, witnessForLookup);

        // if the PoW validation initiated by the dispute function was successful (i.e., the block is legal),
        // submittersToPunish will be empty and no further action will be carried out.
        uint collectedStake = 0;
        for (uint i = 0; i < submittersToPunish.length; i++) {
            address client = submittersToPunish[i];
            clientStake[client] = clientStake[client] - REQUIRED_STAKE_PER_BLOCK;
            collectedStake += REQUIRED_STAKE_PER_BLOCK;
        }
        // client that triggered the dispute receives the collected stake
        clientStake[msg.sender] += collectedStake;
    }

    function verify(uint8 verificationType, uint feeInWei, bytes memory rlpHeader, uint8 noOfConfirmations, bytes memory rlpEncodedValue,
        bytes memory path, bytes memory rlpEncodedNodes) private returns (uint8) {

        require(feeInWei == msg.value, "transfer amount not equal to function parameter");
        require(feeInWei >= REQUIRED_VERIFICATION_FEE_IN_WEI, "provided fee is less than expected fee");

        bytes32 blockHash = keccak256(rlpHeader);
        uint8 result;

        if (verificationType == VERIFICATION_TYPE_TX) {
            result = verifyMerkleProof(blockHash, noOfConfirmations, rlpEncodedValue, path, rlpEncodedNodes, getTxRoot(rlpHeader));
        }
        else if (verificationType == VERIFICATION_TYPE_RECEIPT) {
            result = verifyMerkleProof(blockHash, noOfConfirmations, rlpEncodedValue, path, rlpEncodedNodes, getReceiptsRoot(rlpHeader));
        }
        else if (verificationType == VERIFICATION_TYPE_STATE) {
            result = verifyMerkleProof(blockHash, noOfConfirmations, rlpEncodedValue, path, rlpEncodedNodes, getStateRoot(rlpHeader));
        }
        else {
            revert("Unknown verification type");
        }

        // send fee to block submitter
        (, , , , , address submitter) = getHeaderMetaInfo(blockHash);
        address payable submitterAddr = address(uint160(submitter));
        submitterAddr.transfer(feeInWei);

        return result;
    }

    event VerifyTransaction(uint8 result);
    /// @dev Verifies if a transaction is included in the given block's transactions Merkle Patricia trie
    /// @param feeInWei the fee that is payed for the verification and must be equal to VERIFICATION_FEE_IN_WEI.
    /// @param rlpHeader the rlp encoded header that contains the Merkle root hash
    /// @param noOfConfirmations the required number of succeeding blocks needed for a block to be considered as confirmed
    /// @param rlpEncodedTx the transaction of the Merkle Patricia trie in RLP format
    /// @param path the path (key) in the trie indicating the way starting at the root node and ending at the transaction
    /// @param rlpEncodedNodes an RLP encoded list of nodes of the Merkle branch, first element is the root node, last element the transaction
    /// @return 0: verification was successful
    ///         1: block is confirmed and unlocked, but the Merkle proof was invalid
    function verifyTransaction(uint feeInWei, bytes memory rlpHeader, uint8 noOfConfirmations, bytes memory rlpEncodedTx,
        bytes memory path, bytes memory rlpEncodedNodes) payable public returns (uint8) {
        uint8 result = verify(VERIFICATION_TYPE_TX, feeInWei, rlpHeader, noOfConfirmations, rlpEncodedTx, path, rlpEncodedNodes);
        emit VerifyTransaction(result);

        return result;
    }

    event VerifyReceipt(uint8 result);
    /// @dev Verifies if a receipt is included in the given block's receipts Merkle Patricia trie
    /// @param feeInWei the fee that is payed for the verification and must be equal to VERIFICATION_FEE_IN_WEI.
    /// @param rlpHeader the rlp encoded header that contains the Merkle root hash
    /// @param noOfConfirmations the required number of succeeding blocks needed for a block to be considered as confirmed
    /// @param rlpEncodedReceipt the receipt of the Merkle Patricia trie in RLP format
    /// @param path the path (key) in the trie indicating the way starting at the root node and ending at the receipt
    /// @param rlpEncodedNodes an RLP encoded list of nodes of the Merkle branch, first element is the root node, last element the receipt
    /// @return 0: verification was successful
    ///         1: block is confirmed and unlocked, but the Merkle proof was invalid
    function verifyReceipt(uint feeInWei, bytes memory rlpHeader, uint8 noOfConfirmations, bytes memory rlpEncodedReceipt,
        bytes memory path, bytes memory rlpEncodedNodes) payable public returns (uint8) {
        uint8 result = verify(VERIFICATION_TYPE_RECEIPT, feeInWei, rlpHeader, noOfConfirmations, rlpEncodedReceipt, path, rlpEncodedNodes);
        emit VerifyReceipt(result);

        return result;
    }

    event VerifyState(uint8 result);
    /// @dev   Verifies if a node is included in the given block's state Merkle Patricia trie
    /// @param feeInWei the fee that is payed for the verification and must be equal to VERIFICATION_FEE_IN_WEI.
    /// @param rlpHeader the rlp encoded header that contains the Merkle root hash
    /// @param noOfConfirmations the required number of succeeding blocks needed for a block to be considered as confirmed
    /// @param rlpEncodedState the node of the Merkle Patricia trie in RLP format
    /// @param path the path (key) in the trie indicating the way starting at the root node and ending at the node
    /// @param rlpEncodedNodes an RLP encoded list of nodes of the Merkle branch, first element is the root node, last element a state node
    /// @return 0: verification was successful
    ///         1: block is confirmed and unlocked, but the Merkle proof was invalid
    function verifyState(uint feeInWei, bytes memory rlpHeader, uint8 noOfConfirmations, bytes memory rlpEncodedState,
        bytes memory path, bytes memory rlpEncodedNodes) payable public returns (uint8) {
        uint8 result = verify(VERIFICATION_TYPE_STATE, feeInWei, rlpHeader, noOfConfirmations, rlpEncodedState, path, rlpEncodedNodes);
        emit VerifyState(result);

        return result;
    }

    function isBlockConfirmed(uint feeInWei, bytes32 blockHash, uint8 noOfConfirmations) public payable returns (bool) {
        require(feeInWei == msg.value, "transfer amount not equal to function parameter");
        require(feeInWei >= REQUIRED_VERIFICATION_FEE_IN_WEI, "provided fee is less than expected fee");

        return isBlockConfirmed(blockHash, noOfConfirmations);
    }

    /// @dev Calculates the fraction of the provided stake that is not used by any of the blocks in the client's list of
    ///      submitted block headers (blocksSubmittedByClient). It does not matter whether a block's lock period has already
    ///      been elapsed. As long as the block is referenced in blocksSubmittedByClient, the stake is considered as "used".
    function getUnusedStake(address client) private view returns (uint) {
        uint usedStake = blocksSubmittedByClient[client].length * REQUIRED_STAKE_PER_BLOCK;
        if (clientStake[client] < usedStake) {
            // if a client get punished due to a dispute the clientStake[client] can be less than
            // blocksSubmittedByClient[client].length * REQUIRED_STAKE_PER_BLOCK, since clientStake[client] is deducted
            // after the dispute, but blocksSubmittedByClient[client] remains unaffected (i.e., it is not cleared)
            return 0;
        }
        else {
            return clientStake[client] - usedStake;
        }
    }

    /// @dev Checks for each block referenced in blocksSubmittedByClient whether it is unlocked. In case a referenced
    ///      block's lock perdiod has expired, its reference is removed from the list blocksSubmittedByClient.
    function cleanSubmitList(address client) private returns (uint) {
        uint deletedElements = 0;

        for (uint i = 0; i < blocksSubmittedByClient[client].length;) {
            bytes32 blockHash = blocksSubmittedByClient[client][i];
            if (!isHeaderStored(blockHash) || isUnlocked(blockHash)) {
                // block has been removed or is already unlocked (i.e., lock period has elapsed) -> remove hash from array
                uint lastElemPos = blocksSubmittedByClient[client].length - 1;
                // copy last element to position i (overwrite current elem)
                blocksSubmittedByClient[client][i] = blocksSubmittedByClient[client][lastElemPos];
                // remove last element
                blocksSubmittedByClient[client].length--;
                deletedElements += 1;
                // i is not increased, since we copied the last element to position i (otherwise the copied element would not be checked)
            }
            else {
                // nothing changed -> increase i and check next element
                i++;
            }
        }

        return deletedElements;
    }

    function withdraw(address payable receiver, uint amount) private {
        clientStake[receiver] = clientStake[receiver] - amount;
        receiver.transfer(amount);
    }

}
