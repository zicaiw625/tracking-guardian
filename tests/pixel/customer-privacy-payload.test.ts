   
                          
   
                              
                                
                                                        
   
                                          
   

import { describe, it, expect } from "vitest";

                               
interface CustomerPrivacyState {
  analyticsProcessingAllowed: boolean;
  marketingAllowed: boolean;
  preferencesProcessingAllowed: boolean;
  saleOfDataAllowed: boolean;
}

interface VisitorConsentCollectedEvent {
  customerPrivacy: CustomerPrivacyState;
}

                      
function parseInitialConsent(customerPrivacy: CustomerPrivacyState | undefined): {
  marketingAllowed: boolean;
  analyticsAllowed: boolean;
  saleOfDataAllowed: boolean;
} {
  if (!customerPrivacy) {
    return {
      marketingAllowed: false,
      analyticsAllowed: false,
      saleOfDataAllowed: true,               
    };
  }

  return {
    marketingAllowed: customerPrivacy.marketingAllowed === true,
    analyticsAllowed: customerPrivacy.analyticsProcessingAllowed === true,
    saleOfDataAllowed: customerPrivacy.saleOfDataAllowed !== false,
  };
}

function parseConsentUpdate(event: VisitorConsentCollectedEvent): {
  marketingAllowed: boolean;
  analyticsAllowed: boolean;
  saleOfDataAllowed: boolean;
} | null {
  const updatedPrivacy = event.customerPrivacy;
  
  if (!updatedPrivacy) {
    return null;
  }

  return {
    marketingAllowed: updatedPrivacy.marketingAllowed === true,
    analyticsAllowed: updatedPrivacy.analyticsProcessingAllowed === true,
    saleOfDataAllowed: updatedPrivacy.saleOfDataAllowed !== false,
  };
}

describe("init.customerPrivacy 初始值解析", () => {
  it("应正确解析完全同意的状态", () => {
    const privacyState: CustomerPrivacyState = {
      analyticsProcessingAllowed: true,
      marketingAllowed: true,
      preferencesProcessingAllowed: true,
      saleOfDataAllowed: true,
    };

    const result = parseInitialConsent(privacyState);

    expect(result.marketingAllowed).toBe(true);
    expect(result.analyticsAllowed).toBe(true);
    expect(result.saleOfDataAllowed).toBe(true);
  });

  it("应正确解析仅分析同意的状态", () => {
    const privacyState: CustomerPrivacyState = {
      analyticsProcessingAllowed: true,
      marketingAllowed: false,
      preferencesProcessingAllowed: false,
      saleOfDataAllowed: true,
    };

    const result = parseInitialConsent(privacyState);

    expect(result.marketingAllowed).toBe(false);
    expect(result.analyticsAllowed).toBe(true);
    expect(result.saleOfDataAllowed).toBe(true);
  });

  it("应正确处理 saleOfData 明确拒绝", () => {
    const privacyState: CustomerPrivacyState = {
      analyticsProcessingAllowed: true,
      marketingAllowed: true,
      preferencesProcessingAllowed: true,
      saleOfDataAllowed: false,
    };

    const result = parseInitialConsent(privacyState);

    expect(result.saleOfDataAllowed).toBe(false);
  });

  it("应正确处理 undefined 初始状态（不需要同意的地区）", () => {
    const result = parseInitialConsent(undefined);

                             
    expect(result.marketingAllowed).toBe(false);
    expect(result.analyticsAllowed).toBe(false);
    expect(result.saleOfDataAllowed).toBe(true);        
  });
});

describe("visitorConsentCollected 事件解析", () => {
  it("应正确解析嵌套的 event.customerPrivacy 对象", () => {
                  
    const event: VisitorConsentCollectedEvent = {
      customerPrivacy: {
        analyticsProcessingAllowed: true,
        marketingAllowed: true,
        preferencesProcessingAllowed: false,
        saleOfDataAllowed: true,
      },
    };

    const result = parseConsentUpdate(event);

    expect(result).not.toBeNull();
    expect(result!.marketingAllowed).toBe(true);
    expect(result!.analyticsAllowed).toBe(true);
    expect(result!.saleOfDataAllowed).toBe(true);
  });

  it("应正确处理用户拒绝营销同意", () => {
    const event: VisitorConsentCollectedEvent = {
      customerPrivacy: {
        analyticsProcessingAllowed: true,
        marketingAllowed: false,
        preferencesProcessingAllowed: false,
        saleOfDataAllowed: true,
      },
    };

    const result = parseConsentUpdate(event);

    expect(result!.marketingAllowed).toBe(false);
    expect(result!.analyticsAllowed).toBe(true);
  });

  it("应正确处理 CCPA 数据销售退出", () => {
    const event: VisitorConsentCollectedEvent = {
      customerPrivacy: {
        analyticsProcessingAllowed: true,
        marketingAllowed: true,
        preferencesProcessingAllowed: false,
        saleOfDataAllowed: false,             
      },
    };

    const result = parseConsentUpdate(event);

    expect(result!.saleOfDataAllowed).toBe(false);
  });
});

describe("hasFullConsent 严格模式验证（对应 P0-5）", () => {
  function hasFullConsent(
    marketingAllowed: boolean,
    analyticsAllowed: boolean,
    saleOfDataAllowed: boolean
  ): boolean {
    return analyticsAllowed === true && marketingAllowed === true && saleOfDataAllowed;
  }

  it("只有完全同意才返回 true", () => {
    expect(hasFullConsent(true, true, true)).toBe(true);
  });

  it("缺少营销同意返回 false", () => {
    expect(hasFullConsent(false, true, true)).toBe(false);
  });

  it("缺少分析同意返回 false", () => {
    expect(hasFullConsent(true, false, true)).toBe(false);
  });

  it("数据销售退出返回 false", () => {
    expect(hasFullConsent(true, true, false)).toBe(false);
  });
});

describe("边缘情况处理", () => {
  it("应安全处理 null 值（作为 false 处理）", () => {
    const privacyState = {
      analyticsProcessingAllowed: null as unknown as boolean,
      marketingAllowed: null as unknown as boolean,
      preferencesProcessingAllowed: null as unknown as boolean,
      saleOfDataAllowed: null as unknown as boolean,
    };

    const result = parseInitialConsent(privacyState);

                                
    expect(result.marketingAllowed).toBe(false);
    expect(result.analyticsAllowed).toBe(false);
                                        
    expect(result.saleOfDataAllowed).toBe(true);
  });

  it("应安全处理 undefined 值（作为 false 处理）", () => {
    const privacyState = {
      analyticsProcessingAllowed: undefined as unknown as boolean,
      marketingAllowed: undefined as unknown as boolean,
      preferencesProcessingAllowed: undefined as unknown as boolean,
      saleOfDataAllowed: undefined as unknown as boolean,
    };

    const result = parseInitialConsent(privacyState);

    expect(result.marketingAllowed).toBe(false);
    expect(result.analyticsAllowed).toBe(false);
    expect(result.saleOfDataAllowed).toBe(true);
  });
});

