export interface CartItem {
  sku: string;
  unitPrice: number;
  quantity: number;
}

export type CouponCode = "SAVE10" | "SAVE20" | "FLAT50";

export interface Coupon {
  code: CouponCode;
  kind: "percent" | "flat";
  value: number;
  minimumSubtotal?: number;
}

export interface PricingConfig {
  vatRate: number;
  freeShippingThreshold: number;
}

export interface OrderBreakdown {
  subtotal: number;
  tierDiscount: number;
  couponDiscount: number;
  discountedAmount: number;
  vat: number;
  shipping: number;
  total: number;
}

const COUPONS: Readonly<Record<CouponCode, Readonly<Coupon>>> = Object.freeze({
  SAVE10: Object.freeze({ code: "SAVE10", kind: "percent", value: 10 }),
  SAVE20: Object.freeze({ code: "SAVE20", kind: "percent", value: 20, minimumSubtotal: 800 }),
  FLAT50: Object.freeze({ code: "FLAT50", kind: "flat", value: 50 }),
});

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function received(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

export function lineTotal(item: CartItem): number {
  const sku = item?.sku;
  const unitPrice: unknown = item?.unitPrice;
  const quantity: unknown = item?.quantity;

  if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new RangeError(
      `Invalid item ${String(sku)}: unitPrice must be a finite number >= 0; received ${received(unitPrice)}`,
    );
  }
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError(
      `Invalid item ${String(sku)}: quantity must be a whole number >= 1; received ${received(quantity)}`,
    );
  }

  return round2(unitPrice * quantity);
}

export function subtotal(items: readonly CartItem[]): number {
  return round2(items.reduce((sum, item) => sum + lineTotal(item), 0));
}

export function tierDiscountPercent(subtotalAmount: number): number {
  if (subtotalAmount >= 1000) return 15;
  if (subtotalAmount >= 500) return 10;
  return 0;
}

export function findCoupon(code: string): Coupon {
  const normalized = code.trim().toUpperCase();
  if (normalized === "SAVE10" || normalized === "SAVE20" || normalized === "FLAT50") {
    return { ...COUPONS[normalized] };
  }
  throw new Error(`Unknown coupon code: ${code}`);
}

export function applyCoupon(
  amountAfterTier: number,
  subtotalBeforeDiscounts: number,
  coupon: Coupon,
): number {
  if (coupon.code === "SAVE20" && subtotalBeforeDiscounts < (coupon.minimumSubtotal ?? 800)) {
    throw new Error(
      `Coupon ${coupon.code} requires a minimum subtotal of ${coupon.minimumSubtotal ?? 800}; received ${subtotalBeforeDiscounts}`,
    );
  }

  if (coupon.kind === "percent") return round2(amountAfterTier * (coupon.value / 100));
  return round2(Math.min(coupon.value, Math.max(0, amountAfterTier)));
}

export function readPricingConfig(): PricingConfig {
  const vatRate = parseConfigValue("VAT_RATE", 0.14);
  if (vatRate > 1) {
    throw new Error(`Invalid VAT_RATE: received ${received(process.env.VAT_RATE)}`);
  }

  const freeShippingThreshold = parseConfigValue("FREE_SHIPPING_THRESHOLD", 500);
  return { vatRate, freeShippingThreshold };
}

function parseConfigValue(name: "VAT_RATE" | "FREE_SHIPPING_THRESHOLD", fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}: received ${received(raw)}`);
  }
  return parsed;
}

export function shippingFee(
  discountedAmount: number,
  itemCount: number,
  freeShippingThreshold = 500,
): number {
  if (itemCount === 0 || discountedAmount >= freeShippingThreshold) return 0;
  return 50;
}

function zeroBreakdown(): OrderBreakdown {
  return {
    subtotal: 0,
    tierDiscount: 0,
    couponDiscount: 0,
    discountedAmount: 0,
    vat: 0,
    shipping: 0,
    total: 0,
  };
}

function calculateWithCoupon(items: readonly CartItem[], coupon?: Coupon): OrderBreakdown {
  const config = readPricingConfig();
  if (items.length === 0) return zeroBreakdown();

  const orderSubtotal = subtotal(items);
  const tierPercent = tierDiscountPercent(orderSubtotal);
  const tierDiscount = round2(orderSubtotal * (tierPercent / 100));
  const amountAfterTier = round2(orderSubtotal - tierDiscount);
  const couponDiscount = coupon
    ? applyCoupon(amountAfterTier, orderSubtotal, coupon)
    : 0;
  const discountedAmount = round2(Math.max(0, amountAfterTier - couponDiscount));
  const vat = round2(discountedAmount * config.vatRate);
  const shipping = shippingFee(discountedAmount, items.length, config.freeShippingThreshold);

  return {
    subtotal: orderSubtotal,
    tierDiscount,
    couponDiscount,
    discountedAmount,
    vat,
    shipping,
    total: round2(discountedAmount + vat + shipping),
  };
}

export function calculateOrder(items: readonly CartItem[], couponCode?: string): OrderBreakdown {
  const coupon = couponCode === undefined ? undefined : findCoupon(couponCode);
  return calculateWithCoupon(items, coupon);
}

export async function fetchCoupon(code: string): Promise<Coupon> {
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  return findCoupon(code);
}

export async function priceOrder(items: readonly CartItem[], couponCode?: string): Promise<OrderBreakdown> {
  const coupon = couponCode === undefined ? undefined : await fetchCoupon(couponCode);
  return calculateWithCoupon(items, coupon);
}
