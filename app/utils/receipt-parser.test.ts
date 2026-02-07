import { extractEventData } from "./receipt-parser";
import { describe, test, expect } from "vitest";

describe("receipt-parser", () => {
  test("extracts value from number", () => {
    const payload = { data: { value: 100, currency: "USD" } };
    const result = extractEventData(payload);
    expect(result.value).toBe(100);
    expect(result.currency).toBe("USD");
  });

  test("extracts value from string number", () => {
    const payload = { data: { value: "100.50", currency: "USD" } };
    const result = extractEventData(payload);
    expect(result.value).toBe(100.5);
  });

  test("extracts value from currency string", () => {
    const payload = { data: { value: "$1,234.56", currency: "USD" } };
    const result = extractEventData(payload);
    expect(result.value).toBe(1234.56);
  });

  test("extracts value from complex string", () => {
    const payload = { data: { value: "EUR 50.00", currency: "EUR" } };
    const result = extractEventData(payload);
    expect(result.value).toBe(50);
  });

  test("returns undefined for invalid value", () => {
    const payload = { data: { value: "invalid", currency: "USD" } };
    const result = extractEventData(payload);
    expect(result.value).toBeUndefined();
  });

  test("extracts orderId", () => {
    const payload = { data: { orderId: "12345" } };
    const result = extractEventData(payload);
    expect(result.orderId).toBe("12345");
  });

  test("handles comma ambiguity correctly", () => {
    // 1,000 -> 1000 (ends with 3 digits -> thousands separator)
    expect(extractEventData({ data: { value: "1,000" } }).value).toBe(1000);
    
    // 1,234 -> 1234 (ends with 3 digits -> thousands separator)
    expect(extractEventData({ data: { value: "1,234" } }).value).toBe(1234);

    // 1,50 -> 1.5 (ends with 2 digits -> decimal separator)
    expect(extractEventData({ data: { value: "1,50" } }).value).toBe(1.5);
    
    // 1,5 -> 1.5 (ends with 1 digit -> decimal separator)
    expect(extractEventData({ data: { value: "1,5" } }).value).toBe(1.5);
    
    // 1.234,56 -> 1234.56 (mixed)
    expect(extractEventData({ data: { value: "1.234,56" } }).value).toBe(1234.56);
    
    // 1,234.56 -> 1234.56 (mixed)
    expect(extractEventData({ data: { value: "1,234.56" } }).value).toBe(1234.56);
  });
});
