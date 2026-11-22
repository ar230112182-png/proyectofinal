const candidateQuery = `
  WITH candidates AS (
    SELECT l.id_lead, p.id_propiedad,
      NULLIF(TRIM(pref.ciudad), '') AS ciudad_preferida,
      NULLIF(TRIM(d.ciudad), '') AS ciudad,
      pref.precio_min, pref.precio_max, p.precio,
      pref.habitaciones_min, p.habitaciones,
      NULLIF(TRIM(pref.tipo), '') AS categoria_preferida,
      NULLIF(TRIM(cat.nombre), '') AS categoria
    FROM leads l
    LEFT JOIN LATERAL (
      SELECT * FROM preferencias_lead WHERE id_lead = l.id_lead
      ORDER BY id_preferencia DESC LIMIT 1
    ) pref ON TRUE
    JOIN propiedades p ON p.eliminado = FALSE AND LOWER(p.estado_propiedad) = 'disponible'
      AND (NULLIF(TRIM(pref.operacion), '') IS NULL OR LOWER(TRIM(pref.operacion)) = LOWER(TRIM(p.tipo_operacion)))
    LEFT JOIN categorias cat ON cat.id_categoria = p.id_categoria
    LEFT JOIN LATERAL (
      SELECT ciudad FROM direcciones WHERE id_propiedad = p.id_propiedad ORDER BY id_direccion DESC LIMIT 1
    ) d ON TRUE
    WHERE UPPER(TRIM(COALESCE(l.estado, ''))) NOT IN ('CERRADO', 'PERDIDO', 'CONVERTIDO', 'DESCARTADO')
  ), evaluated AS (
    SELECT *,
      CASE WHEN ciudad_preferida IS NULL THEN NULL WHEN ciudad IS NULL THEN FALSE
        ELSE LOWER(ciudad_preferida) = LOWER(ciudad) END AS ciudad_ok,
      CASE WHEN precio_min IS NULL AND precio_max IS NULL THEN NULL WHEN precio IS NULL THEN FALSE
        ELSE (precio_min IS NULL OR precio >= precio_min) AND (precio_max IS NULL OR precio <= precio_max) END AS presupuesto_ok,
      CASE WHEN habitaciones_min IS NULL THEN NULL WHEN habitaciones IS NULL THEN FALSE
        ELSE habitaciones >= habitaciones_min END AS habitaciones_ok,
      CASE WHEN categoria_preferida IS NULL THEN NULL WHEN categoria IS NULL THEN FALSE
        ELSE LOWER(categoria_preferida) = LOWER(categoria) END AS categoria_ok
    FROM candidates
  )
  SELECT id_lead, id_propiedad,
    ROUND(100.0 * ((CASE WHEN ciudad_ok THEN 35 ELSE 0 END)
      + (CASE WHEN presupuesto_ok THEN 36 ELSE 0 END)
      + (CASE WHEN habitaciones_ok THEN 14 ELSE 0 END)
      + (CASE WHEN categoria_ok THEN 8 ELSE 0 END))
      / NULLIF((CASE WHEN ciudad_ok IS NOT NULL THEN 35 ELSE 0 END)
      + (CASE WHEN presupuesto_ok IS NOT NULL THEN 36 ELSE 0 END)
      + (CASE WHEN habitaciones_ok IS NOT NULL THEN 14 ELSE 0 END)
      + (CASE WHEN categoria_ok IS NOT NULL THEN 8 ELSE 0 END), 0), 2) AS puntuacion,
    jsonb_build_object(
      'ciudad', jsonb_build_object('cumple', ciudad_ok, 'esperado', ciudad_preferida, 'actual', ciudad),
      'presupuesto', jsonb_build_object('cumple', presupuesto_ok, 'minimo', precio_min, 'maximo', precio_max, 'actual', precio),
      'habitaciones', jsonb_build_object('cumple', habitaciones_ok, 'minimo', habitaciones_min, 'actual', habitaciones),
      'categoria', jsonb_build_object('cumple', categoria_ok, 'esperado', categoria_preferida, 'actual', categoria)
    ) AS explicacion
  FROM evaluated`;

async function regenerateMatches(client, userId, audit) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('generar_coincidencias')) AS acquired");
    if (!lock.rows[0].acquired) {
      const error = new Error('Ya se está generando coincidencias. Inténtalo de nuevo al terminar.');
      error.status = 409;
      throw error;
    }
    await client.query(`CREATE TEMP TABLE matching_candidates ON COMMIT DROP AS ${candidateQuery}`);
    await client.query('CREATE INDEX ON matching_candidates (id_lead, id_propiedad)');
    await client.query('ANALYZE matching_candidates');
    await client.query(`CREATE TEMP TABLE matching_changes ON COMMIT DROP AS
      SELECT c.id_lead, c.id_propiedad,
        (m.id_coincidencia IS NULL) AS nueva,
        (m.id_coincidencia IS NOT NULL AND
          (m.puntuacion IS DISTINCT FROM c.puntuacion OR m.explicacion IS DISTINCT FROM c.explicacion)) AS modificada,
        NOT EXISTS (SELECT 1 FROM coincidencias old
          WHERE old.version_calculo = 1 AND old.id_propiedad = c.id_propiedad) AS propiedad_nueva
      FROM matching_candidates c
      LEFT JOIN coincidencias m ON m.id_lead = c.id_lead
        AND m.id_propiedad = c.id_propiedad AND m.version_calculo = 1`);
    await client.query(`CREATE TEMP TABLE matching_removed ON COMMIT DROP AS
      SELECT m.id_lead, m.id_propiedad,
        (p.id_propiedad IS NULL OR p.eliminado OR
          (p.estado_propiedad IS NOT NULL AND LOWER(p.estado_propiedad) <> 'disponible')) AS no_disponible
      FROM coincidencias m
      LEFT JOIN propiedades p ON p.id_propiedad = m.id_propiedad
      WHERE m.version_calculo = 1 AND NOT EXISTS (
        SELECT 1 FROM matching_candidates c
        WHERE c.id_lead = m.id_lead AND c.id_propiedad = m.id_propiedad
      )`);
    const counts = await client.query(`SELECT
      (SELECT COUNT(*) FROM matching_candidates)::bigint AS total,
      (SELECT COUNT(*) FROM matching_changes WHERE nueva)::bigint AS nuevos,
      (SELECT COUNT(*) FROM matching_changes WHERE modificada)::bigint AS modificados,
      (SELECT COUNT(*) FROM matching_removed)::bigint AS retirados,
      (SELECT COUNT(DISTINCT id_propiedad) FROM matching_changes WHERE propiedad_nueva)::bigint AS propiedades_nuevas,
      (SELECT COUNT(DISTINCT id_propiedad) FROM matching_removed WHERE no_disponible)::bigint AS propiedades_no_disponibles`);
    const summary = counts.rows[0];
    const history = await client.query(`
      INSERT INTO historial_generaciones_coincidencias
        (id_usuario, total, nuevos, modificados, retirados, propiedades_nuevas, propiedades_no_disponibles)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id_generacion, generada_en`, [
      userId, summary.total, summary.nuevos, summary.modificados, summary.retirados,
      summary.propiedades_nuevas, summary.propiedades_no_disponibles,
    ]);
    const generationId = history.rows[0].id_generacion;
    await client.query(`INSERT INTO coincidencias_retiradas (id_generacion, id_lead, id_propiedad, no_disponible)
      SELECT $1, id_lead, id_propiedad, no_disponible FROM matching_removed`, [generationId]);
    const saved = await client.query(`
      INSERT INTO coincidencias (id_lead, id_propiedad, puntuacion, explicacion, version_calculo, creada_en, nueva, propiedad_nueva)
      SELECT c.id_lead, c.id_propiedad, c.puntuacion, c.explicacion, 1, CURRENT_TIMESTAMP, ch.nueva, ch.propiedad_nueva
      FROM matching_candidates c JOIN matching_changes ch USING (id_lead, id_propiedad) WHERE TRUE
      ON CONFLICT (id_lead, id_propiedad) DO UPDATE
      SET puntuacion = EXCLUDED.puntuacion, explicacion = EXCLUDED.explicacion,
          version_calculo = EXCLUDED.version_calculo, creada_en = EXCLUDED.creada_en,
          nueva = EXCLUDED.nueva, propiedad_nueva = EXCLUDED.propiedad_nueva`);
    await client.query(`DELETE FROM coincidencias m WHERE NOT EXISTS (
      SELECT 1 FROM matching_candidates c WHERE c.id_lead = m.id_lead AND c.id_propiedad = m.id_propiedad
    )`);
    const generation = await client.query(`
      INSERT INTO generaciones_coincidencias (id, generada_en, total)
      VALUES (1, CURRENT_TIMESTAMP, $1)
      ON CONFLICT (id) DO UPDATE SET generada_en = EXCLUDED.generada_en, total = EXCLUDED.total
      RETURNING generada_en, total`, [saved.rowCount]);
    if (Number(summary.nuevos) || Number(summary.modificados) || Number(summary.retirados)) {
      await client.query(`
        INSERT INTO notificaciones (id_usuario, dedupe_key, titulo, detalle, entidad, entidad_id)
        SELECT u.id_usuario, 'matching-generation:' || $1::text, 'Cambios en coincidencias',
          $2::text, 'matching', $1::text
        FROM usuarios u WHERE u.activo = TRUE
          AND u.rol IN ('admin', 'administrador', 'agente', 'vendedor')
        ON CONFLICT (id_usuario, dedupe_key) DO NOTHING`, [
        generationId, `${summary.nuevos} nuevas, ${summary.modificados} modificadas y ${summary.retirados} retiradas.`,
      ]);
    }
    await audit(userId, 'ejecutar', 'coincidencias', null, { generadas: saved.rowCount }, client);
    await client.query('COMMIT');
    return { ...generation.rows[0], ...summary, id_generacion: generationId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

module.exports = { candidateQuery, regenerateMatches };
