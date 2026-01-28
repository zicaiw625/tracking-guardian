import { useState, useMemo } from "react";
import type { RealtimeEvent } from "../RealtimeEventMonitor";

export interface UseEventFiltersReturn {
  filterPlatform: string;
  setFilterPlatform: (platform: string) => void;
  filterStatus: string[];
  setFilterStatus: (status: string[]) => void;
  filterEventType: string;
  setFilterEventType: (type: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredEvents: RealtimeEvent[];
  uniquePlatforms: string[];
  uniqueEventTypes: string[];
  clearFilters: () => void;
}

export function useEventFilters(events: RealtimeEvent[]): UseEventFiltersReturn {
  const [filterPlatform, setFilterPlatform] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterEventType, setFilterEventType] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (filterPlatform !== "all" && event.platform !== filterPlatform) {
        return false;
      }
      if (filterStatus.length > 0 && !filterStatus.includes(event.status)) {
        return false;
      }
      if (filterEventType && event.eventType !== filterEventType) {
        return false;
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesType = event.eventType.toLowerCase().includes(query);
        const matchesPlatform = event.platform.toLowerCase().includes(query);
        const matchesOrderId = event.orderId?.toLowerCase().includes(query) || false;
        const matchesOrderNumber = event.orderNumber?.toLowerCase().includes(query) || false;
        if (!matchesType && !matchesPlatform && !matchesOrderId && !matchesOrderNumber) {
          return false;
        }
      }
      return true;
    });
  }, [events, filterPlatform, filterStatus, filterEventType, searchQuery]);

  const uniquePlatforms = useMemo(() => {
    const platformsSet = new Set(events.map(e => e.platform));
    return Array.from(platformsSet).sort();
  }, [events]);

  const uniqueEventTypes = useMemo(() => {
    const typesSet = new Set(events.map(e => e.eventType));
    return Array.from(typesSet).sort();
  }, [events]);

  const clearFilters = () => {
    setFilterPlatform("all");
    setFilterStatus([]);
    setFilterEventType("");
    setSearchQuery("");
  };

  return {
    filterPlatform,
    setFilterPlatform,
    filterStatus,
    setFilterStatus,
    filterEventType,
    setFilterEventType,
    searchQuery,
    setSearchQuery,
    filteredEvents,
    uniquePlatforms,
    uniqueEventTypes,
    clearFilters,
  };
}
