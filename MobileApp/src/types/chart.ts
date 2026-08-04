// Mirrors Backend/src/charts/charts.service.js exports.getChartData
export interface HourlyProductionPoint {
  hour: string; // "HH:MM"
  produced: number;
}

export interface ChartDataResponse {
  hourlyCount: HourlyProductionPoint[];
  totalProduced: number;
}
