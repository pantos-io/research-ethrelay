pragma solidity >=0.7.0 <0.9.0;

import "./SHA3_512.sol";

contract Ethash {

    uint constant EPOCH_LENGTH = 30000;   // blocks per epoch

    SHA3_512 private SHA3_contract;

    constructor(address SHA3_address) {
        SHA3_contract = SHA3_512 (SHA3_address);
    }

    function fnv( uint v1, uint v2 ) pure internal returns(uint) {
        return ((v1*0x01000193) ^ v2) & 0xFFFFFFFF;
    }

    function computeCacheRoot( uint index,
        uint indexInElementsArray,
        uint[] memory elements,
        uint[] memory witness,
        uint branchSize ) pure private returns(uint) {

        uint leaf = computeLeaf(elements, indexInElementsArray) & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;

        uint left;
        uint right;
        uint node;
        bool oddBranchSize = (branchSize % 2) > 0;

        assembly {
            branchSize := div(branchSize,2)
        //branchSize /= 2;
        }
        uint witnessIndex = indexInElementsArray * branchSize;
        if( oddBranchSize ) witnessIndex += indexInElementsArray;

        uint depth;
        for( depth = 0 ; depth < branchSize ; depth++ ) {
            assembly {
                node := mload(add(add(witness,0x20),mul(add(depth,witnessIndex),0x20)))
            }
            //node  = witness[witnessIndex + depth] & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
            if( index & 0x1 == 0 ) {
                left = leaf;
                assembly{
                    right := and(node,0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)
                }

            }
            else {
                assembly{
                    left := and(node,0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)
                }
                right = leaf;
            }

            leaf = uint(keccak256(abi.encodePacked(left,right))) & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
            assembly {
                index := div(index,2)
            }

            //node  = witness[witnessIndex + depth] / (2**128);
            if( index & 0x1 == 0 ) {
                left = leaf;
                assembly{
                    right := div(node,0x100000000000000000000000000000000)
                }
            }
            else {
                assembly {
                    left := div(node,0x100000000000000000000000000000000)
                }
                right = leaf;
            }

            leaf = uint(keccak256(abi.encodePacked(left,right))) & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
            assembly {
                index := div(index,2)
            }
        }

        if( oddBranchSize ) {
            assembly {
                node := mload(add(add(witness,0x20),mul(add(depth,witnessIndex),0x20)))
            }

            //node  = witness[witnessIndex + depth] & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
            if( index & 0x1 == 0 ) {
                left = leaf;
                assembly{
                    right := and(node,0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)
                }
            }
            else {
                assembly{
                    left := and(node,0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)
                }

                right = leaf;
            }

            leaf = uint(keccak256(abi.encodePacked(left,right))) & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
        }


        return leaf;
    }

    function toBE( uint x ) pure internal returns(uint) {
        uint y = 0;
        for( uint i = 0 ; i < 32 ; i++ ) {
            y = y * 256;
            y += (x & 0xFF);
            x = x / 256;
        }

        return y;

    }

    function computeSha3( uint[16] memory s, uint[8] memory cmix ) pure internal returns(uint) {
        uint s0 = s[0] + s[1] * (2**32) + s[2] * (2**64) + s[3] * (2**96) +
        (s[4] + s[5] * (2**32) + s[6] * (2**64) + s[7] * (2**96))*(2**128);

        uint s1 = s[8] + s[9] * (2**32) + s[10] * (2**64) + s[11] * (2**96) +
        (s[12] + s[13] * (2**32) + s[14] * (2**64) + s[15] * (2**96))*(2**128);

        uint c = cmix[0] + cmix[1] * (2**32) + cmix[2] * (2**64) + cmix[3] * (2**96) +
        (cmix[4] + cmix[5] * (2**32) + cmix[6] * (2**64) + cmix[7] * (2**96))*(2**128);


        /* god knows why need to convert to big endian */
        return uint( keccak256(abi.encodePacked(toBE(s0),toBE(s1),toBE(c))) );
    }


    function computeLeaf( uint[] memory dataSetLookup, uint index ) pure internal returns(uint) {
        return uint( keccak256(abi.encodePacked(
                dataSetLookup[4*index],
                dataSetLookup[4*index + 1],
                dataSetLookup[4*index + 2],
                dataSetLookup[4*index + 3]
            )) );

    }

    function computeS( uint header, uint nonceLe ) view internal returns(uint[16] memory) {
        uint[9] memory M;

        header = reverseBytes(header);

        M[0] = uint(header) & 0xFFFFFFFFFFFFFFFF;
        header = header / 2**64;
        M[1] = uint(header) & 0xFFFFFFFFFFFFFFFF;
        header = header / 2**64;
        M[2] = uint(header) & 0xFFFFFFFFFFFFFFFF;
        header = header / 2**64;
        M[3] = uint(header) & 0xFFFFFFFFFFFFFFFF;

        // make little endian nonce
        M[4] = nonceLe;
        return SHA3_contract.sponge(M);
    }

    function reverseBytes( uint input ) pure internal returns(uint) {
        uint result = 0;
        for(uint i = 0 ; i < 32 ; i++ ) {
            result = result * 256;
            result += input & 0xff;

            input /= 256;
        }

        return result;
    }

    struct EthashCacheOptData {
        uint[512]    merkleNodes;
        uint         fullSizeIn128Resultion;
        uint         branchDepth;
    }

    mapping(uint=>EthashCacheOptData) epochData;

    function isEpochDataSet( uint epochIndex ) public view returns(bool) {
        return epochData[epochIndex].fullSizeIn128Resultion != 0;

    }

    event SetEpochData( address indexed sender, uint error, uint errorInfo );
    function setEpochData( uint epoch,
        uint fullSizeIn128Resultion,
        uint branchDepth,
        uint[] memory merkleNodes,
        uint start,
        uint numElems ) public {

        for( uint i = 0 ; i < numElems ; i++ ) {
            if( epochData[epoch].merkleNodes[start+i] > 0 ) {
                //ErrorLog("epoch already set", epoch[i]);
                emit SetEpochData( msg.sender, 1, epoch * (2**128) + start + i );
                return;
            }
            epochData[epoch].merkleNodes[start+i] = merkleNodes[i];
        }
        epochData[epoch].fullSizeIn128Resultion = fullSizeIn128Resultion;
        epochData[epoch].branchDepth = branchDepth;

        emit SetEpochData( msg.sender, 0 , 0 );
    }

    function getMerkleLeave( uint epochIndex, uint p ) view internal returns(uint) {
        uint rootIndex = uint(p >> epochData[epochIndex].branchDepth);
        uint expectedRoot = epochData[epochIndex].merkleNodes[(rootIndex/2)];
        if( (rootIndex % 2) == 0 ) expectedRoot = expectedRoot & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
        else expectedRoot = expectedRoot / (2**128);

        return expectedRoot;
    }

    function hashimoto( bytes32 header,
        uint          nonceLe,
        uint[] memory dataSetLookup,
        uint[] memory witnessForLookup,
        uint          epochIndex ) private view returns(uint) {

        uint[16] memory s;
        uint[32] memory mix;
        uint[8]  memory cmix;

        uint[2]  memory depthAndFullSize = [epochData[epochIndex].branchDepth,
        epochData[epochIndex].fullSizeIn128Resultion];

        uint i;
        uint j;

        if( ! isEpochDataSet( epochIndex ) ) return 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE;

        if( depthAndFullSize[1] == 0 ) {
            return 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
        }


        s = computeS(uint(header), nonceLe);
        for( i = 0 ; i < 16 ; i++ ) {
            assembly {
                let offset := mul(i,0x20)

                //mix[i] = s[i];
                mstore(add(mix,offset),mload(add(s,offset)))

                // mix[i+16] = s[i];
                mstore(add(mix,add(0x200,offset)),mload(add(s,offset)))
            }
        }

        for( i = 0 ; i < 64 ; i++ ) {
            uint p = fnv( i ^ s[0], mix[i % 32]) % depthAndFullSize[1];


            if( computeCacheRoot( p, i, dataSetLookup,  witnessForLookup, depthAndFullSize[0] )  != getMerkleLeave( epochIndex, p ) ) {

                // PoW failed
                return 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
            }

            for( j = 0 ; j < 8 ; j++ ) {

                assembly{
                    //mix[j] = fnv(mix[j], dataSetLookup[4*i] & varFFFFFFFF );
                    let dataOffset := add(mul(0x80,i),add(dataSetLookup,0x20))
                    let dataValue   := and(mload(dataOffset),0xFFFFFFFF)

                    let mixOffset := add(mix,mul(0x20,j))
                    let mixValue  := mload(mixOffset)

                    // fnv = return ((v1*0x01000193) ^ v2) & 0xFFFFFFFF;
                    let fnvValue := and(xor(mul(mixValue,0x01000193),dataValue),0xFFFFFFFF)
                    mstore(mixOffset,fnvValue)

                    //mix[j+8] = fnv(mix[j+8], dataSetLookup[4*i + 1] & 0xFFFFFFFF );
                    dataOffset := add(dataOffset,0x20)
                    dataValue   := and(mload(dataOffset),0xFFFFFFFF)

                    mixOffset := add(mixOffset,0x100)
                    mixValue  := mload(mixOffset)

                    // fnv = return ((v1*0x01000193) ^ v2) & 0xFFFFFFFF;
                    fnvValue := and(xor(mul(mixValue,0x01000193),dataValue),0xFFFFFFFF)
                    mstore(mixOffset,fnvValue)

                    //mix[j+16] = fnv(mix[j+16], dataSetLookup[4*i + 2] & 0xFFFFFFFF );
                    dataOffset := add(dataOffset,0x20)
                    dataValue   := and(mload(dataOffset),0xFFFFFFFF)

                    mixOffset := add(mixOffset,0x100)
                    mixValue  := mload(mixOffset)

                    // fnv = return ((v1*0x01000193) ^ v2) & 0xFFFFFFFF;
                    fnvValue := and(xor(mul(mixValue,0x01000193),dataValue),0xFFFFFFFF)
                    mstore(mixOffset,fnvValue)

                    //mix[j+24] = fnv(mix[j+24], dataSetLookup[4*i + 3] & 0xFFFFFFFF );
                    dataOffset := add(dataOffset,0x20)
                    dataValue   := and(mload(dataOffset),0xFFFFFFFF)

                    mixOffset := add(mixOffset,0x100)
                    mixValue  := mload(mixOffset)

                    // fnv = return ((v1*0x01000193) ^ v2) & 0xFFFFFFFF;
                    fnvValue := and(xor(mul(mixValue,0x01000193),dataValue),0xFFFFFFFF)
                    mstore(mixOffset,fnvValue)

                }


                //mix[j] = fnv(mix[j], dataSetLookup[4*i] & 0xFFFFFFFF );
                //mix[j+8] = fnv(mix[j+8], dataSetLookup[4*i + 1] & 0xFFFFFFFF );
                //mix[j+16] = fnv(mix[j+16], dataSetLookup[4*i + 2] & 0xFFFFFFFF );
                //mix[j+24] = fnv(mix[j+24], dataSetLookup[4*i + 3] & 0xFFFFFFFF );


                //dataSetLookup[4*i    ] = dataSetLookup[4*i    ]/(2**32);
                //dataSetLookup[4*i + 1] = dataSetLookup[4*i + 1]/(2**32);
                //dataSetLookup[4*i + 2] = dataSetLookup[4*i + 2]/(2**32);
                //dataSetLookup[4*i + 3] = dataSetLookup[4*i + 3]/(2**32);

                assembly{
                    let offset := add(add(dataSetLookup,0x20),mul(i,0x80))
                    let value  := div(mload(offset),0x100000000)
                    mstore(offset,value)

                    offset := add(offset,0x20)
                    value  := div(mload(offset),0x100000000)
                    mstore(offset,value)

                    offset := add(offset,0x20)
                    value  := div(mload(offset),0x100000000)
                    mstore(offset,value)

                    offset := add(offset,0x20)
                    value  := div(mload(offset),0x100000000)
                    mstore(offset,value)
                }
            }
        }


        for( i = 0 ; i < 32 ; i += 4) {
            cmix[i/4] = (fnv(fnv(fnv(mix[i], mix[i+1]), mix[i+2]), mix[i+3]));
        }

        uint result = computeSha3(s,cmix);

        return result;

    }

    function verifyPoW(uint blockNumber, bytes32 rlpHeaderHashWithoutNonce, uint nonce, uint difficulty,
        uint[] calldata dataSetLookup, uint[] calldata witnessForLookup) external view returns (uint, uint) {

        // verify ethash
        uint epoch = blockNumber / EPOCH_LENGTH;
        uint ethash = hashimoto(rlpHeaderHashWithoutNonce, nonce, dataSetLookup, witnessForLookup, epoch);

        if( ethash > (2**256-1)/difficulty) {
            uint errorCode;
            uint errorInfo;
            if( ethash == 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE ) {
                // Required epoch data not set
                errorCode = 1;
                errorInfo = epoch;
            }
            else {
                // ethash difficulty too low
                errorCode = 2;
                errorInfo = ethash;
            }
            return (errorCode, errorInfo);
        }

        return (0, 0);
    }
}
