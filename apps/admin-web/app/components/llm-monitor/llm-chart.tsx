import type { EChartsCoreOption, EChartsType } from "echarts/core";
import { useEffect, useRef } from "react";

let echartsRuntimePromise: Promise<typeof import("echarts/core")> | undefined;
type LlmChartOption = EChartsCoreOption | ((width: number) => EChartsCoreOption);

export function LlmChart({
  height = 300,
  minWidth,
  onClick,
  option,
  summary,
}: {
  height?: number;
  minWidth?: number;
  onClick?: (params: unknown) => void;
  option: LlmChartOption;
  summary: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let chart: EChartsType | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let disposed = false;

    void loadEchartsRuntime().then((echarts) => {
      if (disposed) return;
      chart = echarts.init(container, undefined, { renderer: "canvas" });
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const applyOption = () => chart?.setOption({
          animation: !reducedMotion,
          aria: { enabled: true, description: summary },
          ...(typeof option === "function" ? option(container.clientWidth) : option),
        }, true);
      applyOption();
      if (onClick) chart.on("click", onClick);
      resizeObserver = new ResizeObserver(() => {
        chart?.resize();
        applyOption();
      });
      resizeObserver.observe(container);
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      chart?.dispose();
    };
  }, [onClick, option, summary]);

  return (
    <div
      aria-label={summary}
      className="llm-chart"
      ref={containerRef}
      role="img"
      style={{ height, minWidth }}
    />
  );
}

function loadEchartsRuntime(): Promise<typeof import("echarts/core")> {
  if (!echartsRuntimePromise) {
    echartsRuntimePromise = Promise.all([
      import("echarts/core"),
      import("echarts/charts"),
      import("echarts/components"),
      import("echarts/renderers"),
    ]).then(([echarts, charts, components, renderers]) => {
      echarts.use([
        components.AriaComponent,
        charts.BarChart,
        renderers.CanvasRenderer,
        components.DataZoomComponent,
        components.GridComponent,
        charts.HeatmapChart,
        components.LegendComponent,
        charts.LineChart,
        charts.ScatterChart,
        components.TooltipComponent,
        components.VisualMapComponent,
      ]);
      return echarts;
    });
  }
  return echartsRuntimePromise;
}
