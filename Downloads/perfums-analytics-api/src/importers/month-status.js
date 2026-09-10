export const monthStartFor = (date) => `${String(date).slice(0, 7)}-01`;

export async function ensureMonthStatusTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS data_month_status (
    month_start date NOT NULL,
    dataset text NOT NULL CHECK (dataset IN ('department_sales','employee_shifts','payroll','employee_performance','plans')),
    status text NOT NULL CHECK (status IN ('weekly','final')),
    source_file text,
    finalized_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (month_start,dataset),
    CHECK (month_start=date_trunc('month',month_start)::date)
  )`);
  await client.query('ALTER TABLE public.data_month_status ENABLE ROW LEVEL SECURITY');
}

export async function finalMonths(client, dataset, months) {
  if (!months.length) return new Set();
  const result = await client.query(
    `SELECT month_start::text FROM data_month_status
     WHERE dataset=$1 AND status='final' AND month_start=ANY($2::date[])`,
    [dataset, months.map((month) => month.length === 7 ? `${month}-01` : month)],
  );
  return new Set(result.rows.map((row) => row.month_start.slice(0, 7)));
}

export async function markMonthStatus(client, { month, datasets, status, sourceFile }) {
  await ensureMonthStatusTable(client);
  for (const dataset of datasets) {
    await client.query(`INSERT INTO data_month_status(month_start,dataset,status,source_file,finalized_at,updated_at)
      VALUES ($1,$2,$3,$4,CASE WHEN $3='final' THEN now() END,now())
      ON CONFLICT(month_start,dataset) DO UPDATE SET
        status=CASE WHEN data_month_status.status='final' AND EXCLUDED.status='weekly' THEN 'final' ELSE EXCLUDED.status END,
        source_file=EXCLUDED.source_file,
        finalized_at=CASE WHEN EXCLUDED.status='final' THEN now() ELSE data_month_status.finalized_at END,
        updated_at=now()`, [month.length === 7 ? `${month}-01` : month,dataset,status,sourceFile]);
  }
}
