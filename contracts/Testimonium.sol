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

    function disputeBlock() public {

    }

    function verifyTransaction() public {

    }

    function verifyReceipt() public {

    }

    function verifyState() public {

    }

    function getUnusedStake(address client) private returns (uint) {
        return clientStake[client] - blocksSubmittedByClient[client].length * REQUIRED_STAKE_PER_BLOCK;
    }

    function cleanSubmitList(address client) private returns (bool) {
        return false;
    }

    function withdraw(address payable receiver, uint amount) private {
        clientStake[receiver] = clientStake[receiver] - amount;
        receiver.transfer(amount);
    }
}
