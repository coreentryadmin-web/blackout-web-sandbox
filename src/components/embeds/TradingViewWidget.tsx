"use client";

import { useMemo } from "react";
import { clsx } from "clsx";
import { EmbedFrame } from "./EmbedFrame";

export type TradingViewWidgetType =
  | "advanced-chart"
  | "ticker-tape"
  | "stock-heatmap"
  | "symbol-overview"
  | "hotlists"
  | "market-overview";

type TradingViewWidgetProps = {
  type: TradingViewWidgetType;
  symbol?: string;
  title?: string;
  className?: string;
  height?: number;
};

function buildWidgetSrc(type: TradingViewWidgetType, symbol?: string): string {
  const base = `https://s.tradingview.com/embed-widget/${type}/?locale=en#`;

  const configs: Record<TradingViewWidgetType, object> = {
    "advanced-chart": {
      autosize: true,
      symbol: symbol ?? "CBOE:SPX",
      interval: "5",
      timezone: "America/New_York",
      theme: "dark",
      style: "1",
      locale: "en",
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
    },
    "ticker-tape": {
      symbols: [
        { proName: "CBOE:SPX", title: "SPX" },
        { proName: "AMEX:SPY", title: "SPY" },
        { proName: "NASDAQ:QQQ", title: "QQQ" },
        { proName: "CBOE:VIX", title: "VIX" },
        { proName: "NASDAQ:NVDA", title: "NVDA" },
        { proName: "NASDAQ:TSLA", title: "TSLA" },
        { proName: "NASDAQ:AAPL", title: "AAPL" },
      ],
      showSymbolLogo: true,
      isTransparent: true,
      displayMode: "adaptive",
      colorTheme: "dark",
      locale: "en",
    },
    "stock-heatmap": {
      dataSource: "SPX500",
      blockSize: "market_cap_basic",
      blockColor: "change",
      grouping: "sector",
      locale: "en",
      symbolUrl: "",
      colorTheme: "dark",
      hasTopBar: false,
      isDataSetEnabled: false,
      isZoomEnabled: true,
      hasSymbolTooltip: true,
      isMonoSize: false,
      width: "100%",
      height: "100%",
    },
    "symbol-overview": {
      symbols: [[symbol ?? "CBOE:SPX", symbol?.split(":")[1] ?? "SPX"]],
      chartOnly: false,
      width: "100%",
      height: "100%",
      locale: "en",
      colorTheme: "dark",
      autosize: true,
      showVolume: true,
      showMA: true,
      hideDateRanges: false,
      hideMarketStatus: false,
      hideSymbolLogo: false,
      scalePosition: "right",
      scaleMode: "Normal",
      fontFamily: "-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif",
      fontSize: "10",
      noTimeScale: false,
      valuesTracking: "1",
      changeMode: "price-and-percent",
      chartType: "area",
      lineWidth: 2,
      lineType: 0,
      dateRanges: ["1d", "5d", "1m", "3m", "6m", "1y"],
    },
    hotlists: {
      colorTheme: "dark",
      dateRange: "12M",
      exchange: "US",
      showChart: true,
      locale: "en",
      largeChartUrl: "",
      isTransparent: true,
      showSymbolLogo: true,
      showFloatingTooltip: true,
      width: "100%",
      height: "100%",
    },
    "market-overview": {
      colorTheme: "dark",
      dateRange: "12M",
      showChart: true,
      locale: "en",
      largeChartUrl: "",
      isTransparent: true,
      showSymbolLogo: true,
      showFloatingTooltip: true,
      plotLineColorGrowing: "rgba(34, 197, 94, 1)",
      plotLineColorFalling: "rgba(239, 68, 68, 1)",
      gridLineColor: "rgba(42, 42, 42, 0.5)",
      scaleFontColor: "rgba(134, 134, 134, 1)",
      belowLineFillColorGrowing: "rgba(34, 197, 94, 0.12)",
      belowLineFillColorFalling: "rgba(239, 68, 68, 0.12)",
      belowLineFillColorGrowingBottom: "rgba(34, 197, 94, 0)",
      belowLineFillColorFallingBottom: "rgba(239, 68, 68, 0)",
      symbolActiveColor: "rgba(34, 197, 94, 0.12)",
      tabs: [
        { title: "Indices", symbols: [{ s: "CBOE:SPX" }, { s: "AMEX:SPY" }, { s: "NASDAQ:QQQ" }, { s: "CBOE:VIX" }] },
        { title: "Mag 7", symbols: [{ s: "NASDAQ:NVDA" }, { s: "NASDAQ:AAPL" }, { s: "NASDAQ:MSFT" }, { s: "NASDAQ:GOOGL" }] },
      ],
      width: "100%",
      height: "100%",
    },
  };

  return `${base}${encodeURIComponent(JSON.stringify(configs[type]))}`;
}

export function TradingViewWidget({
  type,
  symbol,
  title,
  className,
  height = 460,
}: TradingViewWidgetProps) {
  const src = useMemo(() => buildWidgetSrc(type, symbol), [type, symbol]);

  return (
    <EmbedFrame title={title ?? "Live Market Feed"} variant="tv" className={className}>
      <iframe
        src={src}
        title={title ?? "TradingView widget"}
        className="w-full border-0"
        style={{ height }}
        sandbox="allow-scripts allow-popups allow-forms"
        allowTransparency
        loading="lazy"
      />
    </EmbedFrame>
  );
}
