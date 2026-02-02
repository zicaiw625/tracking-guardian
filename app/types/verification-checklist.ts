export interface TestChecklistItem {
  id: string;
  name: string;
  description: string;
  eventType: string;
  required: boolean;
  platforms: string[];
  steps: string[];
  expectedResults: string[];
  estimatedTime: number;
  category: "purchase" | "cart" | "refund" | "order_edit";
}

export interface PixelLayerItem {
  eventName: string;
  description: string;
  required: boolean;
  verificationPoints: string[];
  expectedParams?: string[];
}

export interface OrderLayerItem {
  eventType: string;
  description: string;
  required: boolean;
  verificationPoints: string[];
  expectedFields?: string[];
}

export interface TestChecklist {
  shopId: string;
  generatedAt: Date;
  testType: "quick" | "full" | "custom";
  items: TestChecklistItem[];
  pixelLayer: PixelLayerItem[];
  orderLayer: OrderLayerItem[];
  totalEstimatedTime: number;
  requiredItemsCount: number;
  optionalItemsCount: number;
  shopifyOfficialGuides?: {
    testCheckout: string;
    testPixels: string;
  };
}
