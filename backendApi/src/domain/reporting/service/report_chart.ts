const colors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#64748b', '#06b6d4'];
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Static SVG plus an exact data table: same labels, values and series as the UI. */
export function reportChart(chart: any): string {
  const labels: string[] = Array.isArray(chart.labels) ? chart.labels : [];
  const datasets: any[] = Array.isArray(chart.datasets) ? chart.datasets : [];
  const values = datasets.flatMap(d => d.data || []).filter(valid);
  if (!values.length) return '<p class="muted">No verified chart data available.</p>';
  let svg = '';
  if (chart.type === 'pie') {
    const data = labels.map((_, i) => valid(datasets[0]?.data?.[i]) ? Math.max(0, datasets[0].data[i]) : 0);
    const total = data.reduce((a, b) => a + b, 0);
    if (!total) svg = '<text x="160" y="80" text-anchor="middle">No items in this period</text>';
    else {
      let offset = 0;
      svg = data.map((value, i) => {
        const percentage = value / total * 100;
        const circle = `<circle cx="160" cy="78" r="48" fill="none" stroke="${colors[i % colors.length]}" stroke-width="22" pathLength="100" stroke-dasharray="${percentage} ${100 - percentage}" stroke-dashoffset="${-offset}" transform="rotate(-90 160 78)"/>`;
        offset += percentage;
        return circle;
      }).join('') + `<text x="160" y="82" text-anchor="middle" font-size="15">${escape(total)} total</text>`;
    }
  } else {
    const max = Math.max(1, ...values), min = Math.min(0, ...values);
    const y = (value: number) => 130 - (value - min) / (max - min) * 110;
    const groupWidth = 280 / Math.max(labels.length, 1);
    svg = `<line x1="30" y1="${y(0)}" x2="310" y2="${y(0)}" stroke="#cbd5e1"/><text x="2" y="24" font-size="10">${escape(max)}</text>`;
    datasets.forEach((dataset, series) => {
      const color = colors[series % colors.length];
      let previous: [number, number] | null = null;
      labels.forEach((_, index) => {
        const value = dataset.data?.[index];
        if (!valid(value)) { previous = null; return; }
        const x = 30 + groupWidth * (index + 0.5);
        if (chart.type === 'line') {
          if (previous) svg += `<line x1="${previous[0]}" y1="${previous[1]}" x2="${x}" y2="${y(value)}" stroke="${color}" stroke-width="2"/>`;
          svg += `<circle cx="${x}" cy="${y(value)}" r="2.5" fill="${color}"/>`;
          previous = [x, y(value)];
        } else {
          const width = groupWidth * 0.8 / Math.max(datasets.length, 1);
          svg += `<rect x="${x - groupWidth * 0.4 + series * width}" y="${Math.min(y(0), y(value))}" width="${Math.max(1, width - 1)}" height="${Math.abs(y(value) - y(0))}" fill="${color}"/>`;
        }
      });
    });
    labels.forEach((_, i) => { svg += `<text x="${30 + groupWidth * (i + 0.5)}" y="147" text-anchor="middle" font-size="9">${i + 1}</text>`; });
  }
  const heading = datasets.map((d, i) => `<th style="color:${colors[i % colors.length]}">${escape(d.label || 'Value')}</th>`).join('');
  const rows = labels.map((label, i) => `<tr><td>${chart.type === 'pie' ? `<span style="color:${colors[i % colors.length]}">&#9632;</span> ` : `${i + 1}. `}${escape(label)}</td>${datasets.map(d => `<td>${valid(d.data?.[i]) ? escape(d.data[i]) : 'Not available'}</td>`).join('')}</tr>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 155" role="img" aria-label="${escape(chart.title)}" style="width:100%;height:155px;font-family:Arial">${svg}</svg><table><thead><tr><th>Category</th>${heading}</tr></thead><tbody>${rows}</tbody></table>`;
}
