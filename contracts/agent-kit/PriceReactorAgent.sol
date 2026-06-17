// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentBase} from "./AgentBase.sol";
import {ISomniaAgents, AgentResponse, ResponseStatus} from "../ISomniaAgents.sol";

/// @title PriceReactorAgent — the minimal Somnia agent (starter example)
/// @notice Every cycle it asks the Somnia JSON API agent for a number and stores it on-chain.
///         This is ALL the app code needed to build a Somnia agent on top of AgentBase —
///         swap `_onCycle` / `_onAgentResult` to react however you like (mint an NFT, settle a
///         market, rebalance a vault, ...). It self-runs hands-off once `startAutonomous` is on.
contract PriceReactorAgent is AgentBase {
    uint256 public jsonAgentId = 13174292974160097713; // Somnia JSON API agent
    uint256 public jsonAgentCost = 0.03 ether;

    string public url;
    string public selector;
    uint8 public decimals = 18;

    uint256 public lastValue;
    uint256 public updates;

    event ValueUpdated(uint256 value, uint256 updates);

    constructor(ISomniaAgents platform, address operator) AgentBase(platform, operator) {}

    function configure(string calldata _url, string calldata _selector, uint8 _decimals) external onlyOwner {
        url = _url;
        selector = _selector;
        decimals = _decimals;
    }

    function setJsonAgent(uint256 id, uint256 cost) external onlyOwner {
        jsonAgentId = id;
        jsonAgentCost = cost;
    }

    /// @notice Trigger one observation manually (also runs automatically each reactive tick).
    function poke() external onlyOperator {
        _onCycle();
    }

    function _onCycle() internal override {
        bytes memory payload = abi.encodeWithSignature(
            "fetchUint(string,string,uint8)",
            url,
            selector,
            decimals
        );
        _invoke(jsonAgentId, jsonAgentCost, payload, 1);
    }

    function _onAgentResult(uint256, uint8, AgentResponse[] memory responses) internal override {
        lastValue = abi.decode(responses[0].result, (uint256));
        updates += 1;
        emit ValueUpdated(lastValue, updates);
    }
}
