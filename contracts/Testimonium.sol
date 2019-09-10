pragma solidity ^0.5.10;

import "./TestimoniumCore.sol";

contract Testimonium is TestimoniumCore {

    uint constant ETH_IN_WEI = 1000000000000000000;
    uint constant REQUIRED_STAKE_PER_BLOCK = 1 * ETH_IN_WEI;
    uint constant VERIFICATION_FEE_IN_WEI = ETH_IN_WEI / 10;
    uint8 constant VERIFICATION_TYPE_TX = 1;
    uint8 constant VERIFICATION_TYPE_RECEIPT = 2;
    uint8 constant VERIFICATION_TYPE_STATE = 3;

    mapping (address => bytes32[]) blocksSubmittedByClient;
    mapping (address => uint) clientStake;

    /// @dev Deposits stake for a client allowing the client to submit block headers.
    function depositStake(uint amount) payable public {
        require(amount == msg.value);
        clientStake[msg.sender] = clientStake[msg.sender] + msg.value;
    }

    /// @dev Withdraws the stake of a client.
    /// The stake is reduced by the specified amount.
    function withdrawStake(uint amount) public {
        require(clientStake[msg.sender] >= amount);

        if (getUnusedStake(msg.sender) < amount) {
            require(cleanSubmitList(msg.sender), "stake not free");
            require(getUnusedStake(msg.sender) >= amount, "stake not free");
        }

        return withdraw(msg.sender, amount);

    }

    function submitBlock(bytes memory rlpHeader) public {
        // client must have enough stake to be able to submit blocks
        if(getUnusedStake(msg.sender) < REQUIRED_STAKE_PER_BLOCK) {
            // client has not enough unused stake -> check whether some of the blocks submitted by the client have left the lock period
            require(cleanSubmitList(msg.sender), "not enough stake");  // checks if at least one block has left the lock period
            require(getUnusedStake(msg.sender) >= REQUIRED_STAKE_PER_BLOCK, "not enough stake");
        }

        // client has enough stake -> submit header and add its hash to the client's list of submitted block headers
        bytes32 blockHash = submitHeader(rlpHeader, msg.sender);
        blocksSubmittedByClient[msg.sender].push(blockHash);
    }

    function disputeBlockHeader(bytes32 blockHash, uint[] memory dataSetLookup, uint[] memory witnessForLookup) public {
        address[] memory submittersToPunish = disputeBlock(blockHash, dataSetLookup, witnessForLookup);

        // if the PoW validation initiated by the dispute function was successful (i.e., the block is legal),
        // submittersToPunish will be empty and no further action will be carried out.
        for (uint i = 0; i < submittersToPunish.length; i++) {
            address client = submittersToPunish[i];
            clientStake[client] = clientStake[client] - REQUIRED_STAKE_PER_BLOCK;
        }
    }

    function verify(uint8 verificationType, uint feeInWei, bytes32 blockHash, uint8 noOfConfirmations, bytes memory rlpEncoded,
        bytes memory path, bytes memory rlpEncodedNodes) private returns (uint8) {

        require(feeInWei == msg.value && feeInWei == VERIFICATION_FEE_IN_WEI, "provided fee is not equal to expected fee");
        uint8 result;

        if (verificationType == VERIFICATION_TYPE_TX) {
            result = verifyTransaction(blockHash, noOfConfirmations, rlpEncoded, path, rlpEncodedNodes);
        }
        else if (verificationType == VERIFICATION_TYPE_RECEIPT) {
            result = verifyReceipt(blockHash, noOfConfirmations, rlpEncoded, path, rlpEncodedNodes);
        }
        else if (verificationType == VERIFICATION_TYPE_STATE) {
            result = verifyState(blockHash, noOfConfirmations, rlpEncoded, path, rlpEncodedNodes);
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

    function verifyTransaction(uint feeInWei, bytes32 blockHash, uint8 noOfConfirmations, bytes memory rlpEncodedTx,
        bytes memory path, bytes memory rlpEncodedNodes) payable public returns (uint8) {
        return verify(VERIFICATION_TYPE_TX, feeInWei, blockHash, noOfConfirmations, rlpEncodedTx, path, rlpEncodedNodes);
    }

    function verifyReceipt(uint feeInWei, bytes32 blockHash, uint8 noOfConfirmations, bytes memory rlpEncodedTx,
        bytes memory path, bytes memory rlpEncodedNodes) payable public returns (uint8) {
        return verify(VERIFICATION_TYPE_RECEIPT, feeInWei, blockHash, noOfConfirmations, rlpEncodedTx, path, rlpEncodedNodes);
    }

    function verifyState(uint feeInWei, bytes32 blockHash, uint8 noOfConfirmations, bytes memory rlpEncodedTx,
        bytes memory path, bytes memory rlpEncodedNodes) payable public returns (uint8) {
        return verify(VERIFICATION_TYPE_STATE, feeInWei, blockHash, noOfConfirmations, rlpEncodedTx, path, rlpEncodedNodes);
    }

    function getUnusedStake(address client) private view returns (uint) {
        return clientStake[client] - blocksSubmittedByClient[client].length * REQUIRED_STAKE_PER_BLOCK;
    }

    function cleanSubmitList(address client) private returns (bool) {
        bool deletedAtLeastOneElem = false;

        for (uint i = 0; i < blocksSubmittedByClient[client].length; ) {
            bytes32 blockHash = blocksSubmittedByClient[client][i];
            if (!isBlock(blockHash) || isUnlocked(blockHash)) {
                // block has been removed or is already unlocked (i.e., lock period has elapsed) -> remove hash from array
                uint lastElemPos = blocksSubmittedByClient[client].length - 1;
                blocksSubmittedByClient[client][i] = blocksSubmittedByClient[client][lastElemPos];  // copy last element to position i (overwrite current elem)
                blocksSubmittedByClient[client].length--;  // remove last element
                deletedAtLeastOneElem = true;
                // i is not increased, since we copied the last element to position i (otherwise the copied element would not be checked)
            }
            else {
                // nothing changed -> increase i and check next element
                i++;
            }
        }

        return deletedAtLeastOneElem;
    }

    function withdraw(address payable receiver, uint amount) private {
        clientStake[receiver] = clientStake[receiver] - amount;
        receiver.transfer(amount);
    }
}
