// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Canonical Somnia Agents platform types, per docs:
//   https://docs.somnia.network/agents/invoking-agents/from-solidity
// NOTE: the struct field order/types below must match the live platform exactly, since
// the platform ABI-encodes these into the handleResponse callback. Verify against the
// on-chain platform (testnet 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776) on first run.

enum ResponseStatus {
    None, // 0
    Pending, // 1
    Success, // 2
    Failed, // 3
    TimedOut // 4
}

enum ConsensusType {
    Majority,
    Threshold
}

struct AgentResponse {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct AgentRequest {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    AgentResponse[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

interface ISomniaAgents {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    function getRequestDeposit() external view returns (uint256);

    function getRequest(uint256 requestId) external view returns (AgentRequest memory);
}

interface IAgentHandler {
    function handleResponse(
        uint256 requestId,
        AgentResponse[] memory responses,
        ResponseStatus status,
        AgentRequest memory details
    ) external;
}
