
// ./src/components/CostAnalyticsApp.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useDropzone } from "react-dropzone";
import { toPng } from "html-to-image";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  AreaChart,
  Area,
} from "recharts";

type RawRow = any[];
type Header = string[];

// Line chart data shape
type LineSeries = {
  rowsWide: Record<string, any>[]; // [{ date, series1, series2, ... }]
  seriesKeys: string[];            // names of series columns in rowsWide
};

type Aggregation = "sum" | "avg" | "count";

const PIE_COLORS = [
  "#8884d8", "#82ca9d", "#ffc658", "#ff7f7f", "#a28fd0",
  "#7dd3fc", "#34d399", "#f472b6", "#60a5fa", "#f59e0b",
];

export default function CostAnalyticsApp() {
  /** ---------------- State ---------------- */
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [headerRow, setHeaderRow] = useState<Header | null>(null);

  // Selections
  const [metricsIdxs, setMetricsIdxs] = useState<number[]>([]); // multi-select metrics
  const [primaryMetricIdx, setPrimaryMetricIdx] = useState<number | null>(null);
  const [aggregation, setAggregation] = useState<Aggregation>("sum");

  const [dateIdx, setDateIdx] = useState<number | "">("");
  const [monthBucket, setMonthBucket] = useState<boolean>(true);
  const [dateFormat, setDateFormat] = useState<
    "auto" | "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY/MM/DD" | "DD-MMM-YYYY"
  >("auto");

  const [selectedDims, setSelectedDims] = useState<number[]>([]);
  const [dimSearch, setDimSearch] = useState<string>("");

  const [topN, setTopN] = useState<number>(6);

  // Line series visibility toggles
  const [seriesVisible, setSeriesVisible] = useState<Record<string, boolean>>({});

  // Export refs
  const lineRef = useRef<HTMLDivElement | null>(null);
  const pieRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);

  const [warnings, setWarnings] = useState<string[]>([]);

  /** ---------------- File drop ---------------- */
  const onDrop = (acceptedFiles: File[]) => {
    if (!acceptedFiles?.length) return;
    const file = acceptedFiles[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf = e.target?.result as ArrayBuffer;
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

        const headerIsFirstRow = rows[0] && rows[0].every((c) => typeof c === "string");
        const header = headerIsFirstRow ? (rows.shift() as string[]) : createDefaultHeader(rows);
        setHeaderRow(header);
        setRawRows(rows);

        // reset selections
        setMetricsIdxs([]);
        setPrimaryMetricIdx(null);
        setAggregation("sum");
        setDateIdx("");
        setMonthBucket(true);
        setDateFormat("auto");
        setSelectedDims([]);
        setDimSearch("");
        setTopN(6);
        setSeriesVisible({});
        setWarnings([]);
      } catch (err) {
        setWarnings(["Failed to parse Excel file: " + String(err)]);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
  });

  /** ---------------- Selection helpers ---------------- */
  const numericCandidates = useMemo(() => {
    if (!headerRow || rawRows.length === 0) return [];
    const cols = headerRow.map((label, idx) => ({
      idx,
      label,
      numericScore: scoreNumericColumn(rawRows, idx),
    }));
    cols.sort((a, b) => b.numericScore - a.numericScore);
    return cols.map((c) => c.idx);
  }, [headerRow, rawRows]);

  // Keep primaryMetricIdx synced with metrics selection
  useEffect(() => {
    if (!metricsIdxs.length) {
      setPrimaryMetricIdx(null);
    } else if (primaryMetricIdx == null || !metricsIdxs.includes(primaryMetricIdx)) {
      setPrimaryMetricIdx(metricsIdxs[0]); // default: first selected metric
    }
  }, [metricsIdxs, primaryMetricIdx]);

  const primaryMetricName =
    primaryMetricIdx != null && headerRow ? headerRow[primaryMetricIdx] : undefined;
  const dateName = typeof dateIdx === "number" && headerRow ? headerRow[dateIdx] : undefined;
  const dimNames = (headerRow ?? []).filter((_, idx) => selectedDims.includes(idx));

  /** ---------------- Filtering ---------------- */
  type FilterRule = { colIdx: number; op: "contains" | "equals" | "notContains" | "notEquals"; value: string };
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);

  const addFilterRule = () => {
    if (!headerRow) return;
    setFilterRules((prev) => [...prev, { colIdx: 0, op: "contains", value: "" }]);
  };

  const clearFilterRules = () => setFilterRules([]);

  function matchesRow(row: any[], rules: FilterRule[]): boolean {
    if (!rules.length) return true;
    for (const r of rules) {
      const v = String(row[r.colIdx] ?? "");
      const needle = r.value;
      switch (r.op) {
        case "contains":
          if (!v.toLowerCase().includes(needle.toLowerCase())) return false;
          break;
        case "equals":
          if (v !== needle) return false;
          break;
        case "notContains":
          if (v.toLowerCase().includes(needle.toLowerCase())) return false;
          break;
        case "notEquals":
          if (v === needle) return false;
          break;
      }
    }
    return true;
  }

  /** ---------------- Aggregations based on selection ---------------- */

  // 1) Pie: totals by selected dimension combo for PRIMARY METRIC (or "All")
  const pieData = useMemo(() => {
    if (!headerRow || !rawRows.length || primaryMetricIdx == null) return [];
    const totals = new Map<string, { sum: number; count: number }>();
    for (const row of rawRows) {
      if (!matchesRow(row, filterRules)) continue;
      const key = selectedDims.length ? buildGroupKey(row, selectedDims) : "All";
      const val = aggregation === "count" ? 1 : parseFloatSafe(row[primaryMetricIdx]);
      const prev = totals.get(key) ?? { sum: 0, count: 0 };
      totals.set(key, { sum: prev.sum + val, count: prev.count + 1 });
    }
    return Array.from(totals.entries()).map(([group, { sum, count }]) => ({
      group,
      value: aggregation === "sum" ? sum : aggregation === "count" ? count : count ? sum / count : 0,
    }));
  }, [headerRow, rawRows, primaryMetricIdx, selectedDims, aggregation, filterRules]);

  // 2) Bar: if date selected -> totals per date for PRIMARY METRIC; else -> reuse pie totals
  const barData = useMemo(() => {
    if (!headerRow || !rawRows.length || primaryMetricIdx == null) return [];
    if (typeof dateIdx === "number") {
      const totals = new Map<string, { sum: number; count: number }>();
      for (const row of rawRows) {
        if (!matchesRow(row, filterRules)) continue;
        const d = formatDateBucket(row[dateIdx], monthBucket, dateFormat);
        const val = aggregation === "count" ? 1 : parseFloatSafe(row[primaryMetricIdx]);
        const prev = totals.get(d) ?? { sum: 0, count: 0 };
        totals.set(d, { sum: prev.sum + val, count: prev.count + 1 });
      }
      return Array.from(totals.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, { sum, count }]) => ({
          date,
          value: aggregation === "sum" ? sum : aggregation === "count" ? count : count ? sum / count : 0,
        }));
    }
    // no date: show groups (same as pie)
    return pieData.map((p) => ({ group: p.group, value: p.value }));
  }, [headerRow, rawRows, primaryMetricIdx, dateIdx, monthBucket, dateFormat, aggregation, pieData, filterRules]);

  // 3) Line series (dimensions or metrics over time)
  const lineSeriesData = useMemo<LineSeries>(() => {
    if (!headerRow || !rawRows.length || typeof dateIdx !== "number") {
      return { rowsWide: [], seriesKeys: [] };
    }

    const datesSet = new Set<string>();
    const seriesKeysSet = new Set<string>();

    if (selectedDims.length) {
      // Dimension series using PRIMARY METRIC
      if (primaryMetricIdx == null) return { rowsWide: [], seriesKeys: [] };

      const byDateGroup = new Map<string, Map<string, { sum: number; count: number }>>();
      const groupTotals = new Map<string, { sum: number; count: number }>();

      for (const row of rawRows) {
        if (!matchesRow(row, filterRules)) continue;
        const dateBucket = formatDateBucket(row[dateIdx], monthBucket, dateFormat);
        datesSet.add(dateBucket);
        const groupKey = buildGroupKey(row, selectedDims);
        const val = aggregation === "count" ? 1 : parseFloatSafe(row[primaryMetricIdx]);

        if (!byDateGroup.has(dateBucket)) byDateGroup.set(dateBucket, new Map());
        const gm = byDateGroup.get(dateBucket)!;
        const prev = gm.get(groupKey) ?? { sum: 0, count: 0 };
        gm.set(groupKey, { sum: prev.sum + val, count: prev.count + 1 });

        const gPrev = groupTotals.get(groupKey) ?? { sum: 0, count: 0 };
        groupTotals.set(groupKey, { sum: gPrev.sum + val, count: gPrev.count + 1 });
      }

      // Top N groups by aggregated value
      const rankedGroups = Array.from(groupTotals.entries())
        .map(([g, { sum, count }]) => ({
          g,
          agg: aggregation === "sum" ? sum : aggregation === "count" ? count : count ? sum / count : 0,
        }))
        .sort((a, b) => b.agg - a.agg)
        .slice(0, topN)
        .map((x) => x.g);

      rankedGroups.forEach((g) => seriesKeysSet.add(g));

      const dates = Array.from(datesSet.values()).sort((a, b) => a.localeCompare(b));
      const rowsWide = dates.map((d) => {
        const gm = byDateGroup.get(d) ?? new Map();
        const record: Record<string, any> = { date: d };
        for (const g of rankedGroups) {
          const obj = gm.get(g) ?? { sum: 0, count: 0 };
          record[g] =
            aggregation === "sum" ? obj.sum : aggregation === "count" ? obj.count : obj.count ? obj.sum / obj.count : 0;
        }
        return record;
      });

      return { rowsWide, seriesKeys: Array.from(seriesKeysSet.values()) };
    }

    // Metrics series: each selected metric is a line over time
    if (!metricsIdxs.length) return { rowsWide: [], seriesKeys: [] };

    const byDateMetric = new Map<string, Map<number /*metricIdx*/, { sum: number; count: number }>>();

    for (const row of rawRows) {
      if (!matchesRow(row, filterRules)) continue;
      const dateBucket = formatDateBucket(row[dateIdx], monthBucket, dateFormat);
      datesSet.add(dateBucket);
      if (!byDateMetric.has(dateBucket)) byDateMetric.set(dateBucket, new Map());
      const mm = byDateMetric.get(dateBucket)!;

      for (const mIdx of metricsIdxs) {
        const val = aggregation === "count" ? 1 : parseFloatSafe(row[mIdx]);
        const prev = mm.get(mIdx) ?? { sum: 0, count: 0 };
        mm.set(mIdx, { sum: prev.sum + val, count: prev.count + 1 });
      }
    }

    const dates = Array.from(datesSet.values()).sort((a, b) => a.localeCompare(b));
    const rowsWide = dates.map((d) => {
      const mm = byDateMetric.get(d) ?? new Map();
      const record: Record<string, any> = { date: d };
      for (const mIdx of metricsIdxs) {
        const mName = headerRow[mIdx];
        seriesKeysSet.add(mName);
        const obj = mm.get(mIdx) ?? { sum: 0, count: 0 };
        record[mName] =
          aggregation === "sum" ? obj.sum : aggregation === "count" ? obj.count : obj.count ? obj.sum / obj.count : 0;
      }
      return record;
    });

    return { rowsWide, seriesKeys: Array.from(seriesKeysSet.values()) };
  }, [
    headerRow,
    rawRows,
    dateIdx,
    monthBucket,
    dateFormat,
    selectedDims,
    metricsIdxs,
    primaryMetricIdx,
    aggregation,
    topN,
    filterRules,
  ]);

  // 4) Area: cumulative over date for PRIMARY METRIC
  const areaData = useMemo(() => {
    if (!headerRow || !rawRows.length || typeof dateIdx !== "number" || primaryMetricIdx == null) return [];
    const byDateMap = new Map<string, { sum: number; count: number }>();
    for (const row of rawRows) {
      if (!matchesRow(row, filterRules)) continue;
      const d = formatDateBucket(row[dateIdx], monthBucket, dateFormat);
      const val = aggregation === "count" ? 1 : parseFloatSafe(row[primaryMetricIdx]);
      const prev = byDateMap.get(d) ?? { sum: 0, count: 0 };
      byDateMap.set(d, { sum: prev.sum + val, count: prev.count + 1 });
    }
    const dates = Array.from(byDateMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    let running = 0;
    return dates.map(([date, { sum, count }]) => {
      const v = aggregation === "sum" ? sum : aggregation === "count" ? count : count ? sum / count : 0;
      running += v;
      return { date, cumulative: running };
    });
  }, [headerRow, rawRows, dateIdx, monthBucket, dateFormat, primaryMetricIdx, aggregation, filterRules]);

  /** ---------------- Sync series visibility ---------------- */
  useEffect(() => {
    // Initialize any new series keys to visible=true
    setSeriesVisible((prev) => {
      const next = { ...prev };
      for (const key of lineSeriesData.seriesKeys) {
        if (!(key in next)) next[key] = true;
      }
      // Remove keys no longer present
      Object.keys(next).forEach((k) => {
        if (!lineSeriesData.seriesKeys.includes(k)) delete next[k];
      });
      return next;
    });
  }, [lineSeriesData.seriesKeys]);

  /** ---------------- UI ---------------- */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-orange-400 text-white p-6 rounded-md">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Monthly Analysis Results</h2>
          <div className="space-x-2">
            <button className="bg-white text-orange-600 px-3 py-1 rounded">Ask Questions</button>
            <button
              className="bg-orange-700 text-white px-3 py-1 rounded"
              onClick={() => {
                setRawRows([]);
                setHeaderRow(null);
                setMetricsIdxs([]);
                setPrimaryMetricIdx(null);
                setAggregation("sum");
                setDateIdx("");
                setMonthBucket(true);
                setDateFormat("auto");
                setSelectedDims([]);
                setDimSearch("");
                setTopN(6);
                setSeriesVisible({});
                setFilterRules([]);
                setWarnings([]);
              }}
            >
              New Analysis
            </button>
          </div>
        </div>
      </div>

      {/* Dropzone */}
      <div className="p-4 bg-white rounded shadow">
        <div {...getRootProps()} className="border-dashed border-2 border-gray-300 rounded p-6 text-center cursor-pointer">
          <input {...getInputProps()} />
          {isDragActive ? <p>Drop the Excel file here...</p> : <p>Drag &amp; drop an Excel file here, or click to select</p>}
        </div>
        {headerRow && <div className="mt-2 text-sm text-gray-600">Detected header: {headerRow.join(" • ")}</div>}
      </div>

      {/* Column & options selection */}
      {headerRow && rawRows.length > 0 && (
        <div className="p-4 bg-white rounded shadow space-y-6">
          <h3 className="text-lg font-semibold">Select Columns & Options</h3>

          {/* Metrics + Primary metric + Aggregation */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Metrics (multi) */}
            <div>
              <label className="block text-sm">Metrics (numeric, choose any)</label>
              <div className="mt-1 max-h-40 overflow-auto border rounded p-2 grid grid-cols-1 md:grid-cols-2 gap-1">
                {headerRow.map((h, idx) => (
                  <label key={idx} className="inline-flex items-center space-x-2 text-sm">
                    <input
                      type="checkbox"
                      checked={metricsIdxs.includes(idx)}
                      onChange={(e) => {
                        setMetricsIdxs((prev) => (e.target.checked ? [...prev, idx] : prev.filter((i) => i !== idx)));
                      }}
                    />
                    <span>
                      {idx}: {h}
                      {numericCandidates[0] === idx ? " (recommended)" : ""}
                    </span>
                  </label>
                ))}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                Tip: choose numeric columns like <code>Cost</code>, <code>Quantity</code>, or <code>UnitPrice</code>.
              </div>
            </div>

            {/* Primary metric */}
            <div>
              <label className="block text-sm">Primary Metric (Pie/Bar/Area)</label>
              <select
                className="mt-1 w-full border p-2 rounded"
                value={primaryMetricIdx ?? ""}
                onChange={(e) => {
                  const val = e.target.value === "" ? null : Number(e.target.value);
                  setPrimaryMetricIdx(val);
                  if (val != null && !metricsIdxs.includes(val)) {
                    setMetricsIdxs((prev) => [...prev, val]);
                  }
                }}
              >
                <option value="">Select…</option>
                {metricsIdxs.map((idx) => (
                  <option key={idx} value={idx}>
                    {idx}: {headerRow[idx]}
                  </option>
                ))}
              </select>

              <label className="block text-sm mt-3">Aggregation</label>
              <select
                className="mt-1 w-full border p-2 rounded"
                value={aggregation}
                onChange={(e) => setAggregation(e.target.value as Aggregation)}
              >
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="count">Count</option>
              </select>
            </div>

            {/* Date + Format + Month bucket */}
            <div>
              <label className="block text-sm">Date (optional)</label>
              <select
                className="mt-1 w-full border p-2 rounded"
                value={dateIdx}
                onChange={(e) => setDateIdx(Number(e.target.value))}
              >
                <option value="">(No date)</option>
                {headerRow.map((h, idx) => (
                  <option key={idx} value={idx}>
                    {idx}: {h}
                  </option>
                ))}
              </select>

              <label className="block text-sm mt-3">Date format</label>
              <select
                className="mt-1 w-full border p-2 rounded"
                value={dateFormat}
                disabled={typeof dateIdx !== "number"}
                onChange={(e) => setDateFormat(e.target.value as any)}
              >
                <option value="auto">Auto</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="YYYY/MM/DD">YYYY/MM/DD</option>
                <option value="DD-MMM-YYYY">DD-MMM-YYYY (e.g., 01-Jun-2024)</option>
              </select>

              <label className="mt-2 inline-flex items-center space-x-2 text-sm">
                <input
                  type="checkbox"
                  checked={monthBucket}
                  disabled={typeof dateIdx !== "number"}
                  onChange={(e) => setMonthBucket(e.target.checked)}
                />
                <span>Bucket date by month (YYYY‑MM)</span>
              </label>
            </div>
          </div>

          {/* Dimensions + search + TopN */}
          <div>
            <label className="block text-sm">Dimensions (choose any)</label>
            <input
              type="text"
              className="mt-1 w-full border p-2 rounded"
              placeholder="Search dimensions..."
              value={dimSearch}
              onChange={(e) => setDimSearch(e.target.value)}
            />
            <div className="mt-2 max-h-48 overflow-auto border rounded p-2 grid grid-cols-1 md:grid-cols-2 gap-1">
              {headerRow
                .map((h, idx) => ({ h, idx }))
                .filter(({ h }) => h.toLowerCase().includes(dimSearch.toLowerCase()))
                .map(({ h, idx }) => (
                  <label key={idx} className="inline-flex items-center space-x-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedDims.includes(idx)}
                      onChange={(e) => {
                        setSelectedDims((prev) => (e.target.checked ? [...prev, idx] : prev.filter((i) => i !== idx)));
                      }}
                    />
                    <span>
                      {idx}: {h}
                    </span>
                  </label>
                ))}
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm">Top N series (for Line)</label>
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full border p-2 rounded"
                  value={topN}
                  onChange={(e) => setTopN(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>

              <div className="flex items-end">
                <button className="px-3 py-2 bg-gray-200 rounded" onClick={() => setSelectedDims([])}>
                  Clear Dimensions
                </button>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div>
            <label className="block text-sm">Filters (optional)</label>
            <button className="mt-2 px-3 py-1 bg-gray-200 rounded" onClick={addFilterRule}>
              + Add Rule
            </button>
            <button className="mt-2 ml-2 px-3 py-1 bg-gray-200 rounded" onClick={clearFilterRules}>
              Clear Rules
            </button>

            {filterRules.length > 0 && (
              <div className="mt-2 space-y-2">
                {filterRules.map((r, i) => (
                  <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <select
                      className="border p-2 rounded"
                      value={r.colIdx}
                      onChange={(e) =>
                        setFilterRules((prev) => prev.map((x, idx) => (idx === i ? { ...x, colIdx: Number(e.target.value) } : x)))
                      }
                    >
                      {headerRow!.map((h, idx) => (
                        <option key={idx} value={idx}>
                          {idx}: {h}
                        </option>
                      ))}
                    </select>
                    <select
                      className="border p-2 rounded"
                      value={r.op}
                      onChange={(e) =>
                        setFilterRules((prev) => prev.map((x, idx) => (idx === i ? { ...x, op: e.target.value as any } : x)))
                      }
                    >
                      <option value="contains">contains</option>
                      <option value="equals">equals</option>
                      <option value="notContains">notContains</option>
                      <option value="notEquals">notEquals</option>
                    </select>
                    <input
                      className="border p-2 rounded"
                      placeholder="value…"
                      value={r.value}
                      onChange={(e) =>
                        setFilterRules((prev) => prev.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))
                      }
                    />
                    <button
                      className="px-3 py-1 bg-red-100 text-red-700 rounded"
                      onClick={() => setFilterRules((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-700">
              Primary Metric <strong>{primaryMetricName ?? "-"}</strong> • Date <strong>{dateName ?? "(none)"}</strong> •
              Aggregation <strong>{aggregation}</strong> • Dimensions{" "}
              <strong>{dimNames.length ? dimNames.join(" • ") : "(none)"}</strong>
            </div>
            <button
              className="px-3 py-1 bg-gray-200 rounded"
              onClick={() => {
                setMetricsIdxs([]);
                setPrimaryMetricIdx(null);
                setAggregation("sum");
                setDateIdx("");
                setMonthBucket(true);
                setDateFormat("auto");
                setSelectedDims([]);
                setDimSearch("");
                setTopN(6);
                setSeriesVisible({});
                setFilterRules([]);
                setWarnings([]);
              }}
            >
              Reset Selection
            </button>
          </div>

          {primaryMetricIdx == null && (
            <div className="p-3 bg-yellow-100 text-yellow-800 rounded text-sm">
              Please select at least one metric and choose a primary metric.
            </div>
          )}
          {warnings.length > 0 && (
            <div className="p-3 bg-yellow-100 text-yellow-800 rounded text-sm">
              {warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Charts */}
      {headerRow && rawRows.length > 0 && primaryMetricIdx != null && (
        <div className="space-y-8">
          {/* Line + Pie */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white rounded p-4 shadow" ref={lineRef as any}>
              <h4 className="font-semibold mb-2">
                Trend {dateName ? `by ${dateName}` : ""}{" "}
                {!selectedDims.length && metricsIdxs.length > 1 ? "(per metric)" : ""}
              </h4>

              {/* Series visibility toggles */}
              {lineSeriesData.seriesKeys.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {lineSeriesData.seriesKeys.map((key, i) => (
                    <label
                      key={key}
                      className="inline-flex items-center space-x-2 text-xs px-2 py-1 rounded"
                      style={{ backgroundColor: "#f3f4f6" }}
                    >
                      <input
                        type="checkbox"
                        checked={!!seriesVisible[key]}
                        onChange={(e) => setSeriesVisible((prev) => ({ ...prev, [key]: e.target.checked }))}
                      />
                      <span style={{ color: PIE_COLORS[i % PIE_COLORS.length] }}>{key}</span>
                    </label>
                  ))}
                </div>
              )}

              <ResponsiveContainer width="100%" height={300}>
                {typeof dateIdx === "number" && lineSeriesData.rowsWide.length ? (
                  <LineChart data={lineSeriesData.rowsWide}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    {lineSeriesData.seriesKeys
                      .filter((key) => seriesVisible[key] !== false)
                      .map((key, i) => (
                        <Line key={key} type="monotone" dataKey={key} stroke={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                  </LineChart>
                ) : (
                  // Fallback single series if there's no date
                  <LineChart data={convertBarToLine(barData)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="value" stroke="#ff7a00" />
                  </LineChart>
                )}
              </ResponsiveContainer>

              <div className="mt-2 flex space-x-2">
                <button onClick={() => downloadCSV(lineSeriesData.rowsWide ?? [], "trend.csv")} className="px-3 py-1 bg-gray-200 rounded">
                  Export CSV
                </button>
                <button onClick={() => downloadPNG(lineRef, "trend.png")} className="px-3 py-1 bg-gray-200 rounded">
                  Export PNG
                </button>
              </div>
            </div>

            <div className="bg-white rounded p-4 shadow" ref={pieRef as any}>
              <h4 className="font-semibold mb-2">Share by Selected Dimensions ({primaryMetricName})</h4>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="group" outerRadius={110} label>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 flex space-x-2">
                <button onClick={() => downloadCSV(pieData, "share-by-dimensions.csv")} className="px-3 py-1 bg-gray-200 rounded">
                  Export CSV
                </button>
                <button onClick={() => downloadPNG(pieRef, "share.png")} className="px-3 py-1 bg-gray-200 rounded">
                  Export PNG
                </button>
              </div>
            </div>
          </div>

          {/* Bar + Area */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white rounded p-4 shadow" ref={barRef as any}>
              <h4 className="font-semibold mb-2">
                {typeof dateIdx === "number" ? `Totals by ${dateName}` : "Totals by Group"} ({primaryMetricName})
              </h4>
              <ResponsiveContainer width="100%" height={300}>
                {typeof dateIdx === "number" ? (
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="value" fill="#ffb366" />
                  </BarChart>
                ) : (
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="group" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="value" fill="#ffb366" />
                  </BarChart>
                )}
              </ResponsiveContainer>
              <div className="mt-2 flex space-x-2">
                <button onClick={() => downloadCSV(barData, "totals.csv")} className="px-3 py-1 bg-gray-200 rounded">
                  Export CSV
                </button>
                <button onClick={() => downloadPNG(barRef, "totals.png")} className="px-3 py-1 bg-gray-200 rounded">
                  Export PNG
                </button>
              </div>
            </div>

            <div className="bg-white rounded p-4 shadow" ref={areaRef as any}>
              <h4 className="font-semibold mb-2">Cumulative {dateName ? `by ${dateName}` : ""} ({primaryMetricName})</h4>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={areaData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Area type="monotone" dataKey="cumulative" stroke="#ffc658" fill="#ffc658" />
                </AreaChart>
              </ResponsiveContainer>
              <div className="mt-2 flex space-x-2">
                <button onClick={() => downloadCSV(areaData, "cumulative.csv")} className="px-3 py-1 bg-gray-200 rounded">
                  Export CSV
                </button>
                <button onClick={() => downloadPNG(areaRef, "cumulative.png")} className="px-3 py-1 bg-gray-200 rounded">
                  Export PNG
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** ---------------- Utils ---------------- */


/** ---------------- Utils ---------------- */

function createDefaultHeader(rows: any[][]): string[] {
  const maxCols = rows[0] ? rows[0].length : 3;
  return Array.from({ length: maxCols }, (_, i) => `Column ${i}`);
}

function parseFloatSafe(v: any): number {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

function buildGroupKey(row: any[], dimIdxs: number[]): string {
  if (!dimIdxs?.length) return "All";
  return dimIdxs
    .map((idx) => {
      const val = row[idx];
      return val == null || val === "" ? "(empty)" : String(val);
    })
    .join(" • ");
}

function scoreNumericColumn(rows: any[][], idx: number): number {
  const N = Math.min(rows.length, 50);
  let hits = 0;
  for (let i = 0; i < N; i++) {
    const v = rows[i]?.[idx];
    if (v == null) continue;
    const s = String(v);
    if (!Number.isNaN(parseFloat(s.replace(/,/g, "")))) hits++;
  }
  return hits;
}

/**
 * Format date value to a bucket string.
 * If monthBucket is true, returns YYYY-MM based on parsed date/format;
 * else returns normalized YYYY-MM-DD.
 */

/**
 * Format date value to a bucket string.
 * If monthBucket is true, returns YYYY-MM based on parsed date/format;
 * else returns normalized YYYY-MM-DD.
 */

/**
 * Format date value to a bucket string.
 * If monthBucket is true, returns YYYY-MM based on parsed date/format;
 * else returns normalized YYYY-MM-DD.
 */
function formatDateBucket(
  value: any,
  monthBucket: boolean,
  format: "auto" | "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY/MM/DD" | "DD-MMM-YYYY"
): string {
  const s = String(value ?? "").trim();
  if (!s) return s;

  const d = parseDateWithFormat(s, format);
  if (Number.isNaN(d.getTime())) {
    // If parsing failed, try simple yyyy-mm; else return raw string
    const m2 = s.match(/^(\d{4})[-/](\d{1,2})/);
    if (m2) {
      const y = m2[1];
      const mm = m2[2].padStart(2, "0");
      // Return normalized YYYY-MM
      return `${y}-${mm}`;
    }
    return s;
  }

  if (!monthBucket) {
    // Return normalized YYYY-MM-DD
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }

  // Month bucket YYYY-MM
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${mm}`;
}

/** Parse date string using a selected format (or auto) without regex flags. */
function parseDateWithFormat(
  s: string,
  format: "auto" | "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY/MM/DD" | "DD-MMM-YYYY"
): Date {
  if (format === "auto") {
    // Let the runtime attempt to parse
    return new Date(s);
  }

  if (format === "YYYY-MM-DD") {
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return new Date(NaN);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  if (format === "MM/DD/YYYY") {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return new Date(NaN);
    return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  }

  if (format === "DD/MM/YYYY") {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return new Date(NaN);
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  if (format === "YYYY/MM/DD") {
    const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!m) return new Date(NaN);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  if (format === "DD-MMM-YYYY") {
    const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (!m) return new Date(NaN);
    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const mon = months[m[2]];
    if (mon == null) return new Date(NaN);
    return new Date(Number(m[3]), mon, Number(m[1]));
  }

  return new Date(NaN);
}

function convertBarToLine(barData: any[]) {
  return barData.map((b) => ({ date: b.date ?? String(b.group ?? ""), value: b.value ?? 0 }));
}

function downloadCSV(rows: any[], filename = "data.csv") {
  if (!rows?.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(","), ...rows.map((r) => keys.map((k) => (r[k] ?? "")).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadPNG(ref: React.RefObject<HTMLElement | null>, filename = "chart.png") {
  if (!ref?.current) return;
  try {
    const dataUrl = await toPng(ref.current, { cacheBust: true });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
       a.click();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to export PNG:", err);
  }
}
