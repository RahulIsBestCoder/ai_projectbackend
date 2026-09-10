import dotenv from 'dotenv';

dotenv.config();

import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

/**
 * Default / reference data seed — the baseline every domain needs to function
 * (master lookups, roles + permission matrix, config key/values, provider &
 * template catalogs, scheduler job list, OAuth client).
 *
 * ADDITIVE and idempotent: every row is upserted on its natural key, so this can
 * run repeatedly and alongside `seed:mongo` (demo data) without clobbering it.
 *
 * Run: `npm run seed:defaults`
 */

const now = () => new Date();

async function run(): Promise<void> {
  const uri = `${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/'}${process.env.DB_NAME || 'ai_project'}`;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db!;
  let count = 0;

  const upsert = async (col: string, key: Record<string, unknown>, doc: Record<string, unknown>): Promise<void> => {
    const res = await db.collection(col).updateOne(
      key,
      { $setOnInsert: { ...key, ...doc, created_at: now(), updated_at: now() } },
      { upsert: true },
    );
    if (res.upsertedCount) count += 1;
  };

  const byName = async (col: string, names: string[], extra: (n: string) => Record<string, unknown> = () => ({})): Promise<void> => {
    for (const name of names) await upsert(col, { name }, { description: name, ...extra(name) });
  };

  const byKey = async (col: string, pairs: [string, string][]): Promise<void> => {
    for (const [key, value] of pairs) await upsert(col, { key }, { value, description: key });
  };

  const section = (label: string): void => {
    // eslint-disable-next-line no-console
    console.log(label);
  };

  // ==================================================== 15. Master / reference
  section('masters');
  await byName('master_status', ['open', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled']);
  await byName('master_priority', ['lowest', 'low', 'medium', 'high', 'urgent']);
  await byName('master_severity', ['trivial', 'minor', 'normal', 'major', 'critical', 'blocker']);
  await byName('master_department', ['Engineering', 'Product', 'Design', 'QA', 'DevOps', 'Data']);
  await byName('master_designation', [
    'Intern', 'Software Engineer', 'Senior Software Engineer', 'Tech Lead',
    'Engineering Manager', 'Architect', 'QA Engineer', 'DevOps Engineer',
    'Product Manager', 'Designer',
  ]);
  await byName('master_project_type', ['Software', 'Mobile', 'Web', 'Data / ML', 'Infrastructure', 'Research']);
  await byName('master_integration', ['github', 'taiga']); // only providers in scope
  await byName('master_notification_type', [
    'risk_alert', 'deadline_slip', 'sync_failed', 'sprint_closeout',
    'report_ready', 'mention', 'assignment',
  ]);
  await byName('master_ai_provider', ['anthropic', 'openai', 'gemini', 'deepseek', 'ollama']);

  // countries -> states -> cities
  const countries: [string, string][] = [
    ['India', 'IN'], ['United States', 'US'], ['United Kingdom', 'GB'],
    ['Germany', 'DE'], ['Australia', 'AU'], ['Singapore', 'SG'], ['Canada', 'CA'],
  ];
  for (const [cn, iso] of countries) await upsert('master_country', { iso_code: iso }, { name: cn });
  const inId = (await db.collection('master_country').findOne({ iso_code: 'IN' }))!._id;
  const usId = (await db.collection('master_country').findOne({ iso_code: 'US' }))!._id;
  const states: [any, string, string][] = [
    [inId, 'West Bengal', 'WB'], [inId, 'Karnataka', 'KA'], [inId, 'Maharashtra', 'MH'],
    [usId, 'California', 'CA'], [usId, 'New York', 'NY'], [usId, 'Texas', 'TX'],
  ];
  for (const [cId, sn, siso] of states) await upsert('master_state', { country_id: cId, name: sn }, { iso_code: siso });
  const wbId = (await db.collection('master_state').findOne({ name: 'West Bengal' }))!._id;
  const caId = (await db.collection('master_state').findOne({ name: 'California' }))!._id;
  for (const [stId, city] of [[wbId, 'Kolkata'], [wbId, 'Durgapur'], [caId, 'San Francisco'], [caId, 'San Jose']] as [any, string][]) {
    await upsert('master_city', { state_id: stId, name: city }, {});
  }

  for (const [name, iso] of [['English', 'en'], ['Hindi', 'hi'], ['Spanish', 'es'], ['French', 'fr'], ['German', 'de'], ['Portuguese', 'pt']] as [string, string][]) {
    await upsert('master_language', { iso_code: iso }, { name });
  }
  for (const [name, off] of [['UTC', 0], ['GMT', 0], ['CET', 1], ['EST', -5], ['PST', -8], ['JST', 9], ['AEST', 10]] as [string, number][]) {
    await upsert('master_timezone', { name }, { offset_hours: off });
  }
  for (const [name, symbol, iso] of [
    ['US Dollar', '$', 'USD'], ['Euro', '€', 'EUR'], ['Pound Sterling', '£', 'GBP'],
    ['Indian Rupee', '₹', 'INR'], ['Japanese Yen', '¥', 'JPY'], ['Australian Dollar', 'A$', 'AUD'],
    ['Canadian Dollar', 'C$', 'CAD'], ['Singapore Dollar', 'S$', 'SGD'],
  ] as [string, string, string][]) {
    await upsert('master_currency', { iso_code: iso }, { name, symbol });
  }

  // ==================================================== 3. Project reference
  section('project reference');
  await byName('project_status', ['active', 'on_hold', 'completed', 'archived', 'cancelled']);

  // ==================================================== 4. Teams reference
  section('teams reference');
  await byName('designation', [
    'Intern', 'Software Engineer', 'Senior Software Engineer', 'Tech Lead',
    'Engineering Manager', 'QA Engineer', 'DevOps Engineer', 'Product Manager',
  ]);

  // ==================================================== 6. Taiga reference
  section('taiga reference');
  await byName('taiga_status', ['New', 'Ready', 'In progress', 'Ready for test', 'Done', 'Archived']);
  await byName('taiga_priorities', ['Low', 'Normal', 'High']);
  await byName('taiga_severity', ['Wishlist', 'Minor', 'Normal', 'Important', 'Critical']);

  // ==================================================== 1. Auth: roles + permissions
  section('roles + permissions');
  await byName('roles', ['super_admin', 'org_admin', 'project_manager', 'member', 'viewer']);

  const perms = [
    'org.read', 'org.manage',
    'project.read', 'project.write', 'project.delete', 'member.manage',
    'integration.manage',
    'workitem.read', 'workitem.write',
    'sprint.manage',
    'analytics.read', 'risk.read',
    'ai.use',
    'report.read', 'report.generate',
    'notification.read',
  ];
  await byName('permissions', perms);

  const roleMatrix: Record<string, string[]> = {
    super_admin: perms,
    org_admin: perms,
    project_manager: [
      'org.read', 'project.read', 'project.write', 'member.manage', 'integration.manage',
      'workitem.read', 'workitem.write', 'sprint.manage', 'analytics.read', 'risk.read',
      'ai.use', 'report.read', 'report.generate', 'notification.read',
    ],
    member: [
      'org.read', 'project.read', 'workitem.read', 'workitem.write', 'analytics.read',
      'ai.use', 'report.read', 'notification.read',
    ],
    viewer: ['org.read', 'project.read', 'workitem.read', 'analytics.read', 'risk.read', 'report.read', 'notification.read'],
  };
  const roleIds = Object.fromEntries((await db.collection('roles').find().toArray()).map((r) => [r.name, r._id]));
  const permIds = Object.fromEntries((await db.collection('permissions').find().toArray()).map((p) => [p.name, p._id]));
  for (const [role, list] of Object.entries(roleMatrix)) {
    for (const p of list) {
      if (roleIds[role] && permIds[p]) {
        await upsert('role_permissions', { role_id: roleIds[role], permission_id: permIds[p] }, {});
      }
    }
  }

  // ==================================================== 1. Auth: OAuth client (needed for login flow)
  section('oauth client');
  await upsert('clients', { client_name: 'Web' }, {
    client_id: uuidv4(),
    client_secret: uuidv4(),
    redirect_url: process.env.WEB_REDIRECT_URL || 'http://localhost:4200/auth/callback',
    status: 1,
  });

  // ==================================================== 9. AI: provider + model catalog
  section('ai catalog');
  const aiProviders: [string, string][] = [
    ['anthropic', 'https://api.anthropic.com'],
    ['openai', 'https://api.openai.com/v1'],
    ['gemini', 'https://generativelanguage.googleapis.com'],
    ['deepseek', 'https://api.deepseek.com'],
    ['ollama', process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'],
  ];
  for (const [name, endpoint] of aiProviders) await upsert('ai_provider', { name }, { endpoint, api_key: null });
  const provIds = Object.fromEntries((await db.collection('ai_provider').find().toArray()).map((p) => [p.name, p._id]));
  const models: [string, string, string][] = [
    ['anthropic', 'claude-sonnet-5', '5'],
    ['anthropic', 'claude-haiku-4-5', '4.5'],
    ['openai', 'gpt-4o-mini', '2024'],
    ['gemini', 'gemini-1.5-flash', '1.5'],
    ['deepseek', 'deepseek-chat', 'v3'],
    ['ollama', 'llama3.1', '3.1'],
  ];
  for (const [prov, mname, version] of models) {
    if (provIds[prov]) await upsert('ai_models', { provider_id: provIds[prov], name: mname }, { version, description: `${prov} ${mname}` });
  }
  const anthId = provIds.anthropic;
  const sonnetId = (await db.collection('ai_models').findOne({ provider_id: anthId, name: 'claude-sonnet-5' }))?._id;
  if (sonnetId) {
    for (const [tname, prompt] of [
      ['metric_lookup', 'Return only the requested metric values for {{project}} from the provided context. Do not compute new numbers.'],
      ['explanation', 'Explain, in 3-5 sentences, why {{project}} has the health/risk state shown in the context. Cite the numbers you were given.'],
      ['recommendation', 'Given the context for {{project}}, list 3 concrete, prioritised remediation actions.'],
      ['freeform', 'Answer the user question about {{project}} using only the provided context. If the context is insufficient, say so.'],
    ] as [string, string][]) {
      await upsert('ai_prompt_templates', { model_id: sonnetId, name: tname }, { prompt_text: prompt });
    }
  }

  // ==================================================== 10. Reporting templates
  section('report templates');
  for (const [name, text] of [
    ['Executive Weekly', '# {{project}} — Weekly Status ({{date}})\n\n## Executive Summary\n{{summary}}\n\n## Health & Trend\n{{health}}\n\n## Velocity & Sprint\n{{velocity}}\n\n## Risks & Predictions\n{{risks}}\n\n## Work Breakdown\n{{work}}\n\n## AI Narrative\n{{ai_narrative}}'],
    ['Sprint Retrospective', '# {{project}} — Sprint {{sprint}} Retrospective\n\n## Summary\n{{summary}}\n\n## Velocity & Burndown\n{{charts}}\n\n## What went well / What to improve\n{{retro}}'],
    ['Risk Digest', '# {{project}} — Risk Digest ({{date}})\n\n## Active Risks\n{{risks}}\n\n## Predictions\n{{predictions}}\n\n## Recommended Actions\n{{actions}}'],
  ] as [string, string][]) {
    await upsert('report_templates', { name }, { template_text: text });
  }

  // ==================================================== 11. Notification templates
  section('notification templates');
  for (const [name, subject, body] of [
    ['risk_alert', 'Risk HIGH: {{project}}', '{{project}} risk level is now {{level}}. Primary driver: {{driver}}.'],
    ['deadline_slip', 'Deadline slip: {{project}}', '{{project}} predicted delivery {{predicted_date}} is {{days}} days past target {{target_date}}.'],
    ['sync_failed', 'Sync failed: {{provider}}', '{{provider}} sync for {{project}} failed: {{message}}.'],
    ['sprint_closeout', 'Sprint {{sprint}} closed', '{{project}} sprint {{sprint}} closed. Velocity {{velocity}}, completion {{completion}}%.'],
    ['report_ready', 'Report ready: {{report}}', 'Your report "{{report}}" for {{project}} is ready: {{link}}.'],
  ] as [string, string, string][]) {
    await upsert('notification_templates', { name }, { subject, body_template: body });
  }

  // ==================================================== 13. Scheduler job list (plan §Background Workers)
  section('scheduler jobs');
  const jobs: [string, string][] = [
    ['github_sync', '*/30 * * * *'],
    ['taiga_sync', '*/30 * * * *'],
    ['analytics_calculation', process.env.CRON_ANALYTICS_CALCULATION || '0 2 * * *'],
    ['health_calculation', process.env.CRON_HEALTH_CALCULATION || '0 */6 * * *'],
    ['risk_analysis', process.env.CRON_RISK_ANALYSIS || '0 5 * * *'],
    ['deadline_prediction', '0 5 * * *'],
    ['ai_report_generation', '0 7 * * 1'],
    ['report_export', '*/5 * * * *'],
    ['notification_delivery', '*/1 * * * *'],
    ['snapshot_daily', process.env.CRON_SNAPSHOT_DAILY || '0 1 * * *'],
    ['snapshot_weekly', process.env.CRON_SNAPSHOT_WEEKLY || '0 3 * * 1'],
    ['snapshot_monthly', process.env.CRON_SNAPSHOT_MONTHLY || '0 4 1 * *'],
  ];
  for (const [name, cron] of jobs) await upsert('scheduler_jobs', { name }, { cron_expression: cron, enabled: true });
  await byKey('scheduler_configuration', [
    ['timezone', 'UTC'],
    ['max_concurrent_jobs', process.env.WORKER_CONCURRENCY || '5'],
    ['retry_attempts', process.env.JOB_ATTEMPTS || '3'],
  ]);

  // ==================================================== 14. Configuration key/values
  section('configuration');
  await byKey('system_settings', [
    ['platform.name', 'AI Project Intelligence Platform'],
    ['platform.api_prefix', process.env.API_PREFIX || '/v1'],
    ['platform.default_timezone', 'UTC'],
    ['platform.default_currency', 'USD'],
    ['platform.default_language', 'en'],
  ]);
  await byKey('application_settings', [
    ['api.version', 'v1'],
    ['pagination.default_size', process.env.DEFAULT_PAGE_SIZE || '20'],
    ['pagination.max_size', process.env.MAX_PAGE_SIZE || '100'],
  ]);
  await byKey('ai_settings', [
    ['ai.default_provider', process.env.AI_DEFAULT_PROVIDER || 'anthropic'],
    ['ai.default_model', process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'],
    ['ai.max_tokens', process.env.AI_MAX_TOKENS || '1024'],
    ['ai.cache_ttl_seconds', process.env.AI_CACHE_TTL_SECONDS || '3600'],
    ['ai.router.intents', 'metric_lookup,explanation,recommendation,freeform'],
  ]);
  await byKey('security_settings', [
    ['jwt.algorithm', process.env.JWT_ALGORITHM || 'HS256'],
    ['jwt.access_ttl', process.env.JWT_EXPIRES || '1h'],
    ['jwt.refresh_ttl', process.env.REFRESH_TOKEN_EXPIRE || '7d'],
    ['auth.rbac_enabled', 'false'],
    ['otp.expiry_minutes', process.env.OTP_EXPIRY_TIME || '10'],
    ['otp.max_attempts', process.env.OTP_MAX_ATTEMPTS || '5'],
  ]);
  for (const [provider, key, value] of [
    ['github', 'api_base', process.env.GITHUB_API_BASE || 'https://api.github.com'],
    ['github', 'webhook_path', '/v1/integrations/webhook/github'],
    ['taiga', 'api_base', process.env.TAIGA_API_BASE || 'https://api.taiga.io/api/v1'],
  ] as [string, string, string][]) {
    await upsert('integration_settings', { provider, key }, { value, description: `${provider}.${key}` });
  }
  for (const [name, enabled, description] of [
    ['ai_reports', false, 'AI-written progress reports'],
    ['ai_chat', true, 'Context-aware AI chat assistant'],
    ['dora_metrics', true, 'DORA metrics from merges to default branch'],
    ['scheduled_snapshots', true, 'Daily/weekly/monthly metric snapshots'],
    ['email_delivery', false, 'Outbound email for reports & notifications'],
    ['realtime_notifications', false, 'WebSocket/SSE push (else poll)'],
  ] as [string, boolean, string][]) {
    await upsert('feature_flags', { name }, { enabled, description });
  }
  await upsert('email_settings', {}, {
    smtp_server: process.env.SMTP_HOST || 'smtp.example.com',
    smtp_port: Number(process.env.SMTP_PORT || 587),
    smtp_user: process.env.SMTP_USERNAME || 'user',
    smtp_password: process.env.SMTP_PASSWORD || 'pass',
    from_address: process.env.SENDER_EMAIL || 'no-reply@aiproject.local',
    use_tls: true,
  });
  await upsert('storage_settings', {}, {
    provider: process.env.STORAGE_PROVIDER || 'local',
    bucket_name: process.env.S3_BUCKET || 'reports',
    region: process.env.S3_REGION || 'local',
    access_key: process.env.S3_ACCESS_KEY_ID || null,
    secret_key: process.env.S3_SECRET_ACCESS_KEY || null,
  });

  // eslint-disable-next-line no-console
  console.log(`\ndefault seed complete — ${count} new documents upserted into "${process.env.DB_NAME || 'ai_project'}" (existing rows left intact)`);
  await mongoose.disconnect();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
