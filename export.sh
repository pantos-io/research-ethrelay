#!/bin/sh

if [[ -z "${GOTESTIMONIUM}" ]]; then
  echo "Warning: environment variable GOTESTIMONIUM not set."
  echo "    e.g., 'export GOTESTIMONIUM=~/code/../go-testimonium'"
  exit 0
fi

EXPORT_PATH=${GOTESTIMONIUM:-${GOPATH}/src/github.com/pantos-io/go-testimonium}
echo "Exporting into ${EXPORT_PATH}..."

# Create ABI file
solc --abi contracts/Ethash.sol --overwrite -o ./abi --allow-paths *,
solc --bin contracts/Ethash.sol --overwrite -o ./bin --allow-paths *,
solc --abi contracts/Testimonium.sol --overwrite -o ./abi --allow-paths *,
solc --bin contracts/Testimonium.sol --overwrite -o ./bin --allow-paths *,

# Generate Go file and export to go-testimonium project
abigen --bin=bin/Ethash.bin --abi=abi/Ethash.abi --pkg=ethash --out=${EXPORT_PATH}/ethereum/ethash/EthashContract.go
abigen --bin=bin/Testimonium.bin --abi=abi/Testimonium.abi --pkg=testimonium --out=${EXPORT_PATH}/testimonium/TestimoniumContract.go

