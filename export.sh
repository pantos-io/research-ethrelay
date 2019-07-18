#!/bin/sh

# Create ABI file
solc --abi contracts/Testimonium.sol --overwrite -o ./abi

# Generate Go file and export to testimonium-cli project
abigen --abi=abi/Testimonium.abi --pkg=testimonium --out=${GOPATH}/src/github.com/pf92/testimonium-cli/testimonium/Testimonium.go
