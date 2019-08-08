# Testimonium

This project contains Ethereum smart contracts that enable the verification of transactions 
of a "target" blockchain on a different "verifying" blockchain in a trustless and decentralized way. 

This means a user can send a request to the verifying chain asking whether or not a certain transaction 
has been included in the target chain. The verifying chain then provides a reliable and truthful answer 
without relying on any third party trust.

The ability to verify transactions "across" different blockchains is vital to enable applications such as 
[cross-blockchain token transfers](https://dsg.tuwien.ac.at/projects/tast/pub/tast-white-paper-5.pdf).
> _Important: Testimonium is a research prototype. 
  It represents ongoing work conducted within the [TAST](https://dsg.tuwien.ac.at/projects/tast/) 
  research project. Use with care._


## Get Started
Testimonium is best enjoyed through the accompanying CLI tool, so go check it out [here](https://github.com/pf92/testimonium-cli).  
If you want to deploy the contracts manually, follow the steps below.

## Installation
The following guide will walk you through the deployment of Testimonium with a local blockchain (Ganache) 
as the verifying chain and the main Ethereum blockchain as the target blockchain.

### Prerequisites
You need to have the following tools installed:
* [Node](https://nodejs.org/en/)
* [Ganache](https://www.trufflesuite.com/ganache)

### Deployment
TODO: add ethash deployment info
1. Clone the repository: `git clone git@github.com:pf92/testimonium.git`

2. Change into the project directory: `cd testimonium/`
3. Install all dependencies: `npm install`  
4. Compile contracts: `truffle compile`
5. Deploy contracts: `truffle migrate --reset`
    
#### Frequent Errors
##### Wrong Compiler Version:
```
contracts/Testimonium.sol:1:1: Error: Source file requires different compiler version (current compiler is 0.5.9+commit.c68bc34e.Darwin.appleclang - note that nightly builds are considered to be strictly less than the released version
pragma solidity ^0.5.10;
^----------------------^
```
Make sure the solidity compiler is up-to-date with `solc --version`.
To update the solidity compiler on Mac, run `brew upgrade`

### Testing
Run the tests with `truffle test`.

### Export contract
To generate the Go contract file and export it to Testimonium-CLI project run `./export.sh`



## How it works
Users can query the Testimonium contract living on the verifying blockchain by sending requests like 
"Is transaction _tx_ in block _b_ part of the target blockchain?"
For the contract to answer the request it has to verify two things.
1. Verify that block _b_ is part of the target blockchain.
2. Verify that transaction _tx_ is part of block _b_.

The way this is achieved is the following:

#### 1. Verifying Blocks
To verify that a block _b_ is part of the target blockchain, the Testimonium contract on the verifying 
chain needs to know about the state of the target blockchain. 

For that, clients continuously submit block headers of the target chain to the Testimonium contract.
For each block header that the contract receives, it performs a kind of light validation:
   1. Verify that the block's parent already exists within the contract.
   2. Verify that the block's number is exactly incremented by one.
   3. Verify that the block's timestamp is correct.
   4. Verify that the block's gas limit is correct.
   
If these checks are successful, the contract accepts the block and stores it internally.
   
The contract does not verify the Proof of Work (PoW) for each block it receives, 
as validating the PoW for every block becomes very expensive. 
Instead, the contract assigns a dispute period to newly added blocks. Within this period, clients have the
possibility to dispute any block they think is illegal. 

In case of a dispute, the full PoW verification is carried out. 
If the verification fails, the block and all its successors are removed from the contract.
   
This way, the target chain is replicated within the Testimonium contract on the verifying chain, 
so that the contract can reliably provide an answer to the question whether or not a block _b_ is part 
of the target blockchain.

#### 2. Verifying Transactions
So now the contract knows whether or not a block _b_ is part of the target blockchain.
It now needs to verify that the transaction _tx_ is part of block _b_.

Whenever a client sends a transaction verification request to the contract, 
it needs to generate a [Merkle Proof](https://dsg.tuwien.ac.at/projects/tast/pub/tast-white-paper-5.pdf) first. 
The Merkle Proof is sent with the request and is then verified by the contract.
If the proof validation is successful, transaction _tx_ is part of block _b_. If the validation fails,
_tx_ is not part of _b_.

###
A more detailed explanation of the inner workings can be found [here](TODO link to white paper 6). 


## How to contribute
Testimonium is a research prototype. We welcome anyone to contribute.
File a bug report or submit feature requests through the [issue tracker](https://github.com/pf92/testimonium/issues). 
If you want to contribute feel free to submit a pull request.

## Acknowledgements
* The development of this prototype was funded by [Pantos](https://pantos.io/) within the [TAST](https://dsg.tuwien.ac.at/projects/tast/) research project.
* The original code for the Ethash contract comes from the [smartpool project](https://github.com/smartpool).
* The code for the RLPReader contract comes from [Hamdi Allam](https://github.com/hamdiallam/Solidity-RLP) with parts 
of it taken from [Andreas Olofsson](https://github.com/androlo/standard-contracts/blob/master/contracts/src/codec/RLP.sol).

## Licence
This project is licensed under the [MIT License](LICENSE).
