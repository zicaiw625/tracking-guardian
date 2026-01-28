import { useState, useCallback, useRef } from "react";
import type { ScriptAnalysisResult } from "~/services/scanner.server";

export interface UseScanStateReturn {
  selectedTab: number;
  setSelectedTab: (tab: number) => void;
  analysisSaved: boolean;
  setAnalysisSaved: (saved: boolean) => void;
  scriptContent: string;
  setScriptContent: (content: string) => void;
  analysisResult: ScriptAnalysisResult | null;
  setAnalysisResult: (result: ScriptAnalysisResult | null) => void;
  analysisError: string | null;
  setAnalysisError: (error: string | null) => void;
  isAnalyzing: boolean;
  setIsAnalyzing: (analyzing: boolean) => void;
  analysisProgress: { current: number; total: number } | null;
  setAnalysisProgress: (progress: { current: number; total: number } | null) => void;
  guidanceModalOpen: boolean;
  setGuidanceModalOpen: (open: boolean) => void;
  guidanceContent: { title: string; platform?: string; scriptTagId?: number } | null;
  setGuidanceContent: (content: { title: string; platform?: string; scriptTagId?: number } | null) => void;
  manualInputWizardOpen: boolean;
  setManualInputWizardOpen: (open: boolean) => void;
  guidedSupplementOpen: boolean;
  setGuidedSupplementOpen: (open: boolean) => void;
  deleteModalOpen: boolean;
  setDeleteModalOpen: (open: boolean) => void;
  pendingDelete: { type: "webPixel"; id: string; gid: string; title: string } | null;
  setPendingDelete: (deleteItem: { type: "webPixel"; id: string; gid: string; title: string } | null) => void;
  deleteError: string | null;
  setDeleteError: (error: string | null) => void;
  monthlyOrders: number;
  setMonthlyOrders: (orders: number) => void;
  isCopying: boolean;
  setIsCopying: (copying: boolean) => void;
  isExporting: boolean;
  setIsExporting: (exporting: boolean) => void;
  pasteProcessed: boolean;
  setPasteProcessed: (processed: boolean) => void;
  analysisSavedRef: React.MutableRefObject<boolean>;
  isReloadingRef: React.MutableRefObject<boolean>;
  isMountedRef: React.MutableRefObject<boolean>;
  paywallViewTrackedRef: React.MutableRefObject<boolean>;
  reloadTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  exportTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  idleCallbackHandlesRef: React.MutableRefObject<Array<number | ReturnType<typeof requestIdleCallback>>>;
  exportBlobUrlRef: React.MutableRefObject<string | null>;
}

export function useScanState(initialTab: number = 0): UseScanStateReturn {
  const [selectedTab, setSelectedTab] = useState(initialTab);
  const [analysisSaved, setAnalysisSaved] = useState(false);
  const [scriptContent, setScriptContent] = useState("");
  const [analysisResult, setAnalysisResult] = useState<ScriptAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number } | null>(null);
  const [guidanceModalOpen, setGuidanceModalOpen] = useState(false);
  const [guidanceContent, setGuidanceContent] = useState<{ title: string; platform?: string; scriptTagId?: number } | null>(null);
  const [manualInputWizardOpen, setManualInputWizardOpen] = useState(false);
  const [guidedSupplementOpen, setGuidedSupplementOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ type: "webPixel"; id: string; gid: string; title: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [monthlyOrders, setMonthlyOrders] = useState(500);
  const [isCopying, setIsCopying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pasteProcessed, setPasteProcessed] = useState(false);

  const analysisSavedRef = useRef(false);
  const isReloadingRef = useRef(false);
  const isMountedRef = useRef(true);
  const paywallViewTrackedRef = useRef(false);
  const reloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const exportTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const idleCallbackHandlesRef = useRef<Array<number | ReturnType<typeof requestIdleCallback>>>([]);
  const exportBlobUrlRef = useRef<string | null>(null);

  return {
    selectedTab,
    setSelectedTab,
    analysisSaved,
    setAnalysisSaved,
    scriptContent,
    setScriptContent,
    analysisResult,
    setAnalysisResult,
    analysisError,
    setAnalysisError,
    isAnalyzing,
    setIsAnalyzing,
    analysisProgress,
    setAnalysisProgress,
    guidanceModalOpen,
    setGuidanceModalOpen,
    guidanceContent,
    setGuidanceContent,
    manualInputWizardOpen,
    setManualInputWizardOpen,
    guidedSupplementOpen,
    setGuidedSupplementOpen,
    deleteModalOpen,
    setDeleteModalOpen,
    pendingDelete,
    setPendingDelete,
    deleteError,
    setDeleteError,
    monthlyOrders,
    setMonthlyOrders,
    isCopying,
    setIsCopying,
    isExporting,
    setIsExporting,
    pasteProcessed,
    setPasteProcessed,
    analysisSavedRef,
    isReloadingRef,
    isMountedRef,
    paywallViewTrackedRef,
    reloadTimeoutRef,
    exportTimeoutRef,
    abortControllerRef,
    idleCallbackHandlesRef,
    exportBlobUrlRef,
  };
}
