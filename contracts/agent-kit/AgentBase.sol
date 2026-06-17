// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISomniaAgents, IAgentHandler, AgentResponse, AgentRequest, ResponseStatus} from "../ISomniaAgents.sol";
import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

/// @title AgentBase — reusable base for Somnia agent apps
/// @notice Handles all the boilerplate of building on Somnia's Agentic L1:
///         - invoking agents (createRequest) with correct deposit funding
///         - the gated handleResponse callback + per-request routing
///         - keeper-free autonomy via On-Chain Reactivity (self-re-arming schedule)
///         - treasury funding / native withdrawals
///
///         Extend it and implement two hooks:
///           _onCycle()        -> what to do each autonomous tick (usually: invoke an agent)
///           _onAgentResult()  -> what to do with a successful agent result
///         Optionally override _onAgentFailure() for graceful degradation.
///
///         See PriceReactorAgent.sol for a ~30-line example.
abstract contract AgentBase is SomniaEventHandler, IAgentHandler {
    address public owner;
    address public operator;
    ISomniaAgents public platform;

    uint256 public subcommitteeSize = 3;
    uint64 public intervalSeconds = 60;
    uint256 public subscriptionId; // reactivity subscription (0 = inactive)

    mapping(uint256 => uint8) public requestKind; // requestId => app-defined kind tag

    event AgentRequested(uint256 indexed requestId, uint256 indexed agentId, uint8 kind);
    event AgentResulted(uint256 indexed requestId, uint8 kind);
    event AgentFailed(uint256 indexed requestId, uint8 kind, uint8 status);
    event Armed(uint256 indexed subscriptionId, uint256 timestampMillis);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == owner || msg.sender == operator, "not operator");
        _;
    }

    constructor(ISomniaAgents _platform, address _operator) {
        owner = msg.sender;
        operator = _operator;
        platform = _platform;
    }

    // ----------------------------------------------------------------- invoke
    /// @dev Invoke a Somnia agent. `agentCost` is the per-validator price for that agent type
    ///      (e.g. 0.03 ether for JSON, 0.07 for LLM). `kind` tags the request for routing.
    function _invoke(uint256 agentId, uint256 agentCost, bytes memory payload, uint8 kind)
        internal
        returns (uint256 requestId)
    {
        uint256 deposit = platform.getRequestDeposit() + agentCost * subcommitteeSize;
        requestId = platform.createRequest{value: deposit}(
            agentId,
            address(this),
            this.handleResponse.selector,
            payload
        );
        requestKind[requestId] = kind;
        emit AgentRequested(requestId, agentId, kind);
    }

    /// @notice Async callback from the Somnia Agents platform.
    function handleResponse(
        uint256 requestId,
        AgentResponse[] memory responses,
        ResponseStatus status,
        AgentRequest memory
    ) external override {
        require(msg.sender == address(platform), "only platform");
        uint8 kind = requestKind[requestId];
        delete requestKind[requestId];

        if (status != ResponseStatus.Success || responses.length == 0) {
            emit AgentFailed(requestId, kind, uint8(status));
            _onAgentFailure(requestId, kind, status);
            return;
        }
        emit AgentResulted(requestId, kind);
        _onAgentResult(requestId, kind, responses);
    }

    // ------------------------------------------------------- reactivity (auto)
    /// @notice Start hands-off autonomy. Requires this contract to hold >= 32 STT.
    function startAutonomous(uint64 _intervalSeconds) external onlyOwner {
        require(_intervalSeconds >= 1, "interval");
        intervalSeconds = _intervalSeconds;
        _arm();
    }

    function stopAutonomous() external onlyOwner {
        if (subscriptionId != 0) {
            SomniaExtensions.unsubscribe(subscriptionId);
            subscriptionId = 0;
        }
    }

    function _arm() internal {
        uint256 ts = (block.timestamp + intervalSeconds) * 1000 + 1;
        subscriptionId = SomniaExtensions.scheduleSubscriptionAtTimestamp(
            address(this),
            ts,
            SomniaExtensions.defaultSubscriptionOptions()
        );
        emit Armed(subscriptionId, ts);
    }

    function _onEvent(address, bytes32[] calldata, bytes calldata) internal override {
        _onCycle();
        _arm();
    }

    // ----------------------------------------------------------------- hooks
    function _onCycle() internal virtual;

    function _onAgentResult(uint256 requestId, uint8 kind, AgentResponse[] memory responses) internal virtual;

    function _onAgentFailure(uint256 requestId, uint8 kind, ResponseStatus status) internal virtual {}

    // ----------------------------------------------------------------- admin
    function setPlatform(ISomniaAgents p) external onlyOwner {
        platform = p;
    }

    function setOperator(address o) external onlyOwner {
        operator = o;
    }

    function setSubcommittee(uint256 n) external onlyOwner {
        require(n > 0, "n");
        subcommitteeSize = n;
    }

    function withdrawNative(uint256 amount) external onlyOwner {
        (bool ok, ) = owner.call{value: amount}("");
        require(ok, "native xfer");
    }

    receive() external payable {}
}
