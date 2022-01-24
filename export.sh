#!/bin/sh

if [[ -z "${GOETHRELAY}" ]]; then
  echo "Warning: environment variable GOETHRELAY not set."
  echo "    e.g., 'export GOETHRELAY=~/code/../go-ethrelay'"
  exit 0
fi

EXPORT_PATH=${GOETHRELAY:-${GOPATH}/src/github.com/pantos-io/go-ethrelay}
echo "Exporting into ${EXPORT_PATH}..."

# Create ABI file
solc --optimize --abi contracts/Ethash.sol --overwrite -o ./abi --allow-paths *,
solc --optimize --bin contracts/Ethash.sol --overwrite -o ./bin --allow-paths *,
solc --optimize --abi contracts/Ethrelay.sol --overwrite -o ./abi --allow-paths *,
solc --optimize --bin contracts/Ethrelay.sol --overwrite -o ./bin --allow-paths *,

# Generate Go file and export to go-ethrelay project
abigen --bin=bin/Ethash.bin --abi=abi/Ethash.abi --pkg=ethashsol --out=${EXPORT_PATH}/ethereum/ethashsol/EthashContract.go
abigen --bin=bin/Ethrelay.bin --abi=abi/Ethrelay.abi --pkg=ethrelay --out=${EXPORT_PATH}/ethrelay/EthrelayContract.go

