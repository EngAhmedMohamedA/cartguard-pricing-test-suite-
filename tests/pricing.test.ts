import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCoupon,
  calculateOrder,
  fetchCoupon,
  findCoupon,
  lineTotal,
  priceOrder,
  readPricingConfig,
  shippingFee,
  subtotal,
  tierDiscountPercent,
  type CartItem,
  type Coupon,
} from "../src/pricing.js";

const item = (unitPrice: number, quantity = 1, sku = "NG-100"): CartItem => ({ sku, unitPrice, quantity });
const originalEnv = { VAT_RATE: process.env.VAT_RATE, FREE_SHIPPING_THRESHOLD: process.env.FREE_SHIPPING_THRESHOLD };

beforeEach(() => {
  delete process.env.VAT_RATE;
  delete process.env.FREE_SHIPPING_THRESHOLD;
});

afterEach(() => {
  vi.useRealTimers();
  if (originalEnv.VAT_RATE === undefined) delete process.env.VAT_RATE;
  else process.env.VAT_RATE = originalEnv.VAT_RATE;
  if (originalEnv.FREE_SHIPPING_THRESHOLD === undefined) delete process.env.FREE_SHIPPING_THRESHOLD;
  else process.env.FREE_SHIPPING_THRESHOLD = originalEnv.FREE_SHIPPING_THRESHOLD;
});

describe("lineTotal (R1)", () => {
  it.each([
    [100, 1, 100], [19.99, 3, 59.97], [0, 4, 0], [12.345, 1, 12.35], [1.005, 1, 1.01],
  ])("returns the rounded total for %s × %s", (price, quantity, expected) => {
    expect(lineTotal(item(price, quantity))).toBe(expected);
  });

  it.each([
    [0, "quantity", 0], [-1, "quantity", -1], [1.5, "quantity", 1.5], [NaN, "quantity", NaN],
  ])("rejects invalid quantity %s", (quantity, field, received) => {
    expect(() => lineTotal(item(1, quantity))).toThrow(RangeError);
    expect(() => lineTotal(item(1, quantity))).toThrow("NG-100");
    expect(() => lineTotal(item(1, quantity))).toThrow(field);
    expect(() => lineTotal(item(1, quantity))).toThrow(String(received));
  });

  it.each([-0.01, Infinity, -Infinity, NaN])("rejects invalid unit price %s", (unitPrice) => {
    expect(() => lineTotal(item(unitPrice))).toThrow(RangeError);
    expect(() => lineTotal(item(unitPrice))).toThrow("unitPrice");
    expect(() => lineTotal(item(unitPrice))).toThrow("NG-100");
  });

  it("allows a zero price", () => expect(lineTotal(item(0, 1))).toBe(0));
});

describe("subtotal (R2)", () => {
  it("sums rounded line totals", () => {
    expect(subtotal([item(0.105), item(0.105, 2, "NG-200")])).toBe(0.32);
  });
  it("returns zero for an empty cart", () => expect(subtotal([])).toBe(0));
  it("sums line totals rounded to cents", () => expect(subtotal([item(10.004), item(0.006)])).toBe(10.01));
  it("validates each item instead of summing raw fields", () => {
    expect(() => subtotal([item(10, 0)])).toThrow(RangeError);
  });
});

describe("tierDiscountPercent (R3)", () => {
  it.each([[0, 0], [499.99, 0], [500, 10], [999.99, 10], [1000, 15], [1500, 15]])(
    "uses the correct tier at subtotal %s", (amount, expected) => {
      expect(tierDiscountPercent(amount)).toBe(expected);
    },
  );
  it("does not add the lower tier to the upper tier", () => expect(tierDiscountPercent(1000)).toBe(15));
});

describe("coupon rules (R4)", () => {
  it.each([["save10", "SAVE10"], [" SAVE20 ", "SAVE20"], [" flat50 ", "FLAT50"]])(
    "trims and normalizes %s", (code, expected) => expect(findCoupon(code).code).toBe(expected),
  );

  it("defines SAVE10 as ten percent", () => expect(findCoupon("SAVE10")).toMatchObject({ kind: "percent", value: 10 }));
  it("defines SAVE20 as twenty percent with an 800 minimum", () => {
    expect(findCoupon("SAVE20")).toMatchObject({ kind: "percent", value: 20, minimumSubtotal: 800 });
  });
  it("defines FLAT50 as fifty EGP", () => expect(findCoupon("FLAT50")).toMatchObject({ kind: "flat", value: 50 }));
  it("rejects unknown codes with the code in the error", () => {
    expect(() => findCoupon("VIP99")).toThrow(/^Unknown coupon code: VIP99$/);
  });
  it("requires the SAVE20 minimum based on the pre-discount subtotal", () => {
    expect(() => applyCoupon(700, 799.99, findCoupon("SAVE20"))).toThrow(/SAVE20.*800.*799\.99/);
  });
  it("allows SAVE20 at exactly 800 before discounts", () => {
    expect(applyCoupon(720, 800, findCoupon("SAVE20"))).toBe(144);
  });
});

describe("discount order and cap (R5)", () => {
  it("calculates a percentage coupon on the amount after tier discount", () => {
    expect(calculateOrder([item(1000)], "SAVE10")).toMatchObject({ tierDiscount: 150, couponDiscount: 85, discountedAmount: 765 });
  });
  it("caps FLAT50 at the amount remaining after the tier discount", () => {
    const coupon: Coupon = { code: "FLAT50", kind: "flat", value: 50 };
    expect(applyCoupon(12, 12, coupon)).toBe(12);
  });
  it("never returns a negative discounted order amount", () => {
    expect(calculateOrder([item(20)], "FLAT50").discountedAmount).toBe(0);
  });
  it("rounds percentage coupon discounts to cents", () => {
    expect(applyCoupon(10.05, 100, findCoupon("SAVE10"))).toBe(1.01);
  });
});

describe("VAT (R6)", () => {
  it("uses the default VAT rate", () => {
    delete process.env.VAT_RATE;
    expect(calculateOrder([item(100)]).vat).toBe(14);
  });
  it("rounds VAT to two decimals", () => {
    process.env.VAT_RATE = "0.14";
    expect(calculateOrder([item(10)]).vat).toBe(1.4);
  });
  it("does not tax shipping", () => {
    const order = calculateOrder([item(100)]);
    expect(order.shipping).toBe(50);
    expect(order.vat).toBe(14);
  });
});

describe("shippingFee (R7)", () => {
  it("is free for an empty cart", () => expect(shippingFee(0, 0, 500)).toBe(0));
  it("is free at the threshold", () => expect(shippingFee(500, 1, 500)).toBe(0));
  it("is free above the threshold", () => expect(shippingFee(501, 2, 500)).toBe(0));
  it("costs 50 below the threshold", () => expect(shippingFee(499.99, 1, 500)).toBe(50));
  it("uses 500 as the default free-shipping threshold", () => expect(shippingFee(500, 1)).toBe(0));
  it("uses the amount after discounts", () => {
    expect(calculateOrder([item(600)], "SAVE10").shipping).toBe(50);
  });
  it("uses the configured threshold", () => expect(shippingFee(400, 1, 400)).toBe(0));
});

describe("calculateOrder (R8)", () => {
  it("returns every required amount for a simple order", () => {
    expect(calculateOrder([item(100)])).toEqual({
      subtotal: 100, tierDiscount: 0, couponDiscount: 0, discountedAmount: 100, vat: 14, shipping: 50, total: 164,
    });
  });
  it("returns zero for every field on an empty cart", () => {
    expect(calculateOrder([])).toEqual({
      subtotal: 0, tierDiscount: 0, couponDiscount: 0, discountedAmount: 0, vat: 0, shipping: 0, total: 0,
    });
  });
  it("combines tier, coupon, VAT, shipping and total in the specified order", () => {
    process.env.FREE_SHIPPING_THRESHOLD = "500";
    expect(calculateOrder([item(1000)], "SAVE10")).toEqual({
      subtotal: 1000, tierDiscount: 150, couponDiscount: 85, discountedAmount: 765, vat: 107.1, shipping: 0, total: 872.1,
    });
  });
  it("uses the flat coupon in the complete order breakdown", () => {
    expect(calculateOrder([item(100)], "FLAT50")).toMatchObject({ couponDiscount: 50, discountedAmount: 50, vat: 7, shipping: 50, total: 107 });
  });
  it("keeps discount amounts as EGP amounts", () => {
    const order = calculateOrder([item(1000)]);
    expect(order.tierDiscount).toBe(150);
  });
});

describe("readPricingConfig (R9)", () => {
  it("uses both defaults when variables are absent", () => {
    delete process.env.VAT_RATE;
    delete process.env.FREE_SHIPPING_THRESHOLD;
    expect(readPricingConfig()).toEqual({ vatRate: 0.14, freeShippingThreshold: 500 });
  });
  it("uses defaults for empty values", () => {
    process.env.VAT_RATE = "";
    process.env.FREE_SHIPPING_THRESHOLD = "  ";
    expect(readPricingConfig()).toEqual({ vatRate: 0.14, freeShippingThreshold: 500 });
  });
  it("reads environment values on every call", () => {
    process.env.VAT_RATE = "0.1";
    expect(readPricingConfig().vatRate).toBe(0.1);
    process.env.VAT_RATE = "0.2";
    expect(readPricingConfig().vatRate).toBe(0.2);
  });
  it.each(["abc", "-0.1", "Infinity"]) ("rejects invalid VAT_RATE %s and names the value", (value) => {
    process.env.VAT_RATE = value;
    expect(() => readPricingConfig()).toThrow("VAT_RATE");
    expect(() => readPricingConfig()).toThrow(value);
  });
  it("rejects VAT_RATE above one", () => {
    process.env.VAT_RATE = "1.01";
    expect(() => readPricingConfig()).toThrow(/VAT_RATE.*1\.01/);
  });
  it.each(["nope", "-1"]) ("rejects invalid FREE_SHIPPING_THRESHOLD %s", (value) => {
    process.env.FREE_SHIPPING_THRESHOLD = value;
    expect(() => readPricingConfig()).toThrow("FREE_SHIPPING_THRESHOLD");
    expect(() => readPricingConfig()).toThrow(value);
  });
});

describe("async pricing (R10)", () => {
  it("waits approximately 50ms before returning a known coupon", async () => {
    vi.useFakeTimers();
    const pending = fetchCoupon("SAVE10");
    await vi.advanceTimersByTimeAsync(49);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ code: "SAVE10" });
  });
  it("rejects unknown asynchronous coupon codes with the R4 error", async () => {
    vi.useFakeTimers();
    const pending = fetchCoupon("NOTREAL");
    const assertion = expect(pending).rejects.toThrow("Unknown coupon code: NOTREAL");
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
  it("returns the same breakdown as calculateOrder for a valid coupon", async () => {
    vi.useFakeTimers();
    const pending = priceOrder([item(1000)], "SAVE10");
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toEqual(calculateOrder([item(1000)], "SAVE10"));
  });
  it("prices an order without a coupon asynchronously", async () => {
    await expect(priceOrder([item(100)])).resolves.toEqual(calculateOrder([item(100)]));
  });
  it("rejects SAVE20 when the pre-discount subtotal is too low", async () => {
    vi.useFakeTimers();
    const pending = priceOrder([item(799.99)], "SAVE20");
    const assertion = expect(pending).rejects.toThrow(/minimum subtotal of 800/);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
});

describe("no side effects (R11)", () => {
  it("does not change the items array or item objects", () => {
    const first = Object.freeze({ sku: "A", unitPrice: 400, quantity: 1 });
    const second = Object.freeze({ sku: "B", unitPrice: 200, quantity: 1 });
    const items = Object.freeze([first, second]);
    const before = JSON.stringify(items);
    calculateOrder(items, "SAVE10");
    expect(JSON.stringify(items)).toBe(before);
  });
  it("does not change the coupon object passed to applyCoupon", () => {
    const coupon = Object.freeze({ code: "SAVE10" as const, kind: "percent" as const, value: 10 });
    const before = JSON.stringify(coupon);
    applyCoupon(100, 100, coupon);
    expect(JSON.stringify(coupon)).toBe(before);
  });
  it("does not mutate items during asynchronous pricing", async () => {
    vi.useFakeTimers();
    const source = Object.freeze([Object.freeze({ sku: "A", unitPrice: 1000, quantity: 1 })]);
    const before = JSON.stringify(source);
    const pending = priceOrder(source, "SAVE10");
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    expect(JSON.stringify(source)).toBe(before);
  });
});
