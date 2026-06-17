const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OrderBook (CLOB)", function () {
  let base, quote, book, seller, buyer;
  const E = (n) => ethers.parseEther(n.toString());

  beforeEach(async () => {
    [, seller, buyer] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    base = await Mock.deploy("Mock SOM", "mSOM");
    quote = await Mock.deploy("Mock USDC", "mUSDC");
    await base.waitForDeployment();
    await quote.waitForDeployment();

    const Book = await ethers.getContractFactory("OrderBook");
    book = await Book.deploy(base.target, quote.target);
    await book.waitForDeployment();

    await base.mint(seller.address, E(100));
    await quote.mint(buyer.address, E(1000));
    await base.connect(seller).approve(book.target, ethers.MaxUint256);
    await quote.connect(buyer).approve(book.target, ethers.MaxUint256);
  });

  it("rests a sell order and matches an incoming buy at the maker price", async () => {
    // seller: sell 10 base @ 2 quote/base  -> rests as an ask, locks 10 base
    await book.connect(seller).placeLimitOrder(false, E(2), E(10));
    expect(await base.balanceOf(book.target)).to.equal(E(10));
    expect(await book.askCount()).to.equal(1n);

    // buyer: buy 4 base @ 2 -> fills 4 against the ask
    await book.connect(buyer).placeLimitOrder(true, E(2), E(4));

    expect(await base.balanceOf(buyer.address)).to.equal(E(4)); // got 4 base
    expect(await quote.balanceOf(seller.address)).to.equal(E(8)); // paid 4*2 = 8 quote
    expect(await quote.balanceOf(buyer.address)).to.equal(E(1000) - E(8));
    expect(await base.balanceOf(book.target)).to.equal(E(6)); // 6 base still resting
    expect(await book.askCount()).to.equal(1n);
  });

  it("partially fills, rests the remainder as a bid, and refunds on cancel", async () => {
    // seller: ask 6 base @ 2
    await book.connect(seller).placeLimitOrder(false, E(2), E(6));

    // buyer: buy 10 @ 2 -> fills 6, remainder 4 rests as a bid (locks 4*2 = 8 quote)
    await book.connect(buyer).placeLimitOrder(true, E(2), E(10));

    expect(await base.balanceOf(buyer.address)).to.equal(E(6));
    expect(await book.askCount()).to.equal(0n);
    expect(await book.bidCount()).to.equal(1n);
    expect(await quote.balanceOf(book.target)).to.equal(E(8)); // locked bid

    // ask id 1 was consumed/deleted; resting bid is id 2
    const before = await quote.balanceOf(buyer.address);
    await book.connect(buyer).cancelOrder(2);
    const after = await quote.balanceOf(buyer.address);
    expect(after - before).to.equal(E(8)); // refunded
    expect(await book.bidCount()).to.equal(0n);
    expect(await quote.balanceOf(book.target)).to.equal(0n);
  });

  it("rests a non-crossing buy as a bid", async () => {
    // no asks on the book -> buy rests as a bid, locks quote
    await book.connect(buyer).placeLimitOrder(true, E(3), E(5));
    expect(await book.bidCount()).to.equal(1n);
    expect(await quote.balanceOf(book.target)).to.equal(E(15)); // 5*3
  });
});
