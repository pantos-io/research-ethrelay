pragma solidity ^0.5.10;

import "./TestimoniumCore.sol";

contract Testimonium is TestimoniumCore {

    uint constant ETH_IN_WEI = 1000000000000000000;
    uint constant REQUIRED_STAKE_PER_BLOCK = 1 * ETH_IN_WEI;

    mapping (address => bytes32[]) blocksSubmittedByClient;
    mapping (address => uint) clientStake;

    /// @dev Deposits stake for a client allowing the client to submit block headers.
    function depositStake(uint amount) payable public {
        require(amount == msg.value);
        clientStake[msg.sender] = clientStake[msg.sender] + msg.value;
    }

    /// @dev Withdraws the stake of a client.
    /// Once stake is withdrawn, the client cannot submit block headers anymore.
    function withdrawStake(uint amount) public {
        require(clientStake[msg.sender] >= amount);

        if (canWithdraw(msg.sender, amount)) {
            return withdraw(msg.sender, amount);
        }

        require(cleanSubmitList(msg.sender), "stake not free");
        require(canWithdraw(msg.sender, amount), "stake not free");
        return withdraw(msg.sender, amount);

    }

    function submitBlock(bytes memory rlpHeader) public {
        // client must have enough stake to be able to submit blocks
        if(canSubmitBlocks(msg.sender)) {
            return submitHeader(rlpHeader);
        }

        // check whether some of the blocks submitted by the client have left the lock period
        require(cleanSubmitList(msg.sender), "not enough stake");
        require(canSubmitBlocks(msg.sender), "not enough stake");
        return submitHeader(rlpHeader);
    }

    function disputeBlock() public {

    }

    function verifyTransaction() public {

    }

    function verifyReceipt() public {

    }

    function verifyState() public {

    }

    function canSubmitBlocks(address client) private returns (bool) {
        return clientStake[client] / REQUIRED_STAKE_PER_BLOCK > blocksSubmittedByClient[client].length;
    }

    function canWithdraw(address client, uint amount) private returns (bool) {
        uint unlockedStake = clientStake[client] - blocksSubmittedByClient[client].length * REQUIRED_STAKE_PER_BLOCK;
        return unlockedStake >= amount;
    }

    function cleanSubmitList(address client) private returns (bool) {
        return false;
    }

    function withdraw(address payable receiver, uint amount) private {
        clientStake[receiver] = clientStake[receiver] - amount;
        receiver.transfer(amount);
    }
}
