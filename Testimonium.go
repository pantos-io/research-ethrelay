// Code generated - DO NOT EDIT.
// This file is a generated binding and any manual changes will be lost.

package testimonium

import (
	"math/big"
	"strings"

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/event"
)

// Reference imports to suppress errors if they are not otherwise used.
var (
	_ = big.NewInt
	_ = strings.NewReader
	_ = ethereum.NotFound
	_ = abi.U256
	_ = bind.Bind
	_ = common.Big1
	_ = types.BloomLookup
	_ = event.NewSubscription
)

// TestimoniumABI is the input ABI used to generate the binding from.
const TestimoniumABI = "[{\"constant\":true,\"inputs\":[{\"name\":\"blockHash\",\"type\":\"bytes32\"}],\"name\":\"isUnlocked\",\"outputs\":[{\"name\":\"\",\"type\":\"bool\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"hash\",\"type\":\"bytes32\"}],\"name\":\"isBlock\",\"outputs\":[{\"name\":\"\",\"type\":\"bool\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"blockHash\",\"type\":\"bytes32\"}],\"name\":\"disputeBlock\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"hash\",\"type\":\"bytes32\"}],\"name\":\"getBlock\",\"outputs\":[{\"name\":\"\",\"type\":\"bytes32\"},{\"name\":\"\",\"type\":\"uint256\"},{\"name\":\"\",\"type\":\"uint256\"},{\"name\":\"\",\"type\":\"uint256\"},{\"name\":\"\",\"type\":\"uint256\"},{\"name\":\"\",\"type\":\"uint256\"},{\"name\":\"\",\"type\":\"bytes32\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"txHash\",\"type\":\"bytes32\"},{\"name\":\"requested\",\"type\":\"bytes32\"},{\"name\":\"noOfConfirmations\",\"type\":\"uint8\"}],\"name\":\"verifyTransaction\",\"outputs\":[{\"name\":\"\",\"type\":\"bool\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"index\",\"type\":\"uint256\"}],\"name\":\"getBlockHashOfEndpoint\",\"outputs\":[{\"name\":\"\",\"type\":\"bytes32\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"\",\"type\":\"bytes32\"}],\"name\":\"headers\",\"outputs\":[{\"name\":\"parent\",\"type\":\"bytes32\"},{\"name\":\"stateRoot\",\"type\":\"bytes32\"},{\"name\":\"transactionsRoot\",\"type\":\"bytes32\"},{\"name\":\"receiptsRoot\",\"type\":\"bytes32\"},{\"name\":\"blockNumber\",\"type\":\"uint256\"},{\"name\":\"rlpHeaderHashWithoutNonce\",\"type\":\"bytes32\"},{\"name\":\"nonce\",\"type\":\"uint256\"},{\"name\":\"lockedUntil\",\"type\":\"uint256\"},{\"name\":\"totalDifficulty\",\"type\":\"uint256\"},{\"name\":\"orderedIndex\",\"type\":\"uint256\"},{\"name\":\"iterableIndex\",\"type\":\"uint256\"},{\"name\":\"latestFork\",\"type\":\"bytes32\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_rlpHeader\",\"type\":\"bytes\"}],\"name\":\"submitHeader\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[],\"name\":\"getNoOfForks\",\"outputs\":[{\"name\":\"\",\"type\":\"uint256\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"inputs\":[{\"name\":\"_rlpHeader\",\"type\":\"bytes\"},{\"name\":\"totalDifficulty\",\"type\":\"uint256\"}],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"constructor\"},{\"anonymous\":false,\"inputs\":[{\"indexed\":false,\"name\":\"hash\",\"type\":\"bytes32\"},{\"indexed\":false,\"name\":\"hashWithoutNonce\",\"type\":\"bytes32\"},{\"indexed\":false,\"name\":\"nonce\",\"type\":\"uint256\"},{\"indexed\":false,\"name\":\"parent\",\"type\":\"bytes32\"}],\"name\":\"SubmitBlockHeader\",\"type\":\"event\"}]"

// Testimonium is an auto generated Go binding around an Ethereum contract.
type Testimonium struct {
	TestimoniumCaller     // Read-only binding to the contract
	TestimoniumTransactor // Write-only binding to the contract
	TestimoniumFilterer   // Log filterer for contract events
}

// TestimoniumCaller is an auto generated read-only Go binding around an Ethereum contract.
type TestimoniumCaller struct {
	contract *bind.BoundContract // Generic contract wrapper for the low level calls
}

// TestimoniumTransactor is an auto generated write-only Go binding around an Ethereum contract.
type TestimoniumTransactor struct {
	contract *bind.BoundContract // Generic contract wrapper for the low level calls
}

// TestimoniumFilterer is an auto generated log filtering Go binding around an Ethereum contract events.
type TestimoniumFilterer struct {
	contract *bind.BoundContract // Generic contract wrapper for the low level calls
}

// TestimoniumSession is an auto generated Go binding around an Ethereum contract,
// with pre-set call and transact options.
type TestimoniumSession struct {
	Contract     *Testimonium      // Generic contract binding to set the session for
	CallOpts     bind.CallOpts     // Call options to use throughout this session
	TransactOpts bind.TransactOpts // Transaction auth options to use throughout this session
}

// TestimoniumCallerSession is an auto generated read-only Go binding around an Ethereum contract,
// with pre-set call options.
type TestimoniumCallerSession struct {
	Contract *TestimoniumCaller // Generic contract caller binding to set the session for
	CallOpts bind.CallOpts      // Call options to use throughout this session
}

// TestimoniumTransactorSession is an auto generated write-only Go binding around an Ethereum contract,
// with pre-set transact options.
type TestimoniumTransactorSession struct {
	Contract     *TestimoniumTransactor // Generic contract transactor binding to set the session for
	TransactOpts bind.TransactOpts      // Transaction auth options to use throughout this session
}

// TestimoniumRaw is an auto generated low-level Go binding around an Ethereum contract.
type TestimoniumRaw struct {
	Contract *Testimonium // Generic contract binding to access the raw methods on
}

// TestimoniumCallerRaw is an auto generated low-level read-only Go binding around an Ethereum contract.
type TestimoniumCallerRaw struct {
	Contract *TestimoniumCaller // Generic read-only contract binding to access the raw methods on
}

// TestimoniumTransactorRaw is an auto generated low-level write-only Go binding around an Ethereum contract.
type TestimoniumTransactorRaw struct {
	Contract *TestimoniumTransactor // Generic write-only contract binding to access the raw methods on
}

// NewTestimonium creates a new instance of Testimonium, bound to a specific deployed contract.
func NewTestimonium(address common.Address, backend bind.ContractBackend) (*Testimonium, error) {
	contract, err := bindTestimonium(address, backend, backend, backend)
	if err != nil {
		return nil, err
	}
	return &Testimonium{TestimoniumCaller: TestimoniumCaller{contract: contract}, TestimoniumTransactor: TestimoniumTransactor{contract: contract}, TestimoniumFilterer: TestimoniumFilterer{contract: contract}}, nil
}

// NewTestimoniumCaller creates a new read-only instance of Testimonium, bound to a specific deployed contract.
func NewTestimoniumCaller(address common.Address, caller bind.ContractCaller) (*TestimoniumCaller, error) {
	contract, err := bindTestimonium(address, caller, nil, nil)
	if err != nil {
		return nil, err
	}
	return &TestimoniumCaller{contract: contract}, nil
}

// NewTestimoniumTransactor creates a new write-only instance of Testimonium, bound to a specific deployed contract.
func NewTestimoniumTransactor(address common.Address, transactor bind.ContractTransactor) (*TestimoniumTransactor, error) {
	contract, err := bindTestimonium(address, nil, transactor, nil)
	if err != nil {
		return nil, err
	}
	return &TestimoniumTransactor{contract: contract}, nil
}

// NewTestimoniumFilterer creates a new log filterer instance of Testimonium, bound to a specific deployed contract.
func NewTestimoniumFilterer(address common.Address, filterer bind.ContractFilterer) (*TestimoniumFilterer, error) {
	contract, err := bindTestimonium(address, nil, nil, filterer)
	if err != nil {
		return nil, err
	}
	return &TestimoniumFilterer{contract: contract}, nil
}

// bindTestimonium binds a generic wrapper to an already deployed contract.
func bindTestimonium(address common.Address, caller bind.ContractCaller, transactor bind.ContractTransactor, filterer bind.ContractFilterer) (*bind.BoundContract, error) {
	parsed, err := abi.JSON(strings.NewReader(TestimoniumABI))
	if err != nil {
		return nil, err
	}
	return bind.NewBoundContract(address, parsed, caller, transactor, filterer), nil
}

// Call invokes the (constant) contract method with params as input values and
// sets the output to result. The result type might be a single field for simple
// returns, a slice of interfaces for anonymous returns and a struct for named
// returns.
func (_Testimonium *TestimoniumRaw) Call(opts *bind.CallOpts, result interface{}, method string, params ...interface{}) error {
	return _Testimonium.Contract.TestimoniumCaller.contract.Call(opts, result, method, params...)
}

// Transfer initiates a plain transaction to move funds to the contract, calling
// its default method if one is available.
func (_Testimonium *TestimoniumRaw) Transfer(opts *bind.TransactOpts) (*types.Transaction, error) {
	return _Testimonium.Contract.TestimoniumTransactor.contract.Transfer(opts)
}

// Transact invokes the (paid) contract method with params as input values.
func (_Testimonium *TestimoniumRaw) Transact(opts *bind.TransactOpts, method string, params ...interface{}) (*types.Transaction, error) {
	return _Testimonium.Contract.TestimoniumTransactor.contract.Transact(opts, method, params...)
}

// Call invokes the (constant) contract method with params as input values and
// sets the output to result. The result type might be a single field for simple
// returns, a slice of interfaces for anonymous returns and a struct for named
// returns.
func (_Testimonium *TestimoniumCallerRaw) Call(opts *bind.CallOpts, result interface{}, method string, params ...interface{}) error {
	return _Testimonium.Contract.contract.Call(opts, result, method, params...)
}

// Transfer initiates a plain transaction to move funds to the contract, calling
// its default method if one is available.
func (_Testimonium *TestimoniumTransactorRaw) Transfer(opts *bind.TransactOpts) (*types.Transaction, error) {
	return _Testimonium.Contract.contract.Transfer(opts)
}

// Transact invokes the (paid) contract method with params as input values.
func (_Testimonium *TestimoniumTransactorRaw) Transact(opts *bind.TransactOpts, method string, params ...interface{}) (*types.Transaction, error) {
	return _Testimonium.Contract.contract.Transact(opts, method, params...)
}

// GetBlock is a free data retrieval call binding the contract method 0x664a4a05.
//
// Solidity: function getBlock(bytes32 hash) constant returns(bytes32, uint256, uint256, uint256, uint256, uint256, bytes32)
func (_Testimonium *TestimoniumCaller) GetBlock(opts *bind.CallOpts, hash [32]byte) ([32]byte, *big.Int, *big.Int, *big.Int, *big.Int, *big.Int, [32]byte, error) {
	var (
		ret0 = new([32]byte)
		ret1 = new(*big.Int)
		ret2 = new(*big.Int)
		ret3 = new(*big.Int)
		ret4 = new(*big.Int)
		ret5 = new(*big.Int)
		ret6 = new([32]byte)
	)
	out := &[]interface{}{
		ret0,
		ret1,
		ret2,
		ret3,
		ret4,
		ret5,
		ret6,
	}
	err := _Testimonium.contract.Call(opts, out, "getBlock", hash)
	return *ret0, *ret1, *ret2, *ret3, *ret4, *ret5, *ret6, err
}

// GetBlock is a free data retrieval call binding the contract method 0x664a4a05.
//
// Solidity: function getBlock(bytes32 hash) constant returns(bytes32, uint256, uint256, uint256, uint256, uint256, bytes32)
func (_Testimonium *TestimoniumSession) GetBlock(hash [32]byte) ([32]byte, *big.Int, *big.Int, *big.Int, *big.Int, *big.Int, [32]byte, error) {
	return _Testimonium.Contract.GetBlock(&_Testimonium.CallOpts, hash)
}

// GetBlock is a free data retrieval call binding the contract method 0x664a4a05.
//
// Solidity: function getBlock(bytes32 hash) constant returns(bytes32, uint256, uint256, uint256, uint256, uint256, bytes32)
func (_Testimonium *TestimoniumCallerSession) GetBlock(hash [32]byte) ([32]byte, *big.Int, *big.Int, *big.Int, *big.Int, *big.Int, [32]byte, error) {
	return _Testimonium.Contract.GetBlock(&_Testimonium.CallOpts, hash)
}

// GetBlockHashOfEndpoint is a free data retrieval call binding the contract method 0x84bc44b3.
//
// Solidity: function getBlockHashOfEndpoint(uint256 index) constant returns(bytes32)
func (_Testimonium *TestimoniumCaller) GetBlockHashOfEndpoint(opts *bind.CallOpts, index *big.Int) ([32]byte, error) {
	var (
		ret0 = new([32]byte)
	)
	out := ret0
	err := _Testimonium.contract.Call(opts, out, "getBlockHashOfEndpoint", index)
	return *ret0, err
}

// GetBlockHashOfEndpoint is a free data retrieval call binding the contract method 0x84bc44b3.
//
// Solidity: function getBlockHashOfEndpoint(uint256 index) constant returns(bytes32)
func (_Testimonium *TestimoniumSession) GetBlockHashOfEndpoint(index *big.Int) ([32]byte, error) {
	return _Testimonium.Contract.GetBlockHashOfEndpoint(&_Testimonium.CallOpts, index)
}

// GetBlockHashOfEndpoint is a free data retrieval call binding the contract method 0x84bc44b3.
//
// Solidity: function getBlockHashOfEndpoint(uint256 index) constant returns(bytes32)
func (_Testimonium *TestimoniumCallerSession) GetBlockHashOfEndpoint(index *big.Int) ([32]byte, error) {
	return _Testimonium.Contract.GetBlockHashOfEndpoint(&_Testimonium.CallOpts, index)
}

// GetNoOfForks is a free data retrieval call binding the contract method 0xfbb5df38.
//
// Solidity: function getNoOfForks() constant returns(uint256)
func (_Testimonium *TestimoniumCaller) GetNoOfForks(opts *bind.CallOpts) (*big.Int, error) {
	var (
		ret0 = new(*big.Int)
	)
	out := ret0
	err := _Testimonium.contract.Call(opts, out, "getNoOfForks")
	return *ret0, err
}

// GetNoOfForks is a free data retrieval call binding the contract method 0xfbb5df38.
//
// Solidity: function getNoOfForks() constant returns(uint256)
func (_Testimonium *TestimoniumSession) GetNoOfForks() (*big.Int, error) {
	return _Testimonium.Contract.GetNoOfForks(&_Testimonium.CallOpts)
}

// GetNoOfForks is a free data retrieval call binding the contract method 0xfbb5df38.
//
// Solidity: function getNoOfForks() constant returns(uint256)
func (_Testimonium *TestimoniumCallerSession) GetNoOfForks() (*big.Int, error) {
	return _Testimonium.Contract.GetNoOfForks(&_Testimonium.CallOpts)
}

// Headers is a free data retrieval call binding the contract method 0x9e7f2700.
//
// Solidity: function headers(bytes32 ) constant returns(bytes32 parent, bytes32 stateRoot, bytes32 transactionsRoot, bytes32 receiptsRoot, uint256 blockNumber, bytes32 rlpHeaderHashWithoutNonce, uint256 nonce, uint256 lockedUntil, uint256 totalDifficulty, uint256 orderedIndex, uint256 iterableIndex, bytes32 latestFork)
func (_Testimonium *TestimoniumCaller) Headers(opts *bind.CallOpts, arg0 [32]byte) (struct {
	Parent                    [32]byte
	StateRoot                 [32]byte
	TransactionsRoot          [32]byte
	ReceiptsRoot              [32]byte
	BlockNumber               *big.Int
	RlpHeaderHashWithoutNonce [32]byte
	Nonce                     *big.Int
	LockedUntil               *big.Int
	TotalDifficulty           *big.Int
	OrderedIndex              *big.Int
	IterableIndex             *big.Int
	LatestFork                [32]byte
}, error) {
	ret := new(struct {
		Parent                    [32]byte
		StateRoot                 [32]byte
		TransactionsRoot          [32]byte
		ReceiptsRoot              [32]byte
		BlockNumber               *big.Int
		RlpHeaderHashWithoutNonce [32]byte
		Nonce                     *big.Int
		LockedUntil               *big.Int
		TotalDifficulty           *big.Int
		OrderedIndex              *big.Int
		IterableIndex             *big.Int
		LatestFork                [32]byte
	})
	out := ret
	err := _Testimonium.contract.Call(opts, out, "headers", arg0)
	return *ret, err
}

// Headers is a free data retrieval call binding the contract method 0x9e7f2700.
//
// Solidity: function headers(bytes32 ) constant returns(bytes32 parent, bytes32 stateRoot, bytes32 transactionsRoot, bytes32 receiptsRoot, uint256 blockNumber, bytes32 rlpHeaderHashWithoutNonce, uint256 nonce, uint256 lockedUntil, uint256 totalDifficulty, uint256 orderedIndex, uint256 iterableIndex, bytes32 latestFork)
func (_Testimonium *TestimoniumSession) Headers(arg0 [32]byte) (struct {
	Parent                    [32]byte
	StateRoot                 [32]byte
	TransactionsRoot          [32]byte
	ReceiptsRoot              [32]byte
	BlockNumber               *big.Int
	RlpHeaderHashWithoutNonce [32]byte
	Nonce                     *big.Int
	LockedUntil               *big.Int
	TotalDifficulty           *big.Int
	OrderedIndex              *big.Int
	IterableIndex             *big.Int
	LatestFork                [32]byte
}, error) {
	return _Testimonium.Contract.Headers(&_Testimonium.CallOpts, arg0)
}

// Headers is a free data retrieval call binding the contract method 0x9e7f2700.
//
// Solidity: function headers(bytes32 ) constant returns(bytes32 parent, bytes32 stateRoot, bytes32 transactionsRoot, bytes32 receiptsRoot, uint256 blockNumber, bytes32 rlpHeaderHashWithoutNonce, uint256 nonce, uint256 lockedUntil, uint256 totalDifficulty, uint256 orderedIndex, uint256 iterableIndex, bytes32 latestFork)
func (_Testimonium *TestimoniumCallerSession) Headers(arg0 [32]byte) (struct {
	Parent                    [32]byte
	StateRoot                 [32]byte
	TransactionsRoot          [32]byte
	ReceiptsRoot              [32]byte
	BlockNumber               *big.Int
	RlpHeaderHashWithoutNonce [32]byte
	Nonce                     *big.Int
	LockedUntil               *big.Int
	TotalDifficulty           *big.Int
	OrderedIndex              *big.Int
	IterableIndex             *big.Int
	LatestFork                [32]byte
}, error) {
	return _Testimonium.Contract.Headers(&_Testimonium.CallOpts, arg0)
}

// IsBlock is a free data retrieval call binding the contract method 0x528a309f.
//
// Solidity: function isBlock(bytes32 hash) constant returns(bool)
func (_Testimonium *TestimoniumCaller) IsBlock(opts *bind.CallOpts, hash [32]byte) (bool, error) {
	var (
		ret0 = new(bool)
	)
	out := ret0
	err := _Testimonium.contract.Call(opts, out, "isBlock", hash)
	return *ret0, err
}

// IsBlock is a free data retrieval call binding the contract method 0x528a309f.
//
// Solidity: function isBlock(bytes32 hash) constant returns(bool)
func (_Testimonium *TestimoniumSession) IsBlock(hash [32]byte) (bool, error) {
	return _Testimonium.Contract.IsBlock(&_Testimonium.CallOpts, hash)
}

// IsBlock is a free data retrieval call binding the contract method 0x528a309f.
//
// Solidity: function isBlock(bytes32 hash) constant returns(bool)
func (_Testimonium *TestimoniumCallerSession) IsBlock(hash [32]byte) (bool, error) {
	return _Testimonium.Contract.IsBlock(&_Testimonium.CallOpts, hash)
}

// IsUnlocked is a free data retrieval call binding the contract method 0x3dadc1e1.
//
// Solidity: function isUnlocked(bytes32 blockHash) constant returns(bool)
func (_Testimonium *TestimoniumCaller) IsUnlocked(opts *bind.CallOpts, blockHash [32]byte) (bool, error) {
	var (
		ret0 = new(bool)
	)
	out := ret0
	err := _Testimonium.contract.Call(opts, out, "isUnlocked", blockHash)
	return *ret0, err
}

// IsUnlocked is a free data retrieval call binding the contract method 0x3dadc1e1.
//
// Solidity: function isUnlocked(bytes32 blockHash) constant returns(bool)
func (_Testimonium *TestimoniumSession) IsUnlocked(blockHash [32]byte) (bool, error) {
	return _Testimonium.Contract.IsUnlocked(&_Testimonium.CallOpts, blockHash)
}

// IsUnlocked is a free data retrieval call binding the contract method 0x3dadc1e1.
//
// Solidity: function isUnlocked(bytes32 blockHash) constant returns(bool)
func (_Testimonium *TestimoniumCallerSession) IsUnlocked(blockHash [32]byte) (bool, error) {
	return _Testimonium.Contract.IsUnlocked(&_Testimonium.CallOpts, blockHash)
}

// VerifyTransaction is a free data retrieval call binding the contract method 0x8474491f.
//
// Solidity: function verifyTransaction(bytes32 txHash, bytes32 requested, uint8 noOfConfirmations) constant returns(bool)
func (_Testimonium *TestimoniumCaller) VerifyTransaction(opts *bind.CallOpts, txHash [32]byte, requested [32]byte, noOfConfirmations uint8) (bool, error) {
	var (
		ret0 = new(bool)
	)
	out := ret0
	err := _Testimonium.contract.Call(opts, out, "verifyTransaction", txHash, requested, noOfConfirmations)
	return *ret0, err
}

// VerifyTransaction is a free data retrieval call binding the contract method 0x8474491f.
//
// Solidity: function verifyTransaction(bytes32 txHash, bytes32 requested, uint8 noOfConfirmations) constant returns(bool)
func (_Testimonium *TestimoniumSession) VerifyTransaction(txHash [32]byte, requested [32]byte, noOfConfirmations uint8) (bool, error) {
	return _Testimonium.Contract.VerifyTransaction(&_Testimonium.CallOpts, txHash, requested, noOfConfirmations)
}

// VerifyTransaction is a free data retrieval call binding the contract method 0x8474491f.
//
// Solidity: function verifyTransaction(bytes32 txHash, bytes32 requested, uint8 noOfConfirmations) constant returns(bool)
func (_Testimonium *TestimoniumCallerSession) VerifyTransaction(txHash [32]byte, requested [32]byte, noOfConfirmations uint8) (bool, error) {
	return _Testimonium.Contract.VerifyTransaction(&_Testimonium.CallOpts, txHash, requested, noOfConfirmations)
}

// DisputeBlock is a paid mutator transaction binding the contract method 0x5b3f8a98.
//
// Solidity: function disputeBlock(bytes32 blockHash) returns()
func (_Testimonium *TestimoniumTransactor) DisputeBlock(opts *bind.TransactOpts, blockHash [32]byte) (*types.Transaction, error) {
	return _Testimonium.contract.Transact(opts, "disputeBlock", blockHash)
}

// DisputeBlock is a paid mutator transaction binding the contract method 0x5b3f8a98.
//
// Solidity: function disputeBlock(bytes32 blockHash) returns()
func (_Testimonium *TestimoniumSession) DisputeBlock(blockHash [32]byte) (*types.Transaction, error) {
	return _Testimonium.Contract.DisputeBlock(&_Testimonium.TransactOpts, blockHash)
}

// DisputeBlock is a paid mutator transaction binding the contract method 0x5b3f8a98.
//
// Solidity: function disputeBlock(bytes32 blockHash) returns()
func (_Testimonium *TestimoniumTransactorSession) DisputeBlock(blockHash [32]byte) (*types.Transaction, error) {
	return _Testimonium.Contract.DisputeBlock(&_Testimonium.TransactOpts, blockHash)
}

// SubmitHeader is a paid mutator transaction binding the contract method 0xc565ba10.
//
// Solidity: function submitHeader(bytes _rlpHeader) returns()
func (_Testimonium *TestimoniumTransactor) SubmitHeader(opts *bind.TransactOpts, _rlpHeader []byte) (*types.Transaction, error) {
	return _Testimonium.contract.Transact(opts, "submitHeader", _rlpHeader)
}

// SubmitHeader is a paid mutator transaction binding the contract method 0xc565ba10.
//
// Solidity: function submitHeader(bytes _rlpHeader) returns()
func (_Testimonium *TestimoniumSession) SubmitHeader(_rlpHeader []byte) (*types.Transaction, error) {
	return _Testimonium.Contract.SubmitHeader(&_Testimonium.TransactOpts, _rlpHeader)
}

// SubmitHeader is a paid mutator transaction binding the contract method 0xc565ba10.
//
// Solidity: function submitHeader(bytes _rlpHeader) returns()
func (_Testimonium *TestimoniumTransactorSession) SubmitHeader(_rlpHeader []byte) (*types.Transaction, error) {
	return _Testimonium.Contract.SubmitHeader(&_Testimonium.TransactOpts, _rlpHeader)
}

// TestimoniumSubmitBlockHeaderIterator is returned from FilterSubmitBlockHeader and is used to iterate over the raw logs and unpacked data for SubmitBlockHeader events raised by the Testimonium contract.
type TestimoniumSubmitBlockHeaderIterator struct {
	Event *TestimoniumSubmitBlockHeader // Event containing the contract specifics and raw log

	contract *bind.BoundContract // Generic contract to use for unpacking event data
	event    string              // Event name to use for unpacking event data

	logs chan types.Log        // Log channel receiving the found contract events
	sub  ethereum.Subscription // Subscription for errors, completion and termination
	done bool                  // Whether the subscription completed delivering logs
	fail error                 // Occurred error to stop iteration
}

// Next advances the iterator to the subsequent event, returning whether there
// are any more events found. In case of a retrieval or parsing error, false is
// returned and Error() can be queried for the exact failure.
func (it *TestimoniumSubmitBlockHeaderIterator) Next() bool {
	// If the iterator failed, stop iterating
	if it.fail != nil {
		return false
	}
	// If the iterator completed, deliver directly whatever's available
	if it.done {
		select {
		case log := <-it.logs:
			it.Event = new(TestimoniumSubmitBlockHeader)
			if err := it.contract.UnpackLog(it.Event, it.event, log); err != nil {
				it.fail = err
				return false
			}
			it.Event.Raw = log
			return true

		default:
			return false
		}
	}
	// Iterator still in progress, wait for either a data or an error event
	select {
	case log := <-it.logs:
		it.Event = new(TestimoniumSubmitBlockHeader)
		if err := it.contract.UnpackLog(it.Event, it.event, log); err != nil {
			it.fail = err
			return false
		}
		it.Event.Raw = log
		return true

	case err := <-it.sub.Err():
		it.done = true
		it.fail = err
		return it.Next()
	}
}

// Error returns any retrieval or parsing error occurred during filtering.
func (it *TestimoniumSubmitBlockHeaderIterator) Error() error {
	return it.fail
}

// Close terminates the iteration process, releasing any pending underlying
// resources.
func (it *TestimoniumSubmitBlockHeaderIterator) Close() error {
	it.sub.Unsubscribe()
	return nil
}

// TestimoniumSubmitBlockHeader represents a SubmitBlockHeader event raised by the Testimonium contract.
type TestimoniumSubmitBlockHeader struct {
	Hash             [32]byte
	HashWithoutNonce [32]byte
	Nonce            *big.Int
	Parent           [32]byte
	Raw              types.Log // Blockchain specific contextual infos
}

// FilterSubmitBlockHeader is a free log retrieval operation binding the contract event 0x7583fb6e9684405668d44c92639440a022838246fba8f0e36374203764be2cb2.
//
// Solidity: event SubmitBlockHeader(bytes32 hash, bytes32 hashWithoutNonce, uint256 nonce, bytes32 parent)
func (_Testimonium *TestimoniumFilterer) FilterSubmitBlockHeader(opts *bind.FilterOpts) (*TestimoniumSubmitBlockHeaderIterator, error) {

	logs, sub, err := _Testimonium.contract.FilterLogs(opts, "SubmitBlockHeader")
	if err != nil {
		return nil, err
	}
	return &TestimoniumSubmitBlockHeaderIterator{contract: _Testimonium.contract, event: "SubmitBlockHeader", logs: logs, sub: sub}, nil
}

// WatchSubmitBlockHeader is a free log subscription operation binding the contract event 0x7583fb6e9684405668d44c92639440a022838246fba8f0e36374203764be2cb2.
//
// Solidity: event SubmitBlockHeader(bytes32 hash, bytes32 hashWithoutNonce, uint256 nonce, bytes32 parent)
func (_Testimonium *TestimoniumFilterer) WatchSubmitBlockHeader(opts *bind.WatchOpts, sink chan<- *TestimoniumSubmitBlockHeader) (event.Subscription, error) {

	logs, sub, err := _Testimonium.contract.WatchLogs(opts, "SubmitBlockHeader")
	if err != nil {
		return nil, err
	}
	return event.NewSubscription(func(quit <-chan struct{}) error {
		defer sub.Unsubscribe()
		for {
			select {
			case log := <-logs:
				// New log arrived, parse the event and forward to the user
				event := new(TestimoniumSubmitBlockHeader)
				if err := _Testimonium.contract.UnpackLog(event, "SubmitBlockHeader", log); err != nil {
					return err
				}
				event.Raw = log

				select {
				case sink <- event:
				case err := <-sub.Err():
					return err
				case <-quit:
					return nil
				}
			case err := <-sub.Err():
				return err
			case <-quit:
				return nil
			}
		}
	}), nil
}

// ParseSubmitBlockHeader is a log parse operation binding the contract event 0x7583fb6e9684405668d44c92639440a022838246fba8f0e36374203764be2cb2.
//
// Solidity: event SubmitBlockHeader(bytes32 hash, bytes32 hashWithoutNonce, uint256 nonce, bytes32 parent)
func (_Testimonium *TestimoniumFilterer) ParseSubmitBlockHeader(log types.Log) (*TestimoniumSubmitBlockHeader, error) {
	event := new(TestimoniumSubmitBlockHeader)
	if err := _Testimonium.contract.UnpackLog(event, "SubmitBlockHeader", log); err != nil {
		return nil, err
	}
	return event, nil
}
