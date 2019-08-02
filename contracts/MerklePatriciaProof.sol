/*
 * @title MerklePatriciaVerifier
 * @author Sam Mayo (sammayo888@gmail.com)
 *
 * @dev Library for verifing merkle patricia proofs.
 */
pragma solidity ^0.5.10;
import "./RLP.sol";
import "./RLPReader.sol";

library MerklePatriciaProof {
    /*
     * @dev Verifies a merkle patricia proof.
     * @param value The terminating value in the trie.
     * @param path The path in the trie leading to value.
     * @param rlpParentNodes The rlp encoded stack of nodes.
     * @param root The root hash of the trie.
     * @return The boolean validity of the proof.
     */
    function verify(bytes memory value, bytes memory encodedPath, bytes memory rlpParentNodes, bytes32 root) internal pure returns (uint, int, bytes memory) {
        RLP.RLPItem memory item = RLP.toRLPItem(rlpParentNodes);
        RLP.RLPItem[] memory parentNodes = RLP.toList(item);

//        RLPReader.RLPItem memory rlpItem = RLPReader.toRlpItem(rlpParentNodes);

        bytes memory currentNode;
        RLP.RLPItem[] memory currentNodeList;

        bytes32 nodeKey = root;
        uint pathPtr = 0;

        bytes memory dummy; // TODO: remove

        bytes memory path = _getNibbleArray(encodedPath);
        if (path.length == 0) {return (1, -1, dummy);}

        for (uint i = 0; i < parentNodes.length; i++) {
            if (pathPtr > path.length) {return (2, int(i), dummy);}

            currentNode = RLP.toBytes(parentNodes[i]);
            if (nodeKey != keccak256(currentNode)) {return (3, int(i), currentNode);}
            currentNodeList = RLP.toList(parentNodes[i]);

            if (currentNodeList.length == 17) {
                if (pathPtr == path.length) {
                    if (keccak256(RLP.toBytes(currentNodeList[16])) == keccak256(value)) {
                        return (0, int(i), dummy);
                    } else {
                        return (4, int(i), dummy);
                    }
                }

                uint8 nextPathNibble = uint8(path[pathPtr]);
                if (nextPathNibble > 16) {return (0, int(i), dummy);}
                nodeKey = RLP.toBytes32(currentNodeList[nextPathNibble]);
                pathPtr += 1;
            } else if (currentNodeList.length == 2) {
                pathPtr += _nibblesToTraverse(RLP.toData(currentNodeList[0]), path, pathPtr);

                if (pathPtr == path.length) {//leaf node
                    if (keccak256(RLP.toData(currentNodeList[1])) == keccak256(value)) {
                        return (0, int(i), dummy);
                    } else {
                        return (6, int(i), dummy);
                    }
                }
                //extension node
                if (_nibblesToTraverse(RLP.toData(currentNodeList[0]), path, pathPtr) == 0) {
                    return (7, int(i), dummy);
                }

                nodeKey = RLP.toBytes32(currentNodeList[1]);
            } else {
                return (8, int(i), dummy);
            }
        }
    }

    function _nibblesToTraverse(bytes memory encodedPartialPath, bytes memory path, uint pathPtr) private pure returns (uint) {
        uint len;
        // encodedPartialPath has elements that are each two hex characters (1 byte), but partialPath
        // and slicedPath have elements that are each one hex character (1 nibble)
        bytes memory partialPath = _getNibbleArrayEncoding(encodedPartialPath);
        bytes memory slicedPath = new bytes(partialPath.length);

        // pathPtr counts nibbles in path
        // partialPath.length is a number of nibbles
        for (uint i=pathPtr; i<pathPtr+partialPath.length; i++) {
            byte pathNibble = path[i];
            slicedPath[i-pathPtr] = pathNibble;
        }

        if (keccak256(partialPath) == keccak256(slicedPath)) {
            len = partialPath.length;
        } else {
            len = 0;
        }
        return len;
    }

    // bytes b must be hp encoded
    function _getNibbleArrayEncoding(bytes memory b) private pure returns (bytes memory) {
        bytes memory nibbles;
        if (b.length>0) {
            uint8 offset;
            uint8 hpNibble = uint8(_getNthNibbleOfBytes(0,b));
            if (hpNibble == 1 || hpNibble == 3) {
                nibbles = new bytes(b.length*2-1);
                byte oddNibble = _getNthNibbleOfBytes(1,b);
                nibbles[0] = oddNibble;
                offset = 1;
            } else {
                nibbles = new bytes(b.length*2-2);
                offset = 0;
            }

            for (uint i = offset; i < nibbles.length; i++) {
                nibbles[i] = _getNthNibbleOfBytes(i-offset+2,b);
            }
        }
        return nibbles;
    }

    // normal byte array, no encoding used
    function _getNibbleArray(bytes memory b) private pure returns (bytes memory) {
        bytes memory nibbles = new bytes(b.length*2);
        for (uint i = 0; i < nibbles.length; i++) nibbles[i] = _getNthNibbleOfBytes(i, b);
        return nibbles;
    }

    /*
     *This function takes in the bytes string (hp encoded) and the value of N, to return Nth Nibble.
     *@param Value of N
     *@param Bytes String
     *@return ByteString[N]
     */
    function _getNthNibbleOfBytes(uint n, bytes memory str) private pure returns (byte) {
        return byte(n%2==0 ? uint8(str[n/2])/0x10 : uint8(str[n/2])%0x10);
    }
}
