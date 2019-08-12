#!/bin/sh

# Create ABI file
solc --abi contracts/Testimonium.sol --overwrite -o ./abi
solc --bin contracts/Testimonium.sol --overwrite -o ./bin

# Generate Go file and export to testimonium-cli project
abigen --bin=bin/Testimonium.bin --abi=abi/Testimonium.abi --pkg=testimonium --out=${GOPATH}/src/github.com/pf92/go-testimonium/testimonium/TestimoniumContract.go
