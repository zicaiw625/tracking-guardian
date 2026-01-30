import { useState, useCallback, useRef, useEffect } from "react";
import type { ScriptAnalysisResult } from "~/services/scanner.server";
import { analyzeScriptContent } from "~/services/scanner/content-analysis";
import { calculateRiskScore } from "~/services/scanner/risk-assessment";
import { containsSensitiveInfo } from "~/utils/security";
import { TIMEOUTS } from "~/utils/scan-constants";

type IdleCallbackHandle = ReturnType<typeof requestIdleCallback>;

function cancelIdleCallbackOrTimeout(handle: number | IdleCallbackHandle | null): void {
    if (handle === null) return;
    if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        if (typeof handle === 'number') {
            clearTimeout(handle);
        } else {
            cancelIdleCallback(handle);
        }
    } else {
        clearTimeout(handle as number);
    }
}

export function useScriptAnalysis(
    scriptAnalysisMaxContentLength: number,
    scriptAnalysisChunkSize: number
) {
    const [scriptContent, setScriptContent] = useState("");
    const [analysisResult, setAnalysisResult] = useState<ScriptAnalysisResult | null>(null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number } | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const idleCallbackHandlesRef = useRef<Array<number | IdleCallbackHandle>>([]);
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            idleCallbackHandlesRef.current.forEach(handle => {
                cancelIdleCallbackOrTimeout(handle);
            });
            idleCallbackHandlesRef.current = [];
        };
    }, []);

    const handleAnalysisError = useCallback((error: unknown, contentLength: number) => {
        if (error instanceof Error && error.message === "Analysis cancelled") {
            if (isMountedRef.current) {
                setIsAnalyzing(false);
                setAnalysisError(null);
                setAnalysisResult(null);
                setAnalysisProgress(null);
            }
            return;
        }
        let errorMessage: string;
        if (error instanceof TypeError) {
            errorMessage = "脚本格式错误，请检查输入内容";
        } else if (error instanceof RangeError) {
            errorMessage = "脚本内容过长，请分段分析";
        } else {
            errorMessage = error instanceof Error ? error.message : "分析失败，请稍后重试";
        }
        if (isMountedRef.current) {
            setAnalysisError(errorMessage);
            setAnalysisResult(null);
        }
        if (process.env.NODE_ENV === "development") {
            import("~/utils/debug-log.client").then(({ debugError }) => {
              debugError("Script analysis error", {
                error: errorMessage,
                errorType: error instanceof Error ? error.constructor.name : "Unknown",
                contentLength,
                hasContent: contentLength > 0,
              });
            });
        }
    }, []);

    const handleAnalyzeScript = useCallback(async () => {
        if (isAnalyzing) return;
        const MAX_CONTENT_LENGTH = scriptAnalysisMaxContentLength;
        const trimmedContent = scriptContent.trim();
        if (!trimmedContent) {
            setAnalysisError("请输入脚本内容");
            return;
        }
        if (trimmedContent.length > MAX_CONTENT_LENGTH) {
            setAnalysisError(`脚本内容过长（最多 ${MAX_CONTENT_LENGTH} 个字符）。请分段分析或联系支持。`);
            return;
        }
        if (containsSensitiveInfo(trimmedContent)) {
            setAnalysisError("检测到可能包含敏感信息的内容（如 API keys、tokens、客户信息等）。请先脱敏后再分析。");
            return;
        }
        setIsAnalyzing(true);
        setAnalysisError(null);
        setAnalysisProgress(null);
        try {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            abortControllerRef.current = new AbortController();
            const signal = abortControllerRef.current.signal;
            const CHUNK_SIZE = scriptAnalysisChunkSize;
            const isLargeContent = trimmedContent.length > CHUNK_SIZE;
            let result: ScriptAnalysisResult;
            if (isLargeContent) {
                result = {
                    identifiedPlatforms: [],
                    platformDetails: [],
                    risks: [],
                    riskScore: 0,
                    recommendations: [],
                };
                const platformDetailsMap = new Map<string, typeof result.platformDetails[0]>();
                const risksMap = new Map<string, typeof result.risks[0]>();
                const recommendationsSet = new Set<string>();
                const platformsSet = new Set<string>();
                const totalChunks = Math.ceil(trimmedContent.length / CHUNK_SIZE);
                for (let i = 0; i < totalChunks; i++) {
                    if (signal.aborted || !isMountedRef.current) {
                        if (isMountedRef.current) {
                            setIsAnalyzing(false);
                            setAnalysisError(null);
                            setAnalysisProgress(null);
                        }
                        return;
                    }
                    if (isMountedRef.current) {
                        setAnalysisProgress({ current: i + 1, total: totalChunks });
                    }
                    await new Promise<void>((resolve) => {
                        const processChunk = () => {
                            if (signal.aborted || !isMountedRef.current) {
                                if (isMountedRef.current) {
                                    setIsAnalyzing(false);
                                    setAnalysisError(null);
                                    setAnalysisProgress(null);
                                }
                                resolve();
                                return;
                            }
                            try {
                                const start = i * CHUNK_SIZE;
                                const end = Math.min(start + CHUNK_SIZE, trimmedContent.length);
                                const chunk = trimmedContent.slice(start, end);
                                let chunkResult: ScriptAnalysisResult;
                                try {
                                    chunkResult = analyzeScriptContent(chunk);
                                } catch (syncError) {
                                    import("~/utils/debug-log.client").then(({ debugWarn }) => {
                                      debugWarn(`Chunk ${i} synchronous analysis failed:`, syncError);
                                    });
                                    resolve();
                                    return;
                                }
                                for (const platform of chunkResult.identifiedPlatforms) {
                                    platformsSet.add(platform);
                                }
                                for (const detail of chunkResult.platformDetails) {
                                    const key = `${detail.platform}-${detail.type}-${detail.matchedPattern}`;
                                    if (!platformDetailsMap.has(key)) {
                                        platformDetailsMap.set(key, detail);
                                    }
                                }
                                for (const risk of chunkResult.risks) {
                                    if (!risksMap.has(risk.id)) {
                                        risksMap.set(risk.id, risk);
                                    }
                                }
                                for (const rec of chunkResult.recommendations) {
                                    recommendationsSet.add(rec);
                                }
                                resolve();
                            } catch (error) {
                                import("~/utils/debug-log.client").then(({ debugWarn }) => {
                                  debugWarn(`Chunk ${i} analysis failed:`, error);
                                });
                                resolve();
                            }
                        };
                        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                            const handle = requestIdleCallback(processChunk, { timeout: TIMEOUTS.IDLE_CALLBACK });
                            idleCallbackHandlesRef.current.push(handle);
                        } else {
                            const handle = setTimeout(processChunk, TIMEOUTS.SET_TIMEOUT_FALLBACK) as unknown as number | IdleCallbackHandle;
                            idleCallbackHandlesRef.current.push(handle);
                        }
                    });
                }
                result.identifiedPlatforms = Array.from(platformsSet);
                result.platformDetails = Array.from(platformDetailsMap.values());
                result.risks = Array.from(risksMap.values());
                result.recommendations = Array.from(recommendationsSet);
                if (result.risks.length > 0) {
                    result.riskScore = calculateRiskScore(result.risks);
                }
                if (isMountedRef.current) {
                    setAnalysisProgress(null);
                }
            } else {
                if (signal.aborted || !isMountedRef.current) {
                    if (isMountedRef.current) {
                        setIsAnalyzing(false);
                        setAnalysisError(null);
                    }
                    return;
                }
                result = await new Promise<ScriptAnalysisResult>((resolve, reject) => {
                    const processContent = () => {
                        if (signal.aborted || !isMountedRef.current) {
                            if (isMountedRef.current) {
                                setIsAnalyzing(false);
                                setAnalysisError(null);
                                setAnalysisProgress(null);
                            }
                            reject(new Error("Analysis cancelled"));
                            return;
                        }
                        try {
                            resolve(analyzeScriptContent(trimmedContent));
                        } catch (error) {
                            reject(error);
                        }
                    };
                    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                        const handle = requestIdleCallback(processContent, { timeout: TIMEOUTS.IDLE_CALLBACK });
                        idleCallbackHandlesRef.current.push(handle);
                    } else {
                        const handle = setTimeout(processContent, TIMEOUTS.SET_TIMEOUT_FALLBACK) as unknown as number | IdleCallbackHandle;
                        idleCallbackHandlesRef.current.push(handle);
                    }
                });
            }
            if (isMountedRef.current) {
                setAnalysisResult(result);
            }
        } catch (error) {
            handleAnalysisError(error, trimmedContent.length);
        } finally {
            if (isMountedRef.current) {
                setIsAnalyzing(false);
                setAnalysisProgress(null);
            }
        }
    }, [scriptContent, isAnalyzing, handleAnalysisError, scriptAnalysisMaxContentLength, scriptAnalysisChunkSize]);

    return {
        scriptContent,
        setScriptContent,
        analysisResult,
        setAnalysisResult,
        analysisError,
        isAnalyzing,
        analysisProgress,
        handleAnalyzeScript,
    };
}
