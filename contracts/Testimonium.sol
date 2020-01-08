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
    uint constant REQUIRED_VERIFICATION_FEE_IN_WEI = ETH_IN_WEI / 10;
    uint8 constant VERIFICATION_TYPE_TX = 1;
    uint8 constant VERIFICATION_TYPE_RECEIPT = 2;
    uint8 constant VERIFICATION_TYPE_STATE = 3;

    // The contract is initialized with block 8084509 and the total difficulty of that same block.
    // The contract creator needs to make sure that these values represent a valid block of the tracked blockchain.
    constructor(bytes memory _rlpHeader, uint totalDifficulty, address _ethashContractAddr) TestimoniumCore(_rlpHeader, totalDifficulty, _ethashContractAddr) public {}

    function getRequiredVerificationFee() public pure returns (uint) {
        return REQUIRED_VERIFICATION_FEE_IN_WEI;
    }

    event SubmitBlock(bytes32 blockHash);
    function submitBlock(bytes memory rlpHeader, uint[] memory dataSetLookup, uint[] memory witnessForLookup) public {
        bytes32 blockHash = submitHeader(rlpHeader, dataSetLookup, witnessForLookup, msg.sender);
        emit SubmitBlock(blockHash);
    }

    function verify(uint8 verificationType, uint feeInWei, bytes32 blockHash, uint8 noOfConfirmations, bytes memory rlpEncodedValue,
        bytes memory path, bytes memory rlpEncodedNodes) private returns (uint8) {

        require(feeInWei == msg.value, "transfer amount not equal to function parameter");
        require(feeInWei >= REQUIRED_VERIFICATION_FEE_IN_WEI, "provided fee is less than expected fee");

        uint8 result;

        if (verificationType == VERIFICATION_TYPE_TX) {
            result = verifyMerkleProof(blockHash, noOfConfirmations, rlpEncodedValue, path, rlpEncodedNodes, getTransactionsRoot(blockHash));
        }
        else if (verificationType == VERIFICATION_TYPE_RECEIPT) {
            result = verifyMerkleProof(blockHash, noOfConfirmations, rlpEncodedValue, path, rlpEncodedNodes, getReceiptsRoot(blockHash));
        }
        else if (verificationType == VERIFICATION_TYPE_STATE) {
            result = verifyMerkleProof(blockHash, noOfConfirmations, rlpEncodedValue, path, rlpEncodedNodes, getStateRoot(blockHash));
        }
        else {
            revert("Unknown verification type");
        }

        // send fee to block submitter
        (, , , , address submitter) = getHeaderMetaInfo(blockHash);
        address payable submitterAddr = address(uint160(submitter));
        submitterAddr.transfer(feeInWei);

        return result;
    }

    event VerifyTransaction(uint8 result);
    /// @dev Verifies if a transaction is included in the given block's transactions Merkle Patricia trie
    /// @param feeInWei the fee that is payed for the verification and must be equal to VERIFICATION_FEE_IN_WEI.
    /// @param blockHash the hash of the block that contains the Merkle root hash
    /// @param noOfConfirmations the required number of succeeding blocks needed for a block to be considered as confirmed
    /// @param rlpEncodedTx the transaction of the Merkle Patricia trie in RLP format
    /// @param path the path (key) in the trie indicating the way starting at the root node and ending at the transaction
    /// @param rlpEncodedNodes an RLP encoded list of nodes of the Merkle branch, first element is the root node, last element the transaction
    /// @return 0: verification was successful
    ///         1: block is confirmed and unlocked, but the Merkle proof was invalid
    function verifyTransaction(uint feeInWei, bytes32 blockHash, uint8 noOfConfirmations, bytes memory rlpEncodedTx,
        bytes memory path, bytes memory rlpEncodedNodes) payable public returns (uint8) {
        uint8 result = verify(VERIFICATION_TYPE_TX, feeInWei, blockHash, noOfConfirmations, rlpEncodedTx, path, rlpEncodedNodes);
        emit VerifyTransaction(result);

        return result;
    }

    event VerifyReceipt(uint8 result);
    /// @dev Verifies if a receipt is included in the given block's receipts Merkle Patricia trie
    /// @param feeInWei the fee that is payed for the verification and must be equal to VERIFICATION_FEE_IN_WEI.
    /// @param blockHash the hash of the block that contains the Merkle root hash
    /// @param noOfConfirmations the required number of succeeding blocks needed for a block to be considered as confirmed
    /// @param rlpEncodedReceipt the receipt of the Merkle Patricia trie in RLP format
    /// @param path the path (key) in the trie indicating the way starting at the root node and ending at the receipt
    /// @param rlpEncodedNodes an RLP encoded list of nodes of the Merkle branch, first element is the root node, last element the receipt
    /// @return 0: verification was successful
    ///         1: block is confirmed and unlocked, but the Merkle proof was invalid
    function verifyReceipt(uint feeInWei, bytes32 blockHash, uint8 noOfConfirmations, bytes memory rlpEncodedReceipt,
        bytes memory path, bytes memory rlpEncodedNodes) payable public returns (uint8) {
        uint8 result = verify(VERIFICATION_TYPE_RECEIPT, feeInWei, blockHash, noOfConfirmations, rlpEncodedReceipt, path, rlpEncodedNodes);
        emit VerifyReceipt(result);

        return result;
    }

    event VerifyState(uint8 result);
    /// @dev   Verifies if a node is included in the given block's state Merkle Patricia trie
    /// @param feeInWei the fee that is payed for the verification and must be equal to VERIFICATION_FEE_IN_WEI.
    /// @param blockHash the hash of the block that contains the Merkle root hash
    /// @param noOfConfirmations the required number of succeeding blocks needed for a block to be considered as confirmed
    /// @param rlpEncodedState the node of the Merkle Patricia trie in RLP format
    /// @param path the path (key) in the trie indicating the way starting at the root node and ending at the node
    /// @param rlpEncodedNodes an RLP encoded list of nodes of the Merkle branch, first element is the root node, last element a state node
    /// @return 0: verification was successful
    ///         1: block is confirmed and unlocked, but the Merkle proof was invalid
    function verifyState(uint feeInWei, bytes32 blockHash, uint8 noOfConfirmations, bytes memory rlpEncodedState,
        bytes memory path, bytes memory rlpEncodedNodes) payable public returns (uint8) {
        uint8 result = verify(VERIFICATION_TYPE_STATE, feeInWei, blockHash, noOfConfirmations, rlpEncodedState, path, rlpEncodedNodes);
        emit VerifyState(result);

        return result;
    }

}
