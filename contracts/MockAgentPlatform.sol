// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    ISomniaAgents,
    IAgentHandler,
    AgentRequest,
    AgentResponse,
    ResponseStatus
} from "./ISomniaAgents.sol";

/// @title MockAgentPlatform
/// @notice Local stand-in for the Somnia Agents platform so the full
///         observe -> decide -> act flow can be unit-tested deterministically
///         without live validators. NOT deployed to testnet.
contract MockAgentPlatform is ISomniaAgents {
    struct Stored {
        address callback;
        bytes4 selector;
        uint256 agentId;
        bytes payload;
        bool fulfilled;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Stored) public requests;

    function getRequestDeposit() external pure returns (uint256) {
        return 0;
    }

    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId) {
        requestId = nextId++;
        requests[requestId] = Stored(callbackAddress, callbackSelector, agentId, payload, false);
    }

    function getRequest(uint256) external pure returns (AgentRequest memory r) {
        return r;
    }

    // --- test helpers: deliver a single Success response ---

    function fulfillUint(uint256 id, uint256 value) external {
        _fulfill(id, abi.encode(value));
    }

    function fulfillInt(uint256 id, int256 value) external {
        _fulfill(id, abi.encode(value));
    }

    function fail(uint256 id) external {
        Stored storage s = requests[id];
        require(!s.fulfilled, "done");
        s.fulfilled = true;
        AgentResponse[] memory rs = new AgentResponse[](0);
        AgentRequest memory det;
        IAgentHandler(s.callback).handleResponse(id, rs, ResponseStatus.Failed, det);
    }

    function _fulfill(uint256 id, bytes memory result) internal {
        Stored storage s = requests[id];
        require(s.callback != address(0), "no req");
        require(!s.fulfilled, "done");
        s.fulfilled = true;

        AgentResponse[] memory rs = new AgentResponse[](1);
        rs[0] = AgentResponse({
            validator: address(this),
            result: result,
            status: ResponseStatus.Success,
            receipt: 1,
            timestamp: block.timestamp,
            executionCost: 0
        });
        AgentRequest memory det;
        IAgentHandler(s.callback).handleResponse(id, rs, ResponseStatus.Success, det);
    }
}
