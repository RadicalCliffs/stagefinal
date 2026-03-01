// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {IVRFCoordinatorV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";

/**
 * @title ThePrizeVRF
 * @notice VRF Consumer for fair competition winner selection
 * @dev Uses Chainlink VRF V2.5 on Base mainnet
 * 
 * Base Mainnet VRF V2.5 Configuration:
 * - Coordinator: 0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634
 * - Key Hash: 0x00b81b5a830cb0a4009fbd8904de511e28631e62ce5ad231373d3cdad373ccab
 * - Native payment supported (ETH instead of LINK)
 */
contract ThePrizeVRF is VRFConsumerBaseV2Plus {
    // Chainlink VRF V2.5 configuration for Base mainnet
    // https://docs.chain.link/vrf/v2-5/supported-networks#base-mainnet
    bytes32 public constant KEY_HASH = 0x00b81b5a830cb0a4009fbd8904de511e28631e62ce5ad231373d3cdad373ccab;
    uint32 public constant CALLBACK_GAS_LIMIT = 200000;
    uint16 public constant REQUEST_CONFIRMATIONS = 3;
    uint32 public constant NUM_WORDS = 1; // Default to 1 winner
    
    uint256 public subscriptionId;
    
    struct Competition {
        string name;
        uint32 totalTickets;
        uint8 numWinners;
        uint256 requestId;
        uint256[] randomWords;
        uint256[] winningTickets;
        bool fulfilled;
        uint256 createdAt;
    }
    
    // Competition name hash => Competition data
    mapping(bytes32 => Competition) public competitions;
    
    // Request ID => Competition name hash
    mapping(uint256 => bytes32) public requestToCompetition;
    
    // Track total competitions
    uint256 public competitionCount;
    
    event CompetitionCreated(
        bytes32 indexed nameHash,
        string name,
        uint32 totalTickets,
        uint8 numWinners,
        uint256 requestId
    );
    
    event WinnerSelected(
        bytes32 indexed nameHash,
        string name,
        uint256[] winningTickets,
        uint256[] randomWords
    );
    
    error CompetitionAlreadyExists();
    error InvalidTotalTickets();
    error InvalidNumWinners();
    error CompetitionNotFound();
    error InvalidCoordinator();
    
    constructor(
        address vrfCoordinator,
        uint256 _subscriptionId
    ) VRFConsumerBaseV2Plus(vrfCoordinator) {
        subscriptionId = _subscriptionId;
    }
    
    /**
     * @notice Create a new competition and request randomness
     * @param name Competition identifier (usually UUID)
     * @param totalTickets Total number of tickets in the competition
     * @param numWinners Number of winners to select
     */
    function createCompetition(
        bytes calldata name,
        uint32 totalTickets,
        uint8 numWinners
    ) external onlyOwner returns (uint256 requestId) {
        if (totalTickets == 0) revert InvalidTotalTickets();
        if (numWinners == 0 || numWinners > totalTickets) revert InvalidNumWinners();
        
        bytes32 nameHash = keccak256(name);
        if (competitions[nameHash].createdAt != 0) revert CompetitionAlreadyExists();
        
        // Request randomness from Chainlink VRF
        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: KEY_HASH,
                subId: subscriptionId,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit: CALLBACK_GAS_LIMIT,
                numWords: numWinners,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: true})
                )
            })
        );
        
        // Store competition data
        competitions[nameHash] = Competition({
            name: string(name),
            totalTickets: totalTickets,
            numWinners: numWinners,
            requestId: requestId,
            randomWords: new uint256[](0),
            winningTickets: new uint256[](0),
            fulfilled: false,
            createdAt: block.timestamp
        });
        
        requestToCompetition[requestId] = nameHash;
        competitionCount++;
        
        emit CompetitionCreated(nameHash, string(name), totalTickets, numWinners, requestId);
    }
    
    /**
     * @notice Callback function for Chainlink VRF
     * @dev Called by VRF Coordinator when randomness is ready
     */
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override {
        bytes32 nameHash = requestToCompetition[requestId];
        if (nameHash == bytes32(0)) revert CompetitionNotFound();
        
        Competition storage comp = competitions[nameHash];
        comp.randomWords = randomWords;
        comp.fulfilled = true;
        
        // Calculate winning tickets
        uint256[] memory winners = new uint256[](randomWords.length);
        for (uint256 i = 0; i < randomWords.length; i++) {
            // Ticket numbers are 1-indexed
            winners[i] = (randomWords[i] % comp.totalTickets) + 1;
        }
        comp.winningTickets = winners;
        
        emit WinnerSelected(nameHash, comp.name, winners, randomWords);
    }
    
    /**
     * @notice Get competition details by name
     * @param name Competition identifier
     */
    function getCompetition(string calldata name) external view returns (
        string memory competitionName,
        uint32 totalTickets,
        uint8 numWinners,
        uint256 requestId,
        uint256[] memory randomWords,
        uint256[] memory winningTickets,
        bool fulfilled,
        uint256 createdAt
    ) {
        bytes32 nameHash = keccak256(bytes(name));
        Competition storage comp = competitions[nameHash];
        if (comp.createdAt == 0) revert CompetitionNotFound();
        
        return (
            comp.name,
            comp.totalTickets,
            comp.numWinners,
            comp.requestId,
            comp.randomWords,
            comp.winningTickets,
            comp.fulfilled,
            comp.createdAt
        );
    }
    
    /**
     * @notice Update the VRF Coordinator (owner only)
     * @param newCoordinator New VRF Coordinator address
     */
    function setCoordinator(address newCoordinator) external onlyOwner {
        if (newCoordinator == address(0)) revert InvalidCoordinator();
        s_vrfCoordinator = IVRFCoordinatorV2Plus(newCoordinator);
    }
    
    /**
     * @notice Update subscription ID (owner only)
     * @param newSubscriptionId New subscription ID
     */
    function setSubscriptionId(uint256 newSubscriptionId) external onlyOwner {
        subscriptionId = newSubscriptionId;
    }
}
