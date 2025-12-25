
// ./src/components/CostAnalyticsApp.tsx
"use client";

import { useEffect, useRef, useState, useMemo } from "react";
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
type CostData = { date?: string; cost: number; service?: string; subscriptionName?: string; meterCategory?: string; [key: string]: any };

const PIE_COLORS = ["#8884d8", "#82ca9d", "#ffc658", "#ff7f7f", "#a28fd0", "#7dd3fc"];

export default function CostAnalyticsApp() {
    const [rawRows, setRawRows] = useState<RawRow[]>([]);
    const [headerRow, setHeaderRow] = useState<string[] | null>(null);
    const [mapping, setMapping] = useState<{ dateIdx: number; costIdx: number; serviceIdx: number } | null>(null);

    function detectFromData(headerRow: string[] | null, rawRows: any[][]) {
      const cols = headerRow ? headerRow.length : rawRows[0] ? rawRows[0].length : 3;
      const dateScores = new Array(cols).fill(0);
      const numericScores = new Array(cols).fill(0);
      const rowsToCheck = Math.min(rawRows.length, 10);
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rowsToCheck; r++) {
          const v = rawRows[r][c];
          if (v == null) continue;
          const s = String(v).trim();
          const parsed = Date.parse(s);
          if (!Number.isNaN(parsed) && isNaN(Number(s))) dateScores[c] += 1;
          if (!Number.isNaN(Number(s))) numericScores[c] += 1;
        }
      }
      const dateIdx = dateScores.indexOf(Math.max(...dateScores));
      const costIdx = numericScores.indexOf(Math.max(...numericScores));
      let serviceIdx = 0;
      for (let c = 0; c < cols; c++) {
        if (c !== dateIdx && c !== costIdx) {
          serviceIdx = c;
          break;
        }
      }
      return { dateIdx: dateIdx >= 0 ? dateIdx : 0, costIdx: costIdx >= 0 ? costIdx : 1, serviceIdx };
    }

    const [data, setData] = useState<CostData[]>([]);
    const [previewRows, setPreviewRows] = useState<CostData[]>([]);
    const [extraFields, setExtraFields] = useState<string[]>([]);
    const [chartMapping, setChartMapping] = useState<{ pieGroupBy: string; valueField: string; dateField: string }>({ pieGroupBy: "service", valueField: "cost", dateField: "date" });
    const [warnings, setWarnings] = useState<string[]>([]);
    const [showModal, setShowModal] = useState(false);

    const lineRef = useRef<HTMLDivElement | null>(null);
    const pieRef = useRef<HTMLDivElement | null>(null);
    const barRef = useRef<HTMLDivElement | null>(null);
    const areaRef = useRef<HTMLDivElement | null>(null);

    // ---- File Drop & Parse (XLSX) ----
    const onDrop = (acceptedFiles: File[]) => {
      if (!acceptedFiles || acceptedFiles.length === 0) return;
      const file = acceptedFiles[0];
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const buf = e.target?.result as ArrayBuffer;
          const wb = XLSX.read(buf, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

          // If first row is all strings, treat it as header
          const firstRowIsHeader = rows[0] && rows[0].every((c: any) => typeof c === "string");
          const firstRow = firstRowIsHeader ? (rows.shift() as string[]) : null;

          setHeaderRow(firstRow);
          setRawRows(rows);

          // Guess column mapping
          const guessed = detectFromData(firstRow, rows);

          // If header exists, prefer explicit header names when they match known names
          if (firstRow) {
            const headerLower = firstRow.map((h) => String(h || "").toLowerCase());
            const subIdx = headerLower.indexOf("subscriptionname");
            const costIdx = headerLower.indexOf("cost");
            const meterIdx = headerLower.indexOf("metercategory");

            const useMapping = {
              dateIdx: guessed.dateIdx,
              costIdx: costIdx >= 0 ? costIdx : guessed.costIdx,
              serviceIdx: meterIdx >= 0 ? meterIdx : guessed.serviceIdx,
            };
            setMapping(useMapping);

            // auto-select extras if present
            const chosenExtra: string[] = [];
            if (subIdx >= 0) chosenExtra.push(firstRow[subIdx]);
            if (meterIdx >= 0 && !chosenExtra.includes(firstRow[meterIdx])) chosenExtra.push(firstRow[meterIdx]);
            setExtraFields(chosenExtra);

            // set chart mapping defaults from headers
            setChartMapping({ pieGroupBy: firstRow[useMapping.serviceIdx] ?? "service", valueField: firstRow[useMapping.costIdx] ?? "cost", dateField: firstRow[useMapping.dateIdx] ?? "date" });

            // parse rows
            const parsed = rows.map((r) => {
              const rc = parseFloat(String(r[useMapping.costIdx] ?? ""));
              const cost = Number.isNaN(rc) ? 0 : rc;
              const base: CostData = {
                date: String(r[useMapping.dateIdx] ?? ""),
                cost,
                service: String(r[useMapping.serviceIdx] ?? ""),
              };
              // attach extras
              firstRow.forEach((h, idx) => {
                if (!h) return;
                if (chosenExtra.includes(h)) base[h] = r[idx];
              });
              if (subIdx >= 0) base.subscriptionName = String(r[subIdx] ?? "");
              if (meterIdx >= 0) base.meterCategory = String(r[meterIdx] ?? "");
              return base;
            });

            setData(parsed);
            setPreviewRows(parsed.slice(0, 10));
            setWarnings([]);
          } else {
            // no header: use guessed mapping
            setMapping(guessed);
            const parsed = rows.map((r) => {
              const rc = parseFloat(String(r[guessed.costIdx] ?? ""));
              const cost = Number.isNaN(rc) ? 0 : rc;
              return { date: String(r[guessed.dateIdx] ?? ""), cost, service: String(r[guessed.serviceIdx] ?? "") } as CostData;
            });
            setData(parsed);
            setPreviewRows(parsed.slice(0, 10));
            setWarnings([]);
          }
        } catch (err) {
          setWarnings(["Failed to parse file: " + String(err)]);
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

    useEffect(() => {
      if (!mapping && rawRows.length > 0) setShowModal(true);
    }, [rawRows, mapping]);

    // Derived metrics using chartMapping
    const totalCost = data.reduce((s, d) => s + (Number(d[chartMapping.valueField] ?? d.cost) || 0), 0);
    const months = new Set(data.map((d) => d[chartMapping.dateField] ?? d.date)).size;
    const byService = aggregateByField(data, chartMapping.pieGroupBy, chartMapping.valueField).sort((a, b) => b.cost - a.cost);
    const topService = byService[0]?.service ?? "(none)";

    const serviceLegendPayload = (() => {
      const total = byService.reduce((s, x) => s + (Number(x.cost) || 0), 0) || 1;
      return byService.map((s, i) => ({
        value: `${s.service} — ${Number(s.cost).toLocaleString(undefined, { style: "currency", currency: "USD" })} (${((Number(s.cost) / total) * 100).toFixed(1)}%)`,
        type: "square",
        color: PIE_COLORS[i % PIE_COLORS.length],
      }));
    })();

    useEffect(() => {
      // if header/mapping change and chartMapping is unset, attempt to set sensible defaults
      if (!headerRow || !mapping) return;
      const pie = headerRow[mapping.serviceIdx] ?? "service";
      const date = headerRow[mapping.dateIdx] ?? "date";
      const val = headerRow[mapping.costIdx] ?? "cost";
      setChartMapping((c) => ({ pieGroupBy: pie, valueField: val, dateField: date }));
    }, [headerRow, mapping]);

    // UI helpers: available fields for mapping selects
    const availableFields = useMemo(() => {
      const s = new Set<string>(["service", "cost", "date", "subscriptionName", "meterCategory"]);
      if (headerRow) headerRow.forEach((h) => h && s.add(h));
      return Array.from(s);
    }, [headerRow]);

    return (
      <div className="space-y-6">
        {/* Header / Stats */}
        <div className="bg-gradient-to-r from-orange-500 to-orange-400 text-white p-6 rounded-md">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Monthly Analysis Results</h2>
            <div className="space-x-2">
              <button className="bg-white text-orange-600 px-3 py-1 rounded">Ask Questions</button>
              <button
                className="bg-orange-700 text-white px-3 py-1 rounded"
                onClick={() => {
                  setData([]);
                  setRawRows([]);
                  setHeaderRow(null);
                  setMapping(null);
                  setPreviewRows([]);
                  setExtraFields([]);
                  setChartMapping({ pieGroupBy: "service", valueField: "cost", dateField: "date" });
                }}
              >
                New Analysis
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-6 rounded-md shadow-lg bg-gradient-to-r from-orange-500 to-orange-400 text-white">
              <div className="text-sm opacity-90">Total Cost</div>
              <div className="text-3xl md:text-4xl font-extrabold mt-2">${totalCost.toFixed(2)}</div>
              <div className="text-xs opacity-90 mt-1">{data.length.toLocaleString()} line items</div>
            </div>

            <div className="bg-white text-black rounded p-4 shadow">
              <div className="text-sm">Virtual Machines</div>
              <div className="text-2xl font-bold mt-2">${(byService.find((s) => /virtual machine|virtual machines|vm/i.test(s.service))?.cost ?? byService[1]?.cost ?? 0).toFixed(2)}</div>
              <div className="text-xs text-gray-600 mt-1">{((byService.find((s) => /virtual machine|virtual machines|vm/i.test(s.service))?.cost ?? byService[1]?.cost ?? 0) / (totalCost || 1) * 100).toFixed(1)}% · Click for details</div>
            </div>

            <div className="bg-white text-black rounded p-4 shadow">
              <div className="text-sm">Storage</div>
              <div className="text-2xl font-bold mt-2">${(byService.find((s) => /storage/i.test(s.service))?.cost ?? byService[2]?.cost ?? 0).toFixed(2)}</div>
              <div className="text-xs text-gray-600 mt-1">{((byService.find((s) => /storage/i.test(s.service))?.cost ?? byService[2]?.cost ?? 0) / (totalCost || 1) * 100).toFixed(1)}% · Click for details</div>
            </div>

            <div className="bg-white text-black rounded p-4 shadow">
              <div className="text-sm">Networking</div>
              <div className="text-2xl font-bold mt-2">${(byService.find((s) => /network/i.test(s.service))?.cost ?? byService[3]?.cost ?? 0).toFixed(2)}</div>
              <div className="text-xs text-gray-600 mt-1">{((byService.find((s) => /network/i.test(s.service))?.cost ?? byService[3]?.cost ?? 0) / (totalCost || 1) * 100).toFixed(1)}% · Click for details</div>
            </div>
          </div>
        </div>

        {/* File Drop */}
        <div className="p-4 bg-white rounded shadow">
          <div {...getRootProps()} className="border-dashed border-2 border-gray-300 rounded p-6 text-center cursor-pointer">
            <input {...getInputProps()} />
            {isDragActive ? <p>Drop the Excel file here...</p> : <p>Drag &amp; drop an Excel file here, or click to select</p>}
          </div>
          {headerRow && <div className="mt-2 text-sm text-black">Detected header: {headerRow.join(" • ")}</div>}
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="mt-4 bg-yellow-100 rounded">
            {warnings.map((w, i) => (
              <div key={i} className="text-sm text-black">
                {w}
              </div>
            ))}
          </div>
        )}

        {/* Preview Table */}
        {previewRows.length > 0 && (
          <div className="p-4 bg-white rounded shadow">
            <h4 className="font-semibold mb-2">Parsed Preview</h4>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">Date</th>
                    <th className="text-left">Cost</th>
                    <th className="text-left">Service</th>
                    {previewRows.some((r) => r.subscriptionName) && <th className="text-left">SubscriptionName</th>}
                    {previewRows.some((r) => r.meterCategory) && <th className="text-left">MeterCategory</th>}
                    {extraFields.map((f) => (
                      <th key={f} className="text-left">{f}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1">{r.date}</td>
                      <td className="py-1">{r.cost}</td>
                      <td className="py-1">{r.service}</td>
                      {previewRows.some((x) => x.subscriptionName) && <td className="py-1">{r.subscriptionName ?? ""}</td>}
                      {previewRows.some((x) => x.meterCategory) && <td className="py-1">{r.meterCategory ?? ""}</td>}
                      {extraFields.map((f) => (
                        <td key={f} className="py-1">{r[f] ?? ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Column Mapping Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40">
            <div className="bg-white rounded p-6 w-full max-w-2xl">
              <h3 className="text-lg font-semibold mb-4">Map Columns</h3>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm">Date column</label>
                  <select className="mt-1 w-full border p-2 rounded" value={mapping?.dateIdx ?? ""} onChange={(e) => setMapping((m) => ({ ...(m as any), dateIdx: Number(e.target.value) }))}>
                    {renderColumnOptions(headerRow, rawRows)}
                  </select>
                  <div className="text-xs text-black mt-1">{renderColumnSample(mapping?.dateIdx ?? 0, headerRow, rawRows)}</div>
                </div>
                <div>
                  <label className="block text-sm">Cost column</label>
                  <select className="mt-1 w-full border p-2 rounded" value={mapping?.costIdx ?? ""} onChange={(e) => setMapping((m) => ({ ...(m as any), costIdx: Number(e.target.value) }))}>
                    {renderColumnOptions(headerRow, rawRows)}
                  </select>
                  <div className="text-xs text-black mt-1">{renderColumnSample(mapping?.costIdx ?? 1, headerRow, rawRows)}</div>
                </div>
                <div>
                  <label className="block text-sm">Service column</label>
                  <select className="mt-1 w-full border p-2 rounded" value={mapping?.serviceIdx ?? ""} onChange={(e) => setMapping((m) => ({ ...(m as any), serviceIdx: Number(e.target.value) }))}>
                    {renderColumnOptions(headerRow, rawRows)}
                  </select>
                  <div className="text-xs text-black mt-1">{renderColumnSample(mapping?.serviceIdx ?? 2, headerRow, rawRows)}</div>
                </div>
                <div>
                  <label className="block text-sm">Include additional columns in charts</label>
                  <select multiple className="mt-1 w-full border p-2 rounded h-32" value={extraFields} onChange={(e) => setExtraFields(Array.from(e.target.selectedOptions).map((o) => o.value))}>
                    {(headerRow || []).map((h, idx) => (
                      <option key={idx} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-black mt-1">Select headers to include as additional fields in charts and preview.</div>
                </div>
              </div>

              <div className="mt-4 flex justify-end space-x-2">
                <button className="px-3 py-1 bg-white text-black border rounded" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button
                  className="px-3 py-1 bg-orange-500 text-white rounded"
                  onClick={() => {
                    if (!mapping) return setShowModal(false);
                    const parsed = rawRows.map((row) => {
                      const rc = parseFloat(String(row[mapping.costIdx]));
                      const cost = Number.isNaN(rc) ? 0 : rc;
                      const base: CostData = { date: String(row[mapping.dateIdx] ?? ""), cost, service: String(row[mapping.serviceIdx] || "") };
                      if (headerRow) {
                        // attach all header-labelled props so chartMapping can use header labels directly
                        headerRow.forEach((h, idx) => {
                          if (!h) return;
                          base[h] = row[idx];
                          if (extraFields.includes(h)) base[h] = row[idx];
                        });
                        const headerLower = headerRow.map((h) => String(h || "").toLowerCase());
                        const idxSub = headerLower.indexOf("subscriptionname");
                        const idxMeter = headerLower.indexOf("metercategory");
                        const idxCost = headerLower.indexOf("cost");
                        if (idxSub >= 0) base.subscriptionName = String(row[idxSub] ?? "");
                        if (idxMeter >= 0) base.meterCategory = String(row[idxMeter] ?? "");
                        if (idxCost >= 0) base.cost = Number.isNaN(parseFloat(String(row[idxCost] ?? ""))) ? base.cost : Number(row[idxCost]);
                      }
                      return base;
                    });
                    setData(parsed);
                    setPreviewRows(parsed.slice(0, 10));
                    setWarnings([]);
                    setShowModal(false);
                  }}
                >
                  Apply Mapping
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Chart mapping controls */}
        {data.length > 0 && (
          <div className="p-4 bg-white rounded shadow space-y-4">
            <div className="flex gap-4 flex-wrap">
              <div>
                <label className="block text-sm">Pie: Group by</label>
                <select className="mt-1 border p-2 rounded" value={chartMapping.pieGroupBy} onChange={(e) => setChartMapping((c) => ({ ...c, pieGroupBy: e.target.value }))}>
                  {availableFields.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm">Value field</label>
                <select className="mt-1 border p-2 rounded" value={chartMapping.valueField} onChange={(e) => setChartMapping((c) => ({ ...c, valueField: e.target.value }))}>
                  {availableFields.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm">Date field</label>
                <select className="mt-1 border p-2 rounded" value={chartMapping.dateField} onChange={(e) => setChartMapping((c) => ({ ...c, dateField: e.target.value }))}>
                  {availableFields.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Charts */}
        {data.length > 0 && (
          <div className="space-y-8">
            {/* Line + Pie */}
            <div className="grid grid-cols-1 gap-8">
              <div className="bg-white rounded p-4 shadow" ref={lineRef as any}>
                <h4 className="font-semibold mb-2">Cost Trend</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={aggregateByDate(data, chartMapping.dateField, chartMapping.valueField)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="cost" stroke="#ff7a00" />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-2 flex space-x-2">
                  <button onClick={() => downloadCSV(aggregateByDate(data, chartMapping.dateField, chartMapping.valueField), "cost-by-date.csv")} className="px-3 py-1 bg-white text-black border rounded">
                    Export CSV
                  </button>
                  <button onClick={() => downloadPNG(lineRef, "cost-trend.png")} className="px-3 py-1 bg-white text-black border rounded">
                    Export PNG
                  </button>
                </div>
              </div>

              <div className="bg-white rounded p-4 shadow" ref={pieRef as any}>
                <h4 className="font-semibold mb-2">Category Breakdown ({chartMapping.pieGroupBy})</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={byService} dataKey="cost" nameKey="service" outerRadius={100} labelLine={false} paddingAngle={2}>
                      {byService.map((e, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => (typeof v === "number" ? v.toLocaleString(undefined, { style: "currency", currency: "USD" }) : v)} />
                    <Legend
                      {...({ payload: serviceLegendPayload } as any)}
                      layout="vertical"
                      align="right"
                      verticalAlign="middle"
                      wrapperStyle={{ fontSize: 12, color: "#000", maxHeight: 320, overflowY: "auto", width: 360 }}
                      itemStyle={{ whiteSpace: "normal", textAlign: "left", fontSize: 12, color: "#000" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex space-x-2">
                  <button onClick={() => downloadCSV(byService, "cost-by-service.csv")} className="px-3 py-1 bg-white text-black border rounded">
                    Export CSV
                  </button>
                  <button onClick={() => downloadPNG(pieRef, "cost-by-service.png")} className="px-3 py-1 bg-white text-black border rounded">
                    Export PNG
                  </button>
                </div>
              </div>
            </div>

            {/* Bar + Area */}
            <div className="grid grid-cols-1 gap-8">
              <div className="bg-white rounded p-4 shadow" ref={barRef as any}>
                <h4 className="font-semibold mb-2">Cost by Date (Bar)</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={aggregateByDate(data, chartMapping.dateField, chartMapping.valueField)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="cost" fill="#ffb366" />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-2 flex space-x-2">
                  <button onClick={() => downloadCSV(aggregateByDate(data, chartMapping.dateField, chartMapping.valueField), "cost-by-date.csv")} className="px-3 py-1 bg-white text-black border rounded">
                    Export CSV
                  </button>
                  <button onClick={() => downloadPNG(barRef, "cost-by-date.png")} className="px-3 py-1 bg-white text-black border rounded">
                    Export PNG
                  </button>
                </div>
              </div>

              <div className="bg-white rounded p-4 shadow" ref={areaRef as any}>
                <h4 className="font-semibold mb-2">Cumulative Cost (Area)</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={cumulativeByDate(data, chartMapping.dateField, chartMapping.valueField)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Area type="monotone" dataKey="cumulative" stroke="#ffc658" fill="#ffc658" />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="mt-2 flex space-x-2">
                  <button onClick={() => downloadCSV(cumulativeByDate(data, chartMapping.dateField, chartMapping.valueField), "cumulative-cost.csv")} className="px-3 py-1 bg-white text-black border rounded">
                    Export CSV
                  </button>
                  <button onClick={() => downloadPNG(areaRef, "cumulative-cost.png")} className="px-3 py-1 bg-white text-black border rounded">
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

  // -------- Helpers --------

  function aggregateByDate(data: CostData[], dateKey = "date", valueKey = "cost") {
    const map: Record<string, number> = {};
    data.forEach((d) => {
      const date = String(d[dateKey] ?? "(unknown)");
      map[date] = (map[date] || 0) + (Number(d[valueKey] ?? 0) || 0);
    });
    return Object.keys(map)
      .sort()
      .map((k) => ({ date: k, cost: map[k] }));
  }

  function cumulativeByDate(data: CostData[], dateKey = "date", valueKey = "cost") {
    const sorted = aggregateByDate(data, dateKey, valueKey);
    let running = 0;
    return sorted.map((d) => {
      running += Number(d.cost) || 0;
      return { date: d.date, cumulative: running };
    });
  }

  function aggregateByField(data: CostData[], fieldKey = "service", valueKey = "cost") {
    const map: Record<string, number> = {};
    data.forEach((d) => {
      const key = String(d[fieldKey] ?? "(unknown)");
      map[key] = (map[key] || 0) + (Number(d[valueKey] ?? 0) || 0);
    });
    return Object.keys(map).map((k) => ({ service: k, cost: map[k] }));
  }

  function downloadCSV(rows: any[], filename = "data.csv") {
    if (!rows || rows.length === 0) return;
    const keys = Object.keys(rows[0]);
    const csv = [keys.join(","), ...rows.map((r) => keys.map((k) => r[k] ?? "").join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadPNG(ref: React.RefObject<HTMLElement | null>, filename = "chart.png") {
    if (!ref || !ref.current) return;
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

  function renderColumnOptions(headerRow: string[] | null, rawRows: any[][]) {
    const maxCols = headerRow ? headerRow.length : rawRows[0] ? rawRows[0].length : 3;
    const options: { label: string; value: number }[] = [];
    for (let i = 0; i < maxCols; i++) {
      const label = headerRow ? `${i}: ${headerRow[i]}` : `${i}: Column ${i}`;
      options.push({ label, value: i });
    }
    return options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ));
  }


  function renderColumnSample(colIndex: number, headerRow: string[] | null, rawRows: any[][]) {
    if (!rawRows || rawRows.length === 0) return "(no data)";
    const sample = rawRows.slice(0, 5).map((r) => r[colIndex]);
    const formatted = sample.map((v) => (v == null || v === "" ? "(empty)" : String(v))).join(" · ");
    const header = headerRow && headerRow[colIndex] ? `${headerRow[colIndex]}: ` : "";
    return header + formatted;
  }
