// Ejecutar schema.sql contra Supabase Postgres
import { Pool } from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";
import "dotenv/config";

async function main() {
  const projectId = "fhabtjhxkicshlrybryi";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Intentar conexión directa al pooler de Supabase
  const pool = new Pool({
    host: `aws-0-us-west-1.pooler.supabase.com`,
    port: 6543,
    database: "postgres",
    user: `postgres.${projectId}`,
    password: serviceRoleKey,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log("🔌 Conectando a Supabase Postgres...");
    const client = await pool.connect();
    console.log("✅ Conectado\n");

    // Ejecutar schema.sql
    const schemaPath = resolve(__dirname, "..", "db", "schema.sql");
    const schemaSQL = readFileSync(schemaPath, "utf-8");

    console.log(`📐 Ejecutando schema.sql (${schemaSQL.length} bytes)...\n`);

    await client.query(schemaSQL);
    console.log("✅ Schema SQL ejecutado con éxito\n");

    // Ejecutar seed.sql
    const seedPath = resolve(__dirname, "..", "db", "seed.sql");
    const seedSQL = readFileSync(seedPath, "utf-8");

    console.log("🌱 Ejecutando seed.sql...");
    await client.query(seedSQL);
    console.log("✅ Seed ejecutado con éxito\n");

    // Cargar number_registry con los 96 números mapeados
    console.log("📞 Cargando number_registry...");
    await loadNumberRegistry(client);

    // Verificar
    const { rows: tables } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    console.log("\n📊 Tablas creadas:");
    for (const t of tables) {
      const { rows: count } = await client.query(`SELECT COUNT(*) as c FROM "${t.table_name}"`);
      console.log(`  ✅ ${t.table_name} (${count[0].c} registros)`);
    }

    client.release();
    await pool.end();
    console.log("\n🏁 Setup completo");
  } catch (err: any) {
    console.error("❌ Error:", err.message);
    if (err.message.includes("password") || err.message.includes("authentication")) {
      console.log("\n⚠️  La contraseña no funcionó. Necesito la DB password.");
      console.log("   En Supabase Dashboard → Settings → Database → Connection string");
      console.log("   Busca esto: postgresql://postgres.fhabtjhxkicshlrybryi:[ESTA_CONTRASEÑA]@...");
    }
    await pool.end();
    process.exit(1);
  }
}

async function loadNumberRegistry(client: any) {
  const numbers = [
    ['+16614817834', 'bakersfield_1', 'google_ads'],
    ['+16263238780', 'covina', 'google_ads'],
    ['+14243527193', 'gardena_1', 'google_ads'],
    ['+16264144281', 'covina', 'facebook'],
    ['+14249552764', 'gardena_2', 'google_adspro'],
    ['+15596205003', 'fresno', 'yelp'],
    ['+14245445013', 'gardena_1', 'facebook'],
    ['+14242588917', 'gardena_2', 'lsa_adspro'],
    ['+15593829455', 'fresno', 'google_ads'],
    ['+19099702776', 'ontario', 'google_ads'],
    ['+16195660578', 'el_cajon', 'facebook'],
    ['+12133156615', 'los_angeles', 'google_ads'],
    ['+15625435129', 'whittier', 'lsa_adspro'],
    ['+16614756060', 'bakersfield_1', 'facebook'],
    ['+19097071835', 'ontario', 'yelp'],
    ['+14244025326', 'gardena_1', 'gmb'],
    ['+16263294844', 'covina', 'gmb'],
    ['+17606100826', 'victorville', 'google_ads'],
    ['+17148445847', 'santa_ana', 'google_ads'],
    ['+19093041885', 'ontario', 'facebook'],
    ['+19092657345', 'rancho_cucamonga', 'facebook'],
    ['+15623783657', 'whittier', 'yelp'],
    ['+15627848872', 'whittier', 'google_adspro'],
    ['+17148687596', 'santa_ana', 'facebook'],
    ['+19094031584', 'ontario', 'gmb'],
    ['+16263238851', 'covina', 'google_adspro'],
    ['+19093163399', 'rancho_cucamonga', 'yelp'],
    ['+14246108952', 'gardena_1', 'yelp'],
    ['+16613472881', 'bakersfield_1', 'gmb'],
    ['+19097666852', 'ontario', 'lsa_adspro'],
    ['+15625737187', 'whittier', 'google_ads'],
    ['+17603568014', 'victorville', 'facebook'],
    ['+14245328186', 'gardena_1', 'lsa'],
    ['+16199276110', 'el_cajon', 'gmb'],
    ['+15592429954', 'fresno', 'google_adspro'],
    ['+18335888070', 'all', 'call_center'],
    ['+15595605734', 'fresno', 'facebook'],
    ['+15599345784', 'fresno', 'gmb'],
    ['+16265487995', 'covina', 'lsa'],
    ['+19093403363', 'ontario', 'website'],
    ['+19095095266', 'rancho_cucamonga', 'google_ads'],
    ['+19093165648', 'rancho_cucamonga', 'google_ads'],
    ['+16616895978', 'bakersfield_1', 'lsa'],
    ['+15624423704', 'whittier', 'lsa_adspro'],
    ['+16616056944', 'bakersfield_1', 'yelp'],
    ['+16193677891', 'el_cajon', 'lsa'],
    ['+19099168363', 'rancho_cucamonga', 'lsa'],
    ['+16199012236', 'el_cajon', 'google_adspro'],
    ['+17142032783', 'santa_ana', 'lsa_adspro'],
    ['+14243361410', 'gardena_1', 'website'],
    ['+14245448025', 'gardena_2', 'google_ads'],
    ['+16199012823', 'el_cajon', 'google_ads'],
    ['+15595609705', 'fresno', 'lsa'],
    ['+14242515549', 'gardena_2', 'facebook'],
    ['+15625162276', 'whittier', 'facebook'],
    ['+19097550730', 'rancho_cucamonga', 'website'],
    ['+14245448048', 'gardena_2', 'gmb'],
    ['+16198534020', 'el_cajon', 'yelp'],
    ['+16263239267', 'covina', 'lsa_adspro'],
    ['+14247660863', 'gardena_2', 'yelp'],
    ['+12133294174', 'los_angeles', 'facebook'],
    ['+17149804856', 'santa_ana', 'gmb'],
    ['+17604622029', 'victorville', 'google_adspro'],
    ['+17147599460', 'santa_ana', 'lsa'],
    ['+15624453947', 'whittier', 'gmb'],
    ['+17606425820', 'victorville', 'gmb'],
    ['+17604937879', 'victorville', 'yelp'],
    ['+17147524847', 'santa_ana', 'website'],
    ['+12132929086', 'los_angeles', 'gmb'],
    ['+16615183472', 'bakersfield_2', 'yelp'],
    ['+19096394797', 'rancho_cucamonga', 'google_adspro'],
    ['+15625341166', 'whittier', 'google_adspro'],
    ['+16572129522', 'santa_ana', 'yelp'],
    ['+15625646332', 'whittier', 'lsa'],
    ['+15625737337', 'whittier', 'website'],
    ['+16266136975', 'covina', 'yelp'],
    ['+14249556947', 'gardena_2', 'lsa'],
    ['+16614665443', 'bakersfield_1', 'website'],
    ['+16612182737', 'bakersfield_2', 'google_ads'],
    ['+16614865132', 'bakersfield_2', 'facebook'],
    ['+15594183086', 'fresno', 'lsa_adspro'],
    ['+12136039567', 'los_angeles', 'yelp'],
    ['+16614603944', 'bakersfield_2', 'gmb'],
    ['+15592062411', 'fresno', 'website'],
    ['+17604281474', 'victorville', 'lsa'],
    ['+17144777642', 'santa_ana', 'google_adspro'],
    ['+12133193141', 'los_angeles', 'lsa'],
    ['+16614029003', 'bakersfield_2', 'lsa'],
    ['+14246220360', 'gardena_2', 'website'],
    ['+16199276238', 'el_cajon', 'website'],
    ['+16263208734', 'covina', 'website'],
    ['+19095043483', 'ontario', 'google_adspro'],
    ['+16614639543', 'bakersfield_2', 'website'],
    ['+17609775451', 'victorville', 'lsa_adspro'],
    ['+17608238190', 'victorville', 'website'],
    ['+12133193207', 'los_angeles', 'website'],
  ];

  for (const [number, locationId, channel] of numbers) {
    await client.query(
      `INSERT INTO number_registry (twilio_number, location_id, channel, active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (twilio_number) DO UPDATE SET location_id = $2, channel = $3`,
      [number, locationId, channel]
    );
  }
  console.log(`  ✅ ${numbers.length} números cargados`);
}

main();
