import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { CountryHistoryPoint } from '../api/types.ts'
import { mapCountryHistoryToChart, type CountryChartSnapshot } from '../domain/chart.ts'
import { formatAxisPopulation, formatPopulation } from '../domain/format.ts'

function CountryTooltip({ active, point }: { active?: boolean; point?: CountryChartSnapshot }) {
  if (!active || !point) return null
  return <div className="chart-tooltip">
    <strong>Day {point.day} <span>{point.gameDate}</span></strong>
    <div><span>Healthy</span><b>{formatPopulation(point.healthy)}</b></div>
    <div><span>Infected</span><b>{formatPopulation(point.infected)}</b></div>
    <div><span>Dead</span><b>{formatPopulation(point.dead)}</b></div>
    <div><span>Zombies</span><b>{formatPopulation(point.zombies)}</b></div>
  </div>
}

export function CountryHistoryChart({ history }: { history: CountryHistoryPoint[] }) {
  const data = mapCountryHistoryToChart(history)
  const hasZombies = data.some((point) => point.zombies > 0)
  return <div className="history-chart" role="img" aria-label="Country history by actual game day">
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 14, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} allowDecimals={false}
          stroke="var(--muted)" tickLine={false} axisLine={false} tickMargin={12} />
        <YAxis yAxisId="healthy" tickFormatter={formatAxisPopulation} width={58}
          stroke="var(--muted)" tickLine={false} axisLine={false} />
        <YAxis yAxisId="affected" orientation="right" tickFormatter={formatAxisPopulation} width={58}
          stroke="var(--muted)" tickLine={false} axisLine={false} />
        <Tooltip content={(props) => <CountryTooltip active={props.active}
          point={props.payload?.[0]?.payload as CountryChartSnapshot | undefined} />} />
        <Legend verticalAlign="top" height={42} iconType="plainline" />
        <Line yAxisId="healthy" dataKey="healthy" name="Healthy" stroke="var(--healthy)"
          strokeWidth={2.4} dot={false} isAnimationActive={false} />
        <Line yAxisId="affected" dataKey="infected" name="Infected" stroke="var(--infected)"
          strokeWidth={2.4} dot={false} isAnimationActive={false} />
        <Line yAxisId="affected" dataKey="dead" name="Dead" stroke="var(--dead)"
          strokeWidth={2.4} dot={false} isAnimationActive={false} />
        {hasZombies && <Line yAxisId="affected" dataKey="zombies" name="Zombies" stroke="var(--zombies)"
          strokeWidth={2} dot={false} isAnimationActive={false} />}
      </LineChart>
    </ResponsiveContainer>
  </div>
}
