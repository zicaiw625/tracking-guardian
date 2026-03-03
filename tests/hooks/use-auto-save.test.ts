// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useAutoSave } from "../../app/hooks/useAutoSave";

describe("useAutoSave race guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("applies only latest save result when responses arrive out-of-order", async () => {
    const pendingResolvers: Array<() => void> = [];
    const onSaveSuccess = vi.fn();
    const saveFn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          pendingResolvers.push(resolve);
        })
    );

    const { result } = renderHook(() =>
      useAutoSave<string>({
        saveFn,
        delay: 50,
        enabled: true,
        isDirty: true,
        onSaveSuccess,
      }) as ReturnType<typeof useAutoSave<string>> & { setData: (data: string) => void }
    );

    act(() => {
      result.current.setData("older");
      vi.advanceTimersByTime(50);
    });

    act(() => {
      result.current.setData("newer");
      vi.advanceTimersByTime(50);
    });

    expect(saveFn).toHaveBeenCalledTimes(2);

    await act(async () => {
      pendingResolvers[1]();
      await Promise.resolve();
    });

    expect(result.current.saveStatus).toBe("saved");
    expect(onSaveSuccess).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingResolvers[0]();
      await Promise.resolve();
    });

    expect(result.current.saveStatus).toBe("saved");
    expect(onSaveSuccess).toHaveBeenCalledTimes(1);
  });
});
