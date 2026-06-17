// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {OrderBook} from "./OrderBook.sol";
import {ISomniaAgents, IAgentHandler, AgentResponse, AgentRequest, ResponseStatus} from "./ISomniaAgents.sol";

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

/// @title TradingAgent
/// @notice An autonomous, self-funded AI market-making agent for an on-chain CLOB.
///         Each cycle it OBSERVES a reference price (Somnia JSON agent), REASONS over it
///         (Somnia LLM inference agent), and ACTS by quoting a bid/ask on the OrderBook.
///         It can wake itself with no keeper via Somnia on-chain Reactivity (a re-armed
///         schedule), and exposes an operator path for a reliable live demo.
/// @dev    Two trigger modes:
///         1. Autonomous: `startAutonomous()` schedules a reactive tick -> `_onEvent` -> cycle.
///         2. Driven:     `poke()` (on-chain agent path) or `applyDecision()` (operator path).
contract TradingAgent is SomniaEventHandler, IAgentHandler {
    using SafeERC20 for IERC20;

    // --- constants ---
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_SKEW_BPS = 500; // +/- 5% skew cap (safety clamp on the LLM)
    uint8 internal constant KIND_PRICE = 1;
    uint8 internal constant KIND_DECISION = 2;

    // --- roles ---
    address public owner;
    address public operator; // off-chain driver allowed to poke / applyDecision

    // --- wiring ---
    OrderBook public immutable book;
    IERC20 public immutable base;
    IERC20 public immutable quote;
    ISomniaAgents public platform;

    // --- agent config ---
    uint256 public jsonAgentId = 13174292974160097713; // Somnia JSON API agent
    uint256 public llmAgentId; // Somnia LLM inference agent (set once confirmed from the explorer)
    string public priceUrl;
    string public priceSelector;
    uint8 public priceDecimals = 18;
    string public llmPrompt = "You are a market maker. Given the reference price and inventory, choose a price skew.";
    string public llmSystem = "Respond with a single integer: the skew in basis points.";

    // deposit sizing (native STT, per validator) -- defaults match docs
    uint256 public jsonAgentCost = 0.03 ether;
    uint256 public llmAgentCost = 0.07 ether;
    uint256 public subcommitteeSize = 3;

    // --- strategy params ---
    uint256 public spreadBps = 100; // 1% half-spread each side
    uint256 public orderSize = 1 ether; // base units quoted per side

    // --- state ---
    uint256 public lastPrice; // quote per base, scaled 1e18
    uint256 public cycles;
    uint256 public subscriptionId; // reactivity subscription (0 = inactive)
    uint64 public intervalSeconds = 60;
    mapping(uint256 => uint8) public requestKind; // agent requestId => KIND_*
    uint256[] internal liveOrderIds; // our resting orders, cancelled & re-placed each cycle

    // --- events ---
    event CycleStarted(uint256 indexed cycle, uint256 indexed requestId);
    event PriceObserved(uint256 indexed requestId, uint256 price);
    event DecisionRequested(uint256 indexed requestId, uint256 price);
    event DecisionMade(uint256 indexed requestId, int256 skewBps);
    event Quoted(uint256 bidId, uint256 askId, uint256 bidPrice, uint256 askPrice);
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

    constructor(OrderBook _book, ISomniaAgents _platform, address _operator) {
        owner = msg.sender;
        operator = _operator;
        book = _book;
        platform = _platform;
        base = _book.base();
        quote = _book.quote();
        // pre-approve the book to pull our inventory when we place orders
        _book.base().forceApprove(address(_book), type(uint256).max);
        _book.quote().forceApprove(address(_book), type(uint256).max);
    }

    // =========================================================================
    //                              TRIGGERS
    // =========================================================================

    /// @notice On-chain agent path: kick off a cycle by requesting a fresh price.
    function poke() external onlyOperator {
        _requestPrice();
    }

    /// @notice Operator path: apply a price + skew directly (reliable live-demo driver).
    ///         The price/skew still originate from Somnia agents off-chain; this just settles
    ///         the result on-chain. Kept as a robust fallback to the on-chain callback.
    function applyDecision(uint256 price, int256 skewBps) external onlyOperator {
        skewBps = _bound(skewBps);
        emit DecisionMade(0, skewBps);
        _quote(price, skewBps);
    }

    /// @notice Start hands-off autonomy: schedule a reactive tick that re-arms itself.
    /// @dev Requires this contract to hold >= 32 STT (reactivity owner-balance floor).
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

    /// @dev Reactivity callback (a synthetic tx from the precompile). Runs a cycle, re-arms.
    function _onEvent(address, bytes32[] calldata, bytes calldata) internal override {
        _requestPrice();
        _arm();
    }

    function _arm() internal {
        uint256 ts = (block.timestamp + intervalSeconds) * 1000 + 1; // millis, strictly in the future
        subscriptionId = SomniaExtensions.scheduleSubscriptionAtTimestamp(
            address(this),
            ts,
            SomniaExtensions.defaultSubscriptionOptions()
        );
        emit Armed(subscriptionId, ts);
    }

    // =========================================================================
    //                          AGENT REQUEST / CALLBACK
    // =========================================================================

    function _requestPrice() internal {
        bytes memory payload = abi.encodeWithSignature(
            "fetchUint(string,string,uint8)",
            priceUrl,
            priceSelector,
            priceDecimals
        );
        uint256 deposit = platform.getRequestDeposit() + jsonAgentCost * subcommitteeSize;
        uint256 reqId = platform.createRequest{value: deposit}(
            jsonAgentId,
            address(this),
            this.handleResponse.selector,
            payload
        );
        requestKind[reqId] = KIND_PRICE;
        cycles += 1;
        emit CycleStarted(cycles, reqId);
    }

    function _requestDecision(uint256 price) internal {
        string memory prompt = string(
            abi.encodePacked(
                llmPrompt,
                " reference_price=",
                Strings.toString(price),
                " base_inventory=",
                Strings.toString(base.balanceOf(address(this))),
                " quote_inventory=",
                Strings.toString(quote.balanceOf(address(this))),
                " Return an integer skew in basis points between -",
                Strings.toString(MAX_SKEW_BPS),
                " and ",
                Strings.toString(MAX_SKEW_BPS),
                "."
            )
        );
        bytes memory payload = abi.encodeWithSignature(
            "inferNumber(string,string,int256,int256,bool)",
            prompt,
            llmSystem,
            -int256(MAX_SKEW_BPS),
            int256(MAX_SKEW_BPS),
            true
        );
        uint256 deposit = platform.getRequestDeposit() + llmAgentCost * subcommitteeSize;
        uint256 reqId = platform.createRequest{value: deposit}(
            llmAgentId,
            address(this),
            this.handleResponse.selector,
            payload
        );
        requestKind[reqId] = KIND_DECISION;
        emit DecisionRequested(reqId, price);
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
            // graceful fallback: keep the book alive off the last good price
            if (kind == KIND_PRICE && lastPrice > 0) {
                _quote(lastPrice, 0);
            }
            return;
        }

        if (kind == KIND_PRICE) {
            uint256 price = abi.decode(responses[0].result, (uint256));
            if (price == 0) return;
            lastPrice = price;
            emit PriceObserved(requestId, price);
            if (llmAgentId != 0) {
                _requestDecision(price); // chain: price -> decision
            } else {
                _quote(price, 0); // no LLM configured -> neutral quote
            }
        } else if (kind == KIND_DECISION) {
            int256 skew = _bound(abi.decode(responses[0].result, (int256)));
            emit DecisionMade(requestId, skew);
            _quote(lastPrice, skew);
        }
    }

    // =========================================================================
    //                              QUOTING
    // =========================================================================

    function _quote(uint256 price, int256 skewBps) internal {
        if (price == 0 || orderSize == 0) return;
        _cancelAll();

        uint256 adj = skewBps >= 0
            ? (price * (BPS + uint256(skewBps))) / BPS
            : (price * (BPS - uint256(-skewBps))) / BPS;
        uint256 bidPrice = (adj * (BPS - spreadBps)) / BPS;
        uint256 askPrice = (adj * (BPS + spreadBps)) / BPS;

        uint256 bidId;
        uint256 askId;
        try book.placeLimitOrder(true, bidPrice, orderSize) returns (uint256 id) {
            if (id != 0) {
                liveOrderIds.push(id);
                bidId = id;
            }
        } catch {}
        try book.placeLimitOrder(false, askPrice, orderSize) returns (uint256 id) {
            if (id != 0) {
                liveOrderIds.push(id);
                askId = id;
            }
        } catch {}

        lastPrice = price;
        emit Quoted(bidId, askId, bidPrice, askPrice);
    }

    function _cancelAll() internal {
        uint256[] memory ids = liveOrderIds;
        delete liveOrderIds;
        for (uint256 i = 0; i < ids.length; i++) {
            try book.cancelOrder(ids[i]) {} catch {}
        }
    }

    function _bound(int256 v) internal pure returns (int256) {
        int256 m = int256(MAX_SKEW_BPS);
        if (v > m) return m;
        if (v < -m) return -m;
        return v;
    }

    // =========================================================================
    //                              ADMIN / VIEWS
    // =========================================================================

    function setPlatform(ISomniaAgents p) external onlyOwner {
        platform = p;
    }

    function setOperator(address o) external onlyOwner {
        operator = o;
    }

    function setLlmAgent(uint256 id, string calldata prompt, string calldata system) external onlyOwner {
        llmAgentId = id;
        llmPrompt = prompt;
        llmSystem = system;
    }

    function setAgentIds(uint256 json, uint256 llm) external onlyOwner {
        jsonAgentId = json;
        llmAgentId = llm;
    }

    function setPriceSource(string calldata url, string calldata selector, uint8 decimals_) external onlyOwner {
        priceUrl = url;
        priceSelector = selector;
        priceDecimals = decimals_;
    }

    function setAgentCosts(uint256 json, uint256 llm) external onlyOwner {
        jsonAgentCost = json;
        llmAgentCost = llm;
    }

    function setSubcommittee(uint256 n) external onlyOwner {
        require(n > 0, "n");
        subcommitteeSize = n;
    }

    function setStrategy(uint256 _spreadBps, uint256 _orderSize) external onlyOwner {
        require(_spreadBps < BPS, "spread");
        spreadBps = _spreadBps;
        orderSize = _orderSize;
    }

    function setOrderSize(uint256 _orderSize) external onlyOwner {
        orderSize = _orderSize;
    }

    /// @notice Recover idle inventory or native STT to the owner.
    function withdraw(IERC20 token, uint256 amount) external onlyOwner {
        token.safeTransfer(owner, amount);
    }

    function withdrawNative(uint256 amount) external onlyOwner {
        (bool ok, ) = owner.call{value: amount}("");
        require(ok, "native xfer");
    }

    function liveOrders() external view returns (uint256[] memory) {
        return liveOrderIds;
    }

    function inventory() external view returns (uint256 baseBal, uint256 quoteBal) {
        return (base.balanceOf(address(this)), quote.balanceOf(address(this)));
    }

    receive() external payable {}
}
