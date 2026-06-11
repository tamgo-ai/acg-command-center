# ACG Command Center — Plataforma de Inteligencia Publicitaria Autónoma

Centro de comando que unifica todas las fuentes de datos de Auto Collision Group (12 locations), cierra el círculo completo del embudo hasta el Drop Off, y razona sobre la data para entregar recomendaciones accionables.

**No es un dashboard. Un dashboard te dice qué pasó. Esto te dice qué hacer.**

## Estructura

```
acg-command-center/
├── db/
│   ├── schema.sql          # Esquema completo (10 tablas + vistas)
│   └── seed.sql            # 13 locations + canales esperados
├── config/
│   ├── index.ts            # Carga y validación de .env (Zod)
│   └── supabase.ts         # Cliente Supabase (service_role)
├── ingestion/
│   ├── twilio.ts           # Jala calls + SMS desde Twilio API
│   ├── crm.ts              # Jala appointments desde CRM Replit
│   └── run-all.ts          # Pipeline completo: Twilio → CRM → Identity → Métricas → Briefing
├── agents/
│   ├── identity-resolver.ts # Atribución last-touch por teléfono 🔑
│   ├── metrics.ts          # Capa semántica: métricas canónicas
│   └── briefing.ts         # Agente Orquestador: Claude genera briefing en español
├── dashboard/              # React + Tailwind + Tremor + Recharts
│   └── src/components/
│       ├── Header.tsx
│       ├── Sidebar.tsx
│       ├── RecommendationFeed.tsx  # Vista principal: briefing accionable
│       ├── Heatmap.tsx             # Location × Canal: costo por Drop Off
│       └── Funnel.tsx              # Embudo de conversión
├── package.json
├── tsconfig.json
└── .env.example
```

## Métrica estrella (North Star)

**Costo por Drop Off, segmentado por location Y por canal.**

El Drop Off (cliente que físicamente deja su carro) es el evento terminal de conversión.

## Pipeline de datos

```
Twilio (calls + SMS) ──┐
                        ├──→ Supabase ──→ Identity Resolver ──→ Métricas ──→ Briefing (Claude)
CRM Replit ─────────────┘
Google Ads / Meta ──────→ (v1/v2)
```

## Setup

### 1. Requisitos

- Node.js 20+
- Supabase (proyecto nuevo, región US West)
- Accesos: Twilio, CRM Replit, Anthropic API

### 2. Instalación

```bash
cd acg-command-center
cp .env.example .env
# Editar .env con credenciales reales
npm install

# Dashboard
cd dashboard
cp .env.example .env
npm install
```

### 3. Base de datos

```bash
# Ejecutar schema.sql en Supabase SQL Editor
# Ejecutar seed.sql para las 13 locations
```

### 4. Pipeline

```bash
# Ingesta completa + identity resolution + briefing
npm run ingest:all

# O paso a paso
npm run ingest:twilio
npm run ingest:crm
npm run resolve:identities
npm run compute:metrics
npm run briefing
```

### 5. Dashboard

```bash
npm run dashboard:dev
# → http://localhost:5173
```

## Fases

| Fase | Estado | Descripción |
|------|--------|-------------|
| 0 — Fundación | 🚧 Esperando credenciales | Supabase, number_registry, ingesta Twilio + CRM |
| 1 — Círculo cerrado | ⏳ Pendiente | Identity resolution, spend, briefing, dashboard |
| 2 — Inteligencia externa | ⏳ Pendiente | Ahrefs, GA4, keywords, competencia |
| 3 — Autonomía | ⏳ Pendiente | Acciones de un clic, reasignación automática |

## Reglas de oro

1. **Atribución determinística** — el número de tracking (Twilio) + teléfono del cliente = atribución. Nada de modelos probabilísticos.
2. **Cero alucinaciones** — toda recomendación cita sus números en `supporting_data`. Si no hay data suficiente, el agente lo dice.
3. **Separación OLTP/OLAP** — el CRM corre la operación. El Centro de Comando analiza. Nunca se mezclan.
4. **Prescriptivo, no descriptivo** — la salida son recomendaciones: "Pausa este canal", "Sube presupuesto aquí".
