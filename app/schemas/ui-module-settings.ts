

import { z } from "zod";

export const MODULE_KEYS = [
  "survey",
  "reorder",
  "support",
  "shipping_tracker",
  "upsell_offer",
] as const;

export type ModuleKey = typeof MODULE_KEYS[number];

export const DisplayRuleSchema = z.object({

  showOnThankYou: z.boolean().default(true),
  showOnOrderStatus: z.boolean().default(true),

  minOrderValue: z.number().optional(),
  maxOrderValue: z.number().optional(),

  orderStatuses: z.array(z.string()).optional(),

  productTags: z.array(z.string()).optional(),
  productTypes: z.array(z.string()).optional(),

  customerTags: z.array(z.string()).optional(),

  showAfterHours: z.number().optional(),
  showBeforeHours: z.number().optional(),

  customConditions: z.record(z.unknown()).optional(),
});

export type DisplayRule = z.infer<typeof DisplayRuleSchema>;

export const LocalizationSchema = z.object({

  locale: z.string().default("en"),

  translations: z.record(z.string()).optional(),

  dateFormat: z.string().default("YYYY-MM-DD"),

  currencyFormat: z.string().default("USD"),
});

export type Localization = z.infer<typeof LocalizationSchema>;

export const SurveySettingsSchema = z.object({
  title: z.string().default("How was your experience?"),
  question: z.string().default("Rate your experience"),
  showRating: z.boolean().default(true),
  showFeedback: z.boolean().default(true),
  required: z.boolean().default(false),
  submitButtonText: z.string().default("Submit"),
  thankYouMessage: z.string().default("Thank you for your feedback!"),
  customFields: z.array(z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum(["text", "textarea", "select", "radio", "checkbox"]),
    required: z.boolean().default(false),
    options: z.array(z.string()).optional(),
  })).optional(),
});

export type SurveySettings = z.infer<typeof SurveySettingsSchema>;

export const ReorderSettingsSchema = z.object({
  buttonText: z.string().default("Reorder"),
  buttonStyle: z.enum(["primary", "secondary", "outline"]).default("primary"),
  showQuantitySelector: z.boolean().default(true),
  allowPartialReorder: z.boolean().default(false),
  redirectUrl: z.string().optional(),
});

export type ReorderSettings = z.infer<typeof ReorderSettingsSchema>;

export const SupportSettingsSchema = z.object({
  title: z.string().default("Need Help?"),
  description: z.string().default("Contact our support team"),
  contactUrl: z.string().optional(),
  contactEmail: z.string().optional(),
  faqItems: z.array(z.object({
    id: z.string(),
    question: z.string(),
    answer: z.string(),
  })).optional(),
  showChatWidget: z.boolean().default(false),
  chatWidgetUrl: z.string().optional(),
});

export type SupportSettings = z.infer<typeof SupportSettingsSchema>;

export const ShippingTrackerSettingsSchema = z.object({
  title: z.string().default("Order Status"),
  showProgressBar: z.boolean().default(true),
  showTrackingNumber: z.boolean().default(true),
  showEstimatedDelivery: z.boolean().default(true),
  tipText: z.string().optional(),
  customStatusLabels: z.record(z.string()).optional(),
});

export type ShippingTrackerSettings = z.infer<typeof ShippingTrackerSettingsSchema>;

export const UpsellOfferSettingsSchema = z.object({
  discountCode: z.string().optional(),
  discountPercent: z.number().optional(),
  discountAmount: z.number().optional(),
  expiryHours: z.number().default(24),
  title: z.string().default("Special Offer"),
  description: z.string().default("Get an extra discount on your next order"),
  buttonText: z.string().default("Claim Offer"),
  continueShoppingUrl: z.string().optional(),
});

export type UpsellOfferSettings = z.infer<typeof UpsellOfferSettingsSchema>;

export const ModuleSettingsSchema = z.object({

  isEnabled: z.boolean().default(true),
  moduleKey: z.enum(MODULE_KEYS),

  survey: SurveySettingsSchema.optional(),
  reorder: ReorderSettingsSchema.optional(),
  support: SupportSettingsSchema.optional(),
  shipping_tracker: ShippingTrackerSettingsSchema.optional(),
  upsell_offer: UpsellOfferSettingsSchema.optional(),

  displayRules: DisplayRuleSchema.optional(),

  localization: z.array(LocalizationSchema).optional(),

  version: z.number().default(1),
  updatedAt: z.string().optional(),
});

export type ModuleSettings = z.infer<typeof ModuleSettingsSchema>;

export function validateModuleSettings(
  moduleKey: ModuleKey,
  settings: unknown
): { valid: boolean; error?: string; normalized?: ModuleSettings } {
  try {
    const baseSchema = ModuleSettingsSchema.pick({
      isEnabled: true,
      moduleKey: true,
      displayRules: true,
      localization: true,
      version: true,
      updatedAt: true,
    });

    let schema = baseSchema;
    switch (moduleKey) {
      case "survey":
        schema = baseSchema.extend({ survey: SurveySettingsSchema });
        break;
      case "reorder":
        schema = baseSchema.extend({ reorder: ReorderSettingsSchema });
        break;
      case "support":
        schema = baseSchema.extend({ support: SupportSettingsSchema });
        break;
      case "shipping_tracker":
        schema = baseSchema.extend({ shipping_tracker: ShippingTrackerSettingsSchema });
        break;
      case "upsell_offer":
        schema = baseSchema.extend({ upsell_offer: UpsellOfferSettingsSchema });
        break;
    }

    const normalized = schema.parse({
      ...settings,
      moduleKey,
    });

    return { valid: true, normalized };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        valid: false,
        error: error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", "),
      };
    }
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export function getDefaultModuleSettings(moduleKey: ModuleKey): ModuleSettings {
  const base: ModuleSettings = {
    isEnabled: true,
    moduleKey,
    displayRules: {
      showOnThankYou: true,
      showOnOrderStatus: true,
    },
    version: 1,
  };

  switch (moduleKey) {
    case "survey":
      return {
        ...base,
        survey: SurveySettingsSchema.parse({}),
      };
    case "reorder":
      return {
        ...base,
        reorder: ReorderSettingsSchema.parse({}),
      };
    case "support":
      return {
        ...base,
        support: SupportSettingsSchema.parse({}),
      };
    case "shipping_tracker":
      return {
        ...base,
        shipping_tracker: ShippingTrackerSettingsSchema.parse({}),
      };
    case "upsell_offer":
      return {
        ...base,
        upsell_offer: UpsellOfferSettingsSchema.parse({}),
      };
    default:
      return base;
  }
}

export function mergeModuleSettings(
  existing: Partial<ModuleSettings>,
  updates: Partial<ModuleSettings>
): ModuleSettings {
  return {
    ...getDefaultModuleSettings(updates.moduleKey || existing.moduleKey || "survey"),
    ...existing,
    ...updates,
    displayRules: {
      ...getDefaultModuleSettings(updates.moduleKey || existing.moduleKey || "survey").displayRules,
      ...existing.displayRules,
      ...updates.displayRules,
    },
  };
}
