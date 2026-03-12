export interface TestScenarios {
  trafficSpike: boolean
  breakingNewsSpike: boolean
  dependencySlowdown: boolean
  errorSpike: boolean
}

interface TestMetricsControlsProps {
  scenarios: TestScenarios
  onChange: (scenarios: TestScenarios) => void
}

const SCENARIO_OPTIONS: Array<{
  key: keyof TestScenarios
  label: string
  description: string
}> = [
  {
    key: 'trafficSpike',
    label: 'Traffic Spike',
    description: '5× request volume across all services',
  },
  {
    key: 'breakingNewsSpike',
    label: 'Breaking News Spike',
    description: '5× breaking news traffic + 3× cache access',
  },
  {
    key: 'dependencySlowdown',
    label: 'Dependency Slowdown',
    description: 'Increased latency on ServiceAlpha, Beta, Gamma and Zeta',
  },
  {
    key: 'errorSpike',
    label: 'Error Spike',
    description: 'Elevated GraphQL request error rate',
  },
]

export function TestMetricsControls({ scenarios, onChange }: TestMetricsControlsProps) {
  function toggle(key: keyof TestScenarios) {
    onChange({ ...scenarios, [key]: !scenarios[key] })
  }

  return (
    <div className="test-controls" role="group" aria-label="Test scenario controls">
      <span className="test-controls__label">🧪 Simulate:</span>
      {SCENARIO_OPTIONS.map(({ key, label, description }) => (
        <label key={key} className="test-controls__item" title={description}>
          <input
            type="checkbox"
            checked={scenarios[key]}
            onChange={() => toggle(key)}
            className="test-controls__checkbox"
          />
          {label}
        </label>
      ))}
    </div>
  )
}
