import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MetricsSnapshot } from "../hooks/useMetricsHistory";

interface StreamMetricsChartProps {
  data: MetricsSnapshot[];
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function StreamMetricsChart({ data }: StreamMetricsChartProps) {
  if (data.length === 0) {
    return (
      <div className="chart-empty-state">
        <div className="chart-empty-state__content">
          <span className="chart-empty-state__icon">📊</span>
          <h3>No Chart Data Yet</h3>
          <p>Metrics trends will appear here as data is collected over time.</p>
        </div>
      </div>
    );
  }

  const chartData = data.map((snapshot) => ({
    time: formatTime(snapshot.timestamp),
    Active: snapshot.active,
    Completed: snapshot.completed,
    "Vested Amount": snapshot.vested,
  }));

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={400}>
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorActive" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorVested" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
          <XAxis
            dataKey="time"
            stroke="#9ca3af"
            tick={{ fill: "#9ca3af", fontSize: 12 }}
            tickLine={{ stroke: "#4b5563" }}
          />
          <YAxis
            stroke="#9ca3af"
            tick={{ fill: "#9ca3af", fontSize: 12 }}
            tickLine={{ stroke: "#4b5563" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "8px",
              color: "#f9fafb",
            }}
            labelStyle={{ color: "#d1d5db" }}
          />
          <Legend
            wrapperStyle={{ color: "#d1d5db", fontSize: 14 }}
            iconType="line"
          />
          <Area
            type="monotone"
            dataKey="Active"
            stroke="#3b82f6"
            fillOpacity={1}
            fill="url(#colorActive)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="Completed"
            stroke="#10b981"
            fillOpacity={1}
            fill="url(#colorCompleted)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="Vested Amount"
            stroke="#8b5cf6"
            fillOpacity={1}
            fill="url(#colorVested)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
