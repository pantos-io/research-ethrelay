#!/bin/sh

# Create ABI file
solc --abi contracts/Testimonium.sol --overwrite -o ./abi --allow-paths *,
solc --bin contracts/Testimonium.sol --overwrite -o ./bin --allow-paths *,

# Generate Go file and export to testimonium-cli project
abigen --bin=bin/Testimonium.bin --abi=abi/Testimonium.abi --pkg=testimonium --out=${GOPATH}/src/github.com/pantos-io/go-testimonium/testimonium/TestimoniumContract.go
