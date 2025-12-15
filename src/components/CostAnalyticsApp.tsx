"use client"

import { useState } from "react"
import { useDropzone } from "react-dropzone"
import * as XLSX from "xlsx"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

interface CostData {
  date: string
  cost: number
  service?: string
  // add more fields as needed
}

export default function CostAnalyticsApp() {
  const [data, setData] = useState<CostData[]>([])
  const [loading, setLoading] = useState(false)
  const [scope, setScope] = useState("")

  const onDrop = (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer)
      const workbook = XLSX.read(data, { type: "array" })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })
      // Assume first row is headers, parse accordingly
      const parsedData: CostData[] = jsonData.slice(1).map((row: any) => ({
        date: row[0],
        cost: parseFloat(row[1]),
        service: row[2] || "",
      }))
      setData(parsedData)
    }
    reader.readAsArrayBuffer(file)
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } })

  const fetchFromAzure = async () => {
    if (!scope) return
    setLoading(true)
    try {
      const response = await fetch(`/api/cost?scope=${encodeURIComponent(scope)}`)
      const result = await response.json()
      // Parse the result into CostData
      // Assuming the API returns { columns: [...], rows: [[...]] }
      const columns = result.columns
      const dateIndex = columns.findIndex((c: any) => c.name === "UsageDate" || c.name === "Date")
      const costIndex = columns.findIndex((c: any) => c.name === "Cost" || c.name === "PreTaxCost")
      const serviceIndex = columns.findIndex((c: any) => c.name === "ServiceName")
      const parsedData: CostData[] = result.rows.map((row: any[]) => ({
        date: row[dateIndex],
        cost: parseFloat(row[costIndex]),
        service: row[serviceIndex] || "",
      }))
      setData(parsedData)
    } catch (error) {
      console.error("Error fetching cost data:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex space-x-4">
        <div className="flex-1">
          <h2 className="text-xl font-semibold mb-4">Import Excel File</h2>
          <div {...getRootProps()} className="border-2 border-dashed border-gray-300 p-8 text-center cursor-pointer hover:border-gray-400">
            <input {...getInputProps()} />
            {isDragActive ? <p>Drop the file here...</p> : <p>Drag 'n' drop an Excel file here, or click to select</p>}
          </div>
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-semibold mb-4">Fetch from Azure</h2>
          <input
            type="text"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="Enter scope (e.g., /subscriptions/xxx)"
            className="w-full p-2 border border-gray-300 rounded mb-4"
          />
          <button
            onClick={fetchFromAzure}
            disabled={loading || !scope}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Fetch Cost Data"}
          </button>
        </div>
      </div>

      {data.length > 0 && (
        <div className="space-y-8">
          <div>
            <h2 className="text-xl font-semibold mb-4">Cost Data Table</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full bg-white border border-gray-300">
                <thead>
                  <tr>
                    <th className="py-2 px-4 border-b">Date</th>
                    <th className="py-2 px-4 border-b">Cost</th>
                    <th className="py-2 px-4 border-b">Service</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((item, index) => (
                    <tr key={index}>
                      <td className="py-2 px-4 border-b">{item.date}</td>
                      <td className="py-2 px-4 border-b">{item.cost}</td>
                      <td className="py-2 px-4 border-b">{item.service}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4">Cost Trend Chart</h2>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="cost" stroke="#8884d8" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}