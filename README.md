## Compile Contract
First convert the smart contract into an ABI file with 
```
solc --abi contracts/Testimonium.sol --out .
```
This creates a file called `Testimonium.abi` in the project root.

Now convert the ABI file into a Go file that we can import.
```
abigen --abi=Testimonium.abi --pkg=testimonium --out=Testimonium.go
```

### Frequent Errors
#### Wrong Compiler Version:
```
contracts/Testimonium.sol:1:1: Error: Source file requires different compiler version (current compiler is 0.5.9+commit.c68bc34e.Darwin.appleclang - note that nightly builds are considered to be strictly less than the released version
pragma solidity ^0.5.10;
^----------------------^
```
Make sure the solidity compiler is up-to-date with `solc --version`.
To update the solidity compiler on Mac, run `brew upgrade`
