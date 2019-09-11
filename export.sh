#!/bin/sh

# Create ABI file
solc --abi contracts/Ethash.sol --overwrite -o ./abi --allow-paths *,
solc --bin contracts/Ethash.sol --overwrite -o ./bin --allow-paths *,
solc --abi contracts/Testimonium.sol --overwrite -o ./abi --allow-paths *,
solc --bin contracts/Testimonium.sol --overwrite -o ./bin --allow-paths *,

# Generate Go file and export to go-testimonium project
abigen --bin=bin/Ethash.bin --abi=abi/Ethash.abi --pkg=ethash --out=${GOPATH}/src/github.com/pantos-io/go-testimonium/ethereum/ethash/EthashContract.go
abigen --bin=bin/Testimonium.bin --abi=abi/Testimonium.abi --pkg=testimonium --out=${GOPATH}/src/github.com/pantos-io/go-testimonium/testimonium/TestimoniumContract.go

