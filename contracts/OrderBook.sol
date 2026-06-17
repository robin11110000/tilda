// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OrderBook
/// @notice A minimal on-chain Central Limit Order Book (CLOB) for a single base/quote market.
///         Incoming orders match against resting orders at the resting (maker) price; any
///         unfilled remainder rests on the book. Kept deliberately lean for Somnia's gas model
///         (latency-priced storage + expensive logs): minimal state, one event per fill.
/// @dev    Price is quoted as `quote per 1 base`, scaled by PRICE_SCALE. Assumes 18-decimal tokens.
contract OrderBook is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable base; // e.g. mSOM
    IERC20 public immutable quote; // e.g. mUSDC
    uint256 public constant PRICE_SCALE = 1e18;

    struct Order {
        uint256 id;
        address trader;
        bool isBuy;
        uint256 price; // quote per base, scaled by PRICE_SCALE
        uint256 amount; // remaining base amount
    }

    uint256 public nextId = 1;
    mapping(uint256 => Order) public orders; // id => order (amount 0 => filled/cancelled)
    uint256[] public bids; // open buy order ids
    uint256[] public asks; // open sell order ids

    event OrderPlaced(uint256 indexed id, address indexed trader, bool isBuy, uint256 price, uint256 amount);
    event Trade(uint256 indexed makerId, address indexed taker, address indexed maker, bool takerIsBuy, uint256 price, uint256 amount);
    event OrderCancelled(uint256 indexed id);

    constructor(IERC20 base_, IERC20 quote_) {
        base = base_;
        quote = quote_;
    }

    // --- core ---

    /// @notice Place a limit order. Matches against the book, then rests any remainder.
    /// @return restingId id of the resting order (0 if fully filled)
    function placeLimitOrder(bool isBuy, uint256 price, uint256 amount)
        external
        nonReentrant
        returns (uint256 restingId)
    {
        require(price > 0 && amount > 0, "bad args");
        uint256 remaining = amount;

        if (isBuy) {
            remaining = _matchBuy(price, remaining);
            if (remaining > 0) {
                quote.safeTransferFrom(msg.sender, address(this), _quoteAmount(remaining, price));
                restingId = _rest(msg.sender, true, price, remaining);
            }
        } else {
            remaining = _matchSell(price, remaining);
            if (remaining > 0) {
                base.safeTransferFrom(msg.sender, address(this), remaining);
                restingId = _rest(msg.sender, false, price, remaining);
            }
        }
    }

    /// @notice Cancel a resting order and refund the locked funds to its trader.
    function cancelOrder(uint256 id) external nonReentrant {
        Order memory o = orders[id];
        require(o.trader == msg.sender, "not owner");
        require(o.amount > 0, "gone");

        if (o.isBuy) {
            _remove(bids, id);
            quote.safeTransfer(msg.sender, _quoteAmount(o.amount, o.price));
        } else {
            _remove(asks, id);
            base.safeTransfer(msg.sender, o.amount);
        }
        delete orders[id];
        emit OrderCancelled(id);
    }

    // --- matching ---

    function _matchBuy(uint256 limitPrice, uint256 remaining) internal returns (uint256) {
        while (remaining > 0) {
            (uint256 oid, bool found) = _bestAsk(limitPrice);
            if (!found) break;
            Order storage o = orders[oid];

            uint256 fill = remaining < o.amount ? remaining : o.amount;
            uint256 cost = _quoteAmount(fill, o.price); // taker pays maker price

            quote.safeTransferFrom(msg.sender, o.trader, cost); // taker -> seller
            base.safeTransfer(msg.sender, fill); // book (locked base) -> taker

            emit Trade(oid, msg.sender, o.trader, true, o.price, fill);

            o.amount -= fill;
            remaining -= fill;
            if (o.amount == 0) {
                _remove(asks, oid);
                delete orders[oid];
            }
        }
        return remaining;
    }

    function _matchSell(uint256 limitPrice, uint256 remaining) internal returns (uint256) {
        while (remaining > 0) {
            (uint256 oid, bool found) = _bestBid(limitPrice);
            if (!found) break;
            Order storage o = orders[oid];

            uint256 fill = remaining < o.amount ? remaining : o.amount;
            uint256 proceeds = _quoteAmount(fill, o.price); // taker receives maker price

            base.safeTransferFrom(msg.sender, o.trader, fill); // taker -> buyer
            quote.safeTransfer(msg.sender, proceeds); // book (locked quote) -> taker

            emit Trade(oid, msg.sender, o.trader, false, o.price, fill);

            o.amount -= fill;
            remaining -= fill;
            if (o.amount == 0) {
                _remove(bids, oid);
                delete orders[oid];
            }
        }
        return remaining;
    }

    /// @dev lowest-priced ask with price <= limit
    function _bestAsk(uint256 limitPrice) internal view returns (uint256 id, bool found) {
        uint256 best = type(uint256).max;
        for (uint256 i = 0; i < asks.length; i++) {
            uint256 p = orders[asks[i]].price;
            if (p <= limitPrice && p < best) {
                best = p;
                id = asks[i];
                found = true;
            }
        }
    }

    /// @dev highest-priced bid with price >= limit
    function _bestBid(uint256 limitPrice) internal view returns (uint256 id, bool found) {
        uint256 best = 0;
        for (uint256 i = 0; i < bids.length; i++) {
            uint256 p = orders[bids[i]].price;
            if (p >= limitPrice && p > best) {
                best = p;
                id = bids[i];
                found = true;
            }
        }
    }

    // --- helpers ---

    function _rest(address trader, bool isBuy, uint256 price, uint256 amount) internal returns (uint256 id) {
        id = nextId++;
        orders[id] = Order({id: id, trader: trader, isBuy: isBuy, price: price, amount: amount});
        if (isBuy) {
            bids.push(id);
        } else {
            asks.push(id);
        }
        emit OrderPlaced(id, trader, isBuy, price, amount);
    }

    function _remove(uint256[] storage arr, uint256 id) internal {
        uint256 n = arr.length;
        for (uint256 i = 0; i < n; i++) {
            if (arr[i] == id) {
                arr[i] = arr[n - 1];
                arr.pop();
                return;
            }
        }
    }

    function _quoteAmount(uint256 amount, uint256 price) internal pure returns (uint256) {
        return (amount * price) / PRICE_SCALE;
    }

    // --- views (for the frontend / agent) ---

    function getBids() external view returns (Order[] memory out) {
        out = new Order[](bids.length);
        for (uint256 i = 0; i < bids.length; i++) {
            out[i] = orders[bids[i]];
        }
    }

    function getAsks() external view returns (Order[] memory out) {
        out = new Order[](asks.length);
        for (uint256 i = 0; i < asks.length; i++) {
            out[i] = orders[asks[i]];
        }
    }

    function bidCount() external view returns (uint256) {
        return bids.length;
    }

    function askCount() external view returns (uint256) {
        return asks.length;
    }
}
