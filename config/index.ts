// ACG Command Center — Configuration Loader
// Carga desde .env, valida con Zod, exporta objeto tipado.

import { config as dotenv } from 'dotenv';
import { z } from 'zod';
import { resolve, dirname } from 'path';

// Cargar .env desde la raíz del proyecto
dotenv({ path: resolve(__dirname, '..', '.env') });

const envSchema = z.object({
  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),

  // CRM
  CRM_API_URL: z.string().url(),
  CRM_API_KEY: z.string().min(1),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1),

  // Atribución
  ATTRIBUTION_LOOKBACK_DAYS: z.coerce.number().default(90),
  ATTRIBUTION_MODEL: z.enum(['last_touch']).default('last_touch'),

  // Google Ads (opcional en v1)
  GOOGLE_ADS_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_MANAGER_ID: z.string().optional(),
  GOOGLE_ADS_REFRESH_TOKEN: z.string().optional(),

  // Meta (opcional en v1)
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  META_AD_ACCOUNTS: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Configuración inválida. Revisa tu .env:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  _config = result.data;
  console.log('✅ Configuración cargada');
  return _config;
}

export function getConfig(): Config {
  if (!_config) return loadConfig();
  return _config;
}
