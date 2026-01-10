SELECT 
    COUNT(*) as total_records,
    COUNT("orderKey") as records_with_order_key,
    COUNT(*) - COUNT("orderKey") as records_without_order_key,
    MIN("createdAt") as earliest_record,
    MAX("createdAt") as latest_record
FROM "PixelEventReceipt";

SELECT 
    "shopId",
    "eventType",
    COUNT(*) as count,
    COUNT(DISTINCT COALESCE("orderKey", "id")) as unique_identifiers
FROM "PixelEventReceipt"
GROUP BY "shopId", "eventType"
ORDER BY count DESC
LIMIT 10;

SELECT 
    COUNT(*) as potential_duplicates
FROM (
    SELECT "shopId", COALESCE("orderKey", "id") as identifier, "eventType", COUNT(*)
    FROM "PixelEventReceipt"
    GROUP BY "shopId", COALESCE("orderKey", "id"), "eventType"
    HAVING COUNT(*) > 1
) duplicates;
